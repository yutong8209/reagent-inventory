import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models import BatchStock, Instrument, Operator, Reagent, ReagentGroup, Transaction
from schemas import (
    ReagentCreate,
    ReagentResponse,
    StockInBatchItem,
    StockInBatchRequest,
    StockInBatchResponse,
    StockInItemResult,
    StockInRequest,
    StockInResponse,
)
from services import BarcodeParser

router = APIRouter()

MANUAL_MATCH_PREFIX = "MANUAL::"
DEFAULT_PACKAGE_UNIT = "盒"
DEFAULT_MIN_UNIT = "瓶"
DEFAULT_CALIBRATOR_PACKAGE_UNIT = "盒"
DEFAULT_CALIBRATOR_MIN_UNIT = "次"


def _normalize_manual_key(value: str) -> str:
    return re.sub(r"\s+", "", value).upper()


def _normalize_name(value: str | None) -> str:
    return "".join((value or "").strip().lower().split())


def _build_manual_match_pattern(instrument_id: int, reagent_name: str) -> str:
    return f"{MANUAL_MATCH_PREFIX}{instrument_id}::{_normalize_manual_key(reagent_name)}"


def _clean_text(value: str | None) -> str:
    return (value or "").strip()


def _is_calibrator_name(name: str | None) -> bool:
    return _clean_text(name).endswith("校准品")


def _require_operator(operator_name: str, db: Session) -> str:
    cleaned_operator = _clean_text(operator_name)
    if not cleaned_operator:
        raise HTTPException(status_code=400, detail="操作人不能为空")

    operator = (
        db.query(Operator)
        .filter(Operator.name == cleaned_operator, Operator.is_active.is_(True))
        .first()
    )
    if not operator:
        raise HTTPException(status_code=400, detail=f"操作人“{cleaned_operator}”不存在或已停用")

    return cleaned_operator


def _resolve_reagent_group(db: Session, reagent_group_id: int | None) -> ReagentGroup | None:
    if reagent_group_id is None:
        return None

    group = db.query(ReagentGroup).filter(ReagentGroup.id == reagent_group_id).first()
    if not group:
        raise HTTPException(status_code=400, detail="项目分组不存在")
    return group


def _resolve_package_to_min_qty(item: StockInBatchItem, reagent: Reagent | None = None) -> int:
    value = item.package_to_min_qty or (reagent.package_to_min_qty if reagent else None) or 1
    if value <= 0:
        raise HTTPException(status_code=400, detail="包装关系必须大于 0")
    return value


def _build_inbound_warning(reagent: Reagent, expiry_date: date) -> str | None:
    today = date.today()
    if expiry_date < today:
        return f"{reagent.name} 已过期，效期为 {expiry_date}"

    days_left = (expiry_date - today).days
    if days_left <= reagent.warning_days:
        return f"{reagent.name} 距离效期仅剩 {days_left} 天"

    return None


def _resolve_reagent_for_item(item: StockInBatchItem, db: Session) -> Reagent:
    if item.reagent_id is not None:
        reagent = db.query(Reagent).filter(Reagent.id == item.reagent_id).first()
        if not reagent:
            raise HTTPException(status_code=404, detail=f"试剂 ID {item.reagent_id} 不存在")
        return reagent

    if item.source != "manual":
        raise HTTPException(status_code=400, detail=f"试剂 {item.reagent_name} 尚未建档，请先补全资料")

    if not item.instrument_id:
        raise HTTPException(status_code=400, detail=f"试剂 {item.reagent_name} 缺少仪器信息")

    instrument = db.query(Instrument).filter(Instrument.id == item.instrument_id).first()
    if not instrument:
        raise HTTPException(status_code=400, detail=f"仪器 ID {item.instrument_id} 不存在")

    if item.work_group_id and instrument.work_group_id != item.work_group_id:
        raise HTTPException(status_code=400, detail=f"试剂 {item.reagent_name} 的工作组与仪器不匹配")

    reagent_name = _clean_text(item.reagent_name)
    if not reagent_name:
        raise HTTPException(status_code=400, detail="试剂名称不能为空")

    existing = db.query(Reagent).filter(Reagent.instrument_id == instrument.id).all()
    normalized_name = _normalize_name(reagent_name)
    for reagent in existing:
        if _normalize_name(reagent.name) == normalized_name:
            return reagent

    warning_days = item.warning_days if item.warning_days is not None else (instrument.default_warning_days or 30)
    warning_stock = item.warning_stock if item.warning_stock is not None else (instrument.default_warning_stock or 5)

    is_calibrator = _is_calibrator_name(reagent_name)
    reagent = Reagent(
        instrument_id=instrument.id,
        name=reagent_name,
        match_mode="exact",
        match_pattern=_build_manual_match_pattern(instrument.id, reagent_name),
        raw_barcode_sample="MANUAL",
        manufacturer=_clean_text(item.manufacturer) or None,
        unit=DEFAULT_CALIBRATOR_MIN_UNIT if is_calibrator else (_clean_text(item.min_unit) or DEFAULT_MIN_UNIT),
        package_unit=DEFAULT_CALIBRATOR_PACKAGE_UNIT if is_calibrator else (_clean_text(item.package_unit) or DEFAULT_PACKAGE_UNIT),
        package_to_min_qty=_resolve_package_to_min_qty(item),
        warning_days=warning_days,
        warning_stock=warning_stock,
        single_batch_warning_stock=None,
        follow_instrument=False,
        is_calibrator=is_calibrator,
        calibration_result_unit="nmmol/L",
    )
    db.add(reagent)
    db.flush()
    return reagent


def _upsert_batch_stock(
    reagent: Reagent,
    item: StockInBatchItem,
    package_unit: str,
    min_unit: str,
    package_to_min_qty: int,
    db: Session,
) -> BatchStock:
    batch_stock = (
        db.query(BatchStock)
        .filter(
            BatchStock.reagent_id == reagent.id,
            BatchStock.batch_no == item.batch_no,
            BatchStock.expiry_date == item.expiry_date,
        )
        .first()
    )

    if batch_stock:
        if (
            batch_stock.package_unit != package_unit
            or batch_stock.min_unit != min_unit
            or batch_stock.package_to_min_qty != package_to_min_qty
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"试剂 {reagent.name} 的批号 {item.batch_no} 已存在，"
                    "包装单位、最小单位或包装关系与现有库存不一致，不能直接合并入库"
                ),
            )
        batch_stock.quantity += item.quantity
        return batch_stock

    batch_stock = BatchStock(
        reagent_id=reagent.id,
        batch_no=item.batch_no,
        expiry_date=item.expiry_date,
        quantity=item.quantity,
        package_unit=package_unit,
        min_unit=min_unit,
        package_to_min_qty=package_to_min_qty,
    )
    db.add(batch_stock)
    db.flush()
    return batch_stock


def _create_transaction(
    reagent: Reagent,
    batch_stock: BatchStock,
    item: StockInBatchItem,
    operator: str,
    package_unit: str,
    min_unit: str,
    package_to_min_qty: int,
    db: Session,
):
    raw_barcode = item.raw_barcode or _build_manual_match_pattern(reagent.instrument_id, reagent.name)
    db.add(
        Transaction(
            reagent_id=reagent.id,
            batch_stock_id=batch_stock.id,
            type="IN",
            quantity=item.quantity,
            operator=operator,
            source=item.source,
            raw_barcode=raw_barcode,
            package_unit=package_unit,
            min_unit=min_unit,
            package_to_min_qty=package_to_min_qty,
            remark=None,
        )
    )


def _process_batch_inbound(request: StockInBatchRequest, db: Session) -> StockInBatchResponse:
    operator = _require_operator(request.operator, db)
    parser = BarcodeParser(db)

    if not request.items:
        raise HTTPException(status_code=400, detail="请至少提交一条入库记录")

    results: list[StockInItemResult] = []
    warnings: list[str] = []

    try:
        for item in request.items:
            reagent = _resolve_reagent_for_item(item, db)
            if reagent.is_archived:
                reagent.is_archived = False

            if item.reagent_id is not None or reagent.is_calibrator:
                package_unit = _clean_text(reagent.package_unit) or DEFAULT_PACKAGE_UNIT
                min_unit = _clean_text(reagent.unit) or DEFAULT_MIN_UNIT
                package_to_min_qty = reagent.package_to_min_qty or 1
            else:
                package_unit = _clean_text(item.package_unit) or _clean_text(reagent.package_unit) or DEFAULT_PACKAGE_UNIT
                min_unit = _clean_text(item.min_unit) or _clean_text(reagent.unit) or DEFAULT_MIN_UNIT
                package_to_min_qty = _resolve_package_to_min_qty(item, reagent)

            if item.source == "manual" and item.reagent_id is None:
                reagent.manufacturer = _clean_text(item.manufacturer) or reagent.manufacturer
                reagent.package_unit = package_unit
                reagent.unit = min_unit
                reagent.package_to_min_qty = package_to_min_qty

            warning = _build_inbound_warning(reagent, item.expiry_date)
            batch_stock = _upsert_batch_stock(
                reagent,
                item,
                package_unit,
                min_unit,
                package_to_min_qty,
                db,
            )
            _create_transaction(
                reagent,
                batch_stock,
                item,
                operator,
                package_unit,
                min_unit,
                package_to_min_qty,
                db,
            )
            if item.source == "scan" and item.raw_barcode:
                parser.learn_batch_rule(
                    barcode=item.raw_barcode,
                    reagent=reagent,
                    confirmed_batch_no=item.batch_no,
                    parsed_batch_no=item.parsed_batch_no,
                )

            if warning:
                warnings.append(warning)

            results.append(
                StockInItemResult(
                    reagent_id=reagent.id,
                    reagent_name=reagent.name,
                    batch_stock_id=batch_stock.id,
                    batch_no=batch_stock.batch_no,
                    quantity=item.quantity,
                    package_unit=package_unit,
                    min_unit=min_unit,
                    package_to_min_qty=package_to_min_qty,
                    current_quantity=batch_stock.quantity,
                    warning=warning,
                )
            )

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"入库失败：{exc}") from exc

    return StockInBatchResponse(
        success=True,
        item_count=len(results),
        items=results,
        warnings=warnings,
    )


@router.post("/reagents", response_model=ReagentResponse, status_code=201)
def create_reagent(data: ReagentCreate, db: Session = Depends(get_db)):
    instrument = db.query(Instrument).filter(Instrument.id == data.instrument_id).first()
    reagent_group = _resolve_reagent_group(db, data.reagent_group_id)
    if not instrument:
        raise HTTPException(status_code=400, detail=f"仪器 ID {data.instrument_id} 不存在")

    if data.match_mode not in ["exact", "prefix"]:
        raise HTTPException(status_code=400, detail="匹配模式必须是 exact 或 prefix")

    name = _clean_text(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="试剂名称不能为空")

    match_pattern = _clean_text(data.match_pattern)
    if not match_pattern:
        raise HTTPException(status_code=400, detail="匹配值不能为空")

    normalized_name = _normalize_name(name)
    instrument_reagents = (
        db.query(Reagent)
        .filter(Reagent.instrument_id == data.instrument_id, Reagent.is_archived.is_(False))
        .all()
    )
    for reagent in instrument_reagents:
        if _normalize_name(reagent.name) == normalized_name:
            raise HTTPException(
                status_code=400,
                detail=f"仪器“{instrument.name}”下已存在同名试剂“{reagent.name}”",
            )

    if data.match_mode == "exact":
        existing = (
            db.query(Reagent)
            .filter(
                Reagent.is_archived.is_(False),
                Reagent.match_mode == "exact",
                Reagent.match_pattern == match_pattern,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"已存在使用相同完整匹配规则的试剂：{existing.name}",
            )
    else:
        exact_match = (
            db.query(Reagent)
            .filter(
                Reagent.is_archived.is_(False),
                Reagent.match_mode == "exact",
                Reagent.match_pattern == match_pattern,
            )
            .first()
        )
        if exact_match:
            raise HTTPException(
                status_code=400,
                detail=f"该匹配值已被试剂“{exact_match.name}”作为完整匹配使用",
            )

        existing_prefixes = (
            db.query(Reagent)
            .filter(Reagent.is_archived.is_(False), Reagent.match_mode == "prefix")
            .all()
        )
        for existing in existing_prefixes:
            if match_pattern.startswith(existing.match_pattern) or existing.match_pattern.startswith(match_pattern):
                raise HTTPException(
                    status_code=400,
                    detail=f"匹配值与现有试剂“{existing.name}”的前缀匹配规则冲突",
                )

    is_calibrator = bool(data.is_calibrator if data.is_calibrator is not None else _is_calibrator_name(name))
    reagent = Reagent(
        instrument_id=data.instrument_id,
        reagent_group_id=reagent_group.id if reagent_group else None,
        name=name,
        match_mode=data.match_mode,
        match_pattern=match_pattern,
        raw_barcode_sample=_clean_text(data.raw_barcode_sample) or None,
        manufacturer=_clean_text(data.manufacturer) or None,
        unit=DEFAULT_CALIBRATOR_MIN_UNIT if is_calibrator else (_clean_text(data.unit) or DEFAULT_MIN_UNIT),
        package_unit=DEFAULT_CALIBRATOR_PACKAGE_UNIT if is_calibrator else (_clean_text(data.package_unit) or DEFAULT_PACKAGE_UNIT),
        package_to_min_qty=data.package_to_min_qty or 1,
        warning_days=data.warning_days,
        warning_stock=data.warning_stock,
        single_batch_warning_stock=None,
        follow_instrument=data.follow_instrument,
        is_calibrator=is_calibrator,
        calibration_result_unit=_clean_text(data.calibration_result_unit) or "nmmol/L",
    )
    db.add(reagent)
    db.commit()
    db.refresh(reagent)
    return reagent


@router.get("/reagents/{reagent_id}", response_model=ReagentResponse)
def get_reagent(reagent_id: int, db: Session = Depends(get_db)):
    reagent = (
        db.query(Reagent)
        .filter(Reagent.id == reagent_id, Reagent.is_archived.is_(False))
        .first()
    )
    if not reagent:
        raise HTTPException(status_code=404, detail="试剂不存在")
    return reagent


@router.post("/inbound/batch", response_model=StockInBatchResponse)
def stock_in_batch(request: StockInBatchRequest, db: Session = Depends(get_db)):
    return _process_batch_inbound(request, db)


@router.post("/inbound", response_model=StockInResponse)
def stock_in(request: StockInRequest, db: Session = Depends(get_db)):
    batch_result = _process_batch_inbound(
        StockInBatchRequest(
            operator=request.operator,
            items=[
                StockInBatchItem(
                    source=request.source,
                    reagent_id=request.reagent_id,
                    work_group_id=None,
                    instrument_id=None,
                    reagent_name="",
                    batch_no=request.batch_no,
                    expiry_date=request.expiry_date,
                    quantity=request.quantity,
                    package_unit=request.package_unit,
                    min_unit=request.min_unit,
                    package_to_min_qty=request.package_to_min_qty,
                    raw_barcode=request.raw_barcode,
                )
            ],
        ),
        db,
    )

    result = batch_result.items[0]
    return StockInResponse(
        success=True,
        batch_stock_id=result.batch_stock_id,
        current_quantity=result.current_quantity,
        warning=result.warning,
    )
