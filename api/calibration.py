import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from db import get_db
from models import BatchStock, CalibrationRecord, Operator, Reagent, Transaction
from schemas import (
    CalibrationBatchCandidate,
    CalibrationRecordCreate,
    CalibrationRecordItem,
    CalibrationRecordUpdate,
    CalibrationScanPreviewResponse,
    CalibrationTargetCandidate,
    CalibrationTargetPreviewResponse,
)
from services import BarcodeParser

router = APIRouter()


def _clean_text(value: str | None) -> str:
    return (value or "").strip()


def _normalize_name(value: str | None) -> str:
    return "".join(_clean_text(value).lower().split())


def _safe_ratio(value: int | None) -> int:
    return value if value and value > 0 else 1


def _days_until(target: date) -> int:
    return (target - date.today()).days


def _batch_total_min_units(batch: BatchStock) -> int:
    return (batch.quantity * _safe_ratio(batch.package_to_min_qty)) + (batch.loose_min_quantity or 0)


def _set_batch_total_min_units(batch: BatchStock, total_min_units: int):
    ratio = _safe_ratio(batch.package_to_min_qty)
    batch.quantity = total_min_units // ratio
    batch.loose_min_quantity = total_min_units % ratio


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


def _strip_calibrator_suffix(name: str | None) -> str:
    cleaned = _clean_text(name)
    if cleaned.endswith("校准品"):
        return cleaned[: -len("校准品")].strip()
    return cleaned


def _serialize_batch_candidate(batch: BatchStock) -> CalibrationBatchCandidate:
    return CalibrationBatchCandidate(
        batch_stock_id=batch.id,
        batch_no=batch.batch_no,
        expiry_date=batch.expiry_date.isoformat(),
        expiry_days_left=_days_until(batch.expiry_date),
        available_min_quantity=_batch_total_min_units(batch),
        min_unit=_clean_text(batch.min_unit) or "次",
        created_at=batch.created_at,
    )


def _load_target_batch_candidates(db: Session, reagent_id: int) -> list[CalibrationBatchCandidate]:
    batches = (
        db.query(BatchStock)
        .filter(BatchStock.reagent_id == reagent_id)
        .order_by(BatchStock.expiry_date.desc(), BatchStock.created_at.desc(), BatchStock.id.desc())
        .all()
    )
    return [_serialize_batch_candidate(batch) for batch in batches]


def _build_target_candidates(db: Session, calibrator: Reagent) -> list[Reagent]:
    target_base_name = _normalize_name(_strip_calibrator_suffix(calibrator.name))
    query = (
        db.query(Reagent)
        .filter(
            Reagent.instrument_id == calibrator.instrument_id,
            Reagent.is_archived.is_(False),
            Reagent.is_calibrator.is_(False),
        )
        .order_by(Reagent.name.asc(), Reagent.id.asc())
    )
    reagents = query.all()
    if target_base_name:
        exact = [reagent for reagent in reagents if _normalize_name(reagent.name) == target_base_name]
        if exact:
            ordered = exact + [reagent for reagent in reagents if reagent.id not in {item.id for item in exact}]
            return ordered
    return reagents


def _serialize_target_candidate(reagent: Reagent) -> CalibrationTargetCandidate:
    instrument = reagent.instrument
    work_group = instrument.work_group if instrument else None
    return CalibrationTargetCandidate(
        reagent_id=reagent.id,
        reagent_name=reagent.name,
        instrument_id=instrument.id if instrument else 0,
        instrument_name=instrument.name if instrument else "",
        work_group_id=work_group.id if work_group else 0,
        work_group_name=work_group.name if work_group else "",
        calibration_result_unit=_clean_text(reagent.calibration_result_unit) or "nmmol/L",
    )


def _resolve_default_batch_values(candidates: list[CalibrationBatchCandidate]) -> tuple[str | None, str | None]:
    if not candidates:
        return None, None
    new_batch_no = candidates[0].batch_no
    old_batch_no = candidates[1].batch_no if len(candidates) > 1 else None
    return old_batch_no, new_batch_no


def _build_target_preview_payload(target: Reagent, db: Session) -> CalibrationTargetPreviewResponse:
    batch_candidates = _load_target_batch_candidates(db, target.id)
    default_old_batch_no, default_new_batch_no = _resolve_default_batch_values(batch_candidates)
    return CalibrationTargetPreviewResponse(
        target_reagent_id=target.id,
        target_reagent_name=target.name,
        result_unit=_clean_text(target.calibration_result_unit) or "nmmol/L",
        old_batch_candidates=batch_candidates,
        new_batch_candidates=batch_candidates,
        default_old_batch_no=default_old_batch_no,
        default_new_batch_no=default_new_batch_no,
    )


def _match_calibrator_batch(
    db: Session,
    *,
    calibrator_id: int,
    batch_no: str | None,
    expiry_date: date | None,
) -> BatchStock | None:
    query = db.query(BatchStock).filter(BatchStock.reagent_id == calibrator_id)
    cleaned_batch_no = _clean_text(batch_no)
    if cleaned_batch_no:
        query = query.filter(BatchStock.batch_no == cleaned_batch_no)
    if expiry_date is not None:
        query = query.filter(BatchStock.expiry_date == expiry_date)

    batch = query.order_by(BatchStock.created_at.desc(), BatchStock.id.desc()).first()
    if batch:
        return batch

    if cleaned_batch_no:
        return None

    return (
        db.query(BatchStock)
        .filter(BatchStock.reagent_id == calibrator_id)
        .order_by(BatchStock.expiry_date.desc(), BatchStock.created_at.desc(), BatchStock.id.desc())
        .first()
    )


def _serialize_record(record: CalibrationRecord, db: Session) -> CalibrationRecordItem:
    calibrator = record.calibrator_reagent
    target = record.target_reagent
    target_candidates = [_serialize_target_candidate(item) for item in _build_target_candidates(db, calibrator)]
    batch_candidates = _load_target_batch_candidates(db, target.id)
    return CalibrationRecordItem(
        id=record.id,
        calibrator_reagent_id=record.calibrator_reagent_id,
        calibrator_name=calibrator.name,
        calibrator_batch_stock_id=record.calibrator_batch_stock_id,
        calibrator_batch_no=record.calibrator_batch_stock.batch_no,
        target_reagent_id=record.target_reagent_id,
        target_reagent_name=target.name,
        target_old_batch_no=record.target_old_batch_no,
        target_new_batch_no=record.target_new_batch_no,
        usage_times=record.usage_times,
        result_unit=record.result_unit,
        operator=record.operator,
        old_result_1=record.old_result_1,
        old_result_2=record.old_result_2,
        old_result_3=record.old_result_3,
        old_result_4=record.old_result_4,
        old_result_5=record.old_result_5,
        new_result_1=record.new_result_1,
        new_result_2=record.new_result_2,
        new_result_3=record.new_result_3,
        new_result_4=record.new_result_4,
        new_result_5=record.new_result_5,
        target_options=target_candidates,
        old_batch_candidates=batch_candidates,
        new_batch_candidates=batch_candidates,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _calibration_transaction_remark(
    *,
    target_reagent_id: int,
    target_reagent_name: str,
    target_old_batch_no: str | None,
    target_new_batch_no: str | None,
    usage_times: int,
    result_unit: str,
) -> str:
    return json.dumps(
        {
            "target_reagent_id": target_reagent_id,
            "target_reagent_name": target_reagent_name,
            "target_old_batch_no": target_old_batch_no,
            "target_new_batch_no": target_new_batch_no,
            "usage_times": usage_times,
            "result_unit": result_unit,
        },
        ensure_ascii=False,
    )


@router.post("/calibration/scan-preview", response_model=CalibrationScanPreviewResponse)
def calibration_scan_preview(payload: dict, db: Session = Depends(get_db)):
    barcode = _clean_text(payload.get("barcode"))
    if not barcode:
        raise HTTPException(status_code=400, detail="请先扫描校准品条码")

    parser = BarcodeParser(db)
    parsed = parser.parse(barcode)
    if not parsed.reagent_id:
        raise HTTPException(status_code=404, detail="当前条码未匹配到校准品试剂档案")

    calibrator = db.query(Reagent).filter(Reagent.id == parsed.reagent_id).first()
    if not calibrator or calibrator.is_archived:
        raise HTTPException(status_code=404, detail="校准品试剂不存在或已归档")
    if not calibrator.is_calibrator:
        raise HTTPException(status_code=400, detail="当前条码对应的不是校准品，不能进入校准流程")

    calibrator_batch = _match_calibrator_batch(
        db,
        calibrator_id=calibrator.id,
        batch_no=parsed.extracted_batch_no,
        expiry_date=parsed.extracted_expiry_date,
    )
    if not calibrator_batch:
        raise HTTPException(status_code=404, detail="未找到当前扫码校准品批号对应的库存批次")

    target_candidates = _build_target_candidates(db, calibrator)
    target_options = [_serialize_target_candidate(item) for item in target_candidates]
    target = target_candidates[0] if target_candidates else None
    batch_candidates = _load_target_batch_candidates(db, target.id) if target else []
    default_old_batch_no, default_new_batch_no = _resolve_default_batch_values(batch_candidates)

    return CalibrationScanPreviewResponse(
        calibrator_reagent_id=calibrator.id,
        calibrator_name=calibrator.name,
        calibrator_batch_stock_id=calibrator_batch.id,
        calibrator_batch_no=calibrator_batch.batch_no,
        calibrator_expiry_date=calibrator_batch.expiry_date.isoformat() if calibrator_batch.expiry_date else None,
        calibrator_available_min_quantity=_batch_total_min_units(calibrator_batch),
        calibrator_min_unit=_clean_text(calibrator_batch.min_unit) or "次",
        target_reagent_id=target.id if target else None,
        target_reagent_name=target.name if target else None,
        target_options=target_options,
        old_batch_candidates=batch_candidates,
        new_batch_candidates=batch_candidates,
        default_old_batch_no=default_old_batch_no,
        default_new_batch_no=default_new_batch_no,
        default_usage_times=1,
        result_unit=_clean_text(target.calibration_result_unit) if target else "nmmol/L",
        raw_barcode=barcode,
    )


@router.get("/calibration/target-preview", response_model=CalibrationTargetPreviewResponse)
def calibration_target_preview(reagent_id: int = Query(..., ge=1), db: Session = Depends(get_db)):
    target = db.query(Reagent).filter(Reagent.id == reagent_id).first()
    if not target or target.is_archived or target.is_calibrator:
        raise HTTPException(status_code=404, detail="被校准试剂不存在")
    return _build_target_preview_payload(target, db)


@router.get("/calibration/records", response_model=list[CalibrationRecordItem])
def list_calibration_records(limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)):
    records = (
        db.query(CalibrationRecord)
        .order_by(CalibrationRecord.created_at.desc(), CalibrationRecord.id.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_record(record, db) for record in records]


@router.get("/calibration/records/{record_id}", response_model=CalibrationRecordItem)
def get_calibration_record(record_id: int, db: Session = Depends(get_db)):
    record = db.query(CalibrationRecord).filter(CalibrationRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="校准记录不存在")
    return _serialize_record(record, db)


@router.post("/calibration/records", response_model=CalibrationRecordItem, status_code=201)
def create_calibration_record(data: CalibrationRecordCreate, db: Session = Depends(get_db)):
    operator = _require_operator(data.operator, db)
    calibrator = db.query(Reagent).filter(Reagent.id == data.calibrator_reagent_id).first()
    if not calibrator or calibrator.is_archived or not calibrator.is_calibrator:
        raise HTTPException(status_code=400, detail="校准品试剂不存在或不是校准品")

    target = db.query(Reagent).filter(Reagent.id == data.target_reagent_id).first()
    if not target or target.is_archived or target.is_calibrator:
        raise HTTPException(status_code=400, detail="被校准试剂不存在，或当前选择的是校准品")

    calibrator_batch = db.query(BatchStock).filter(BatchStock.id == data.calibrator_batch_stock_id).first()
    if not calibrator_batch or calibrator_batch.reagent_id != calibrator.id:
        raise HTTPException(status_code=400, detail="校准品批号不存在或与校准品不匹配")

    available_min_quantity = _batch_total_min_units(calibrator_batch)
    if available_min_quantity < data.usage_times:
        raise HTTPException(status_code=400, detail="校准品库存不足，不能完成本次校准")

    _set_batch_total_min_units(calibrator_batch, available_min_quantity - data.usage_times)

    transaction = Transaction(
        reagent_id=calibrator.id,
        batch_stock_id=calibrator_batch.id,
        type="CALIBRATION",
        quantity=data.usage_times,
        operator=operator,
        source="scan",
        raw_barcode=_clean_text(data.raw_barcode) or f"CAL::{calibrator.id}",
        package_unit=calibrator_batch.package_unit,
        min_unit=calibrator_batch.min_unit,
        package_to_min_qty=_safe_ratio(calibrator_batch.package_to_min_qty),
        remark=_calibration_transaction_remark(
            target_reagent_id=target.id,
            target_reagent_name=target.name,
            target_old_batch_no=data.target_old_batch_no,
            target_new_batch_no=data.target_new_batch_no,
            usage_times=data.usage_times,
            result_unit=_clean_text(data.result_unit) or _clean_text(target.calibration_result_unit) or "nmmol/L",
        ),
    )
    db.add(transaction)
    db.flush()

    record = CalibrationRecord(
        calibrator_reagent_id=calibrator.id,
        calibrator_batch_stock_id=calibrator_batch.id,
        target_reagent_id=target.id,
        transaction_id=transaction.id,
        raw_barcode=_clean_text(data.raw_barcode) or None,
        target_old_batch_no=_clean_text(data.target_old_batch_no) or None,
        target_new_batch_no=_clean_text(data.target_new_batch_no) or None,
        usage_times=data.usage_times,
        result_unit=_clean_text(data.result_unit) or _clean_text(target.calibration_result_unit) or "nmmol/L",
        operator=operator,
        old_result_1=_clean_text(data.old_result_1) or None,
        old_result_2=_clean_text(data.old_result_2) or None,
        old_result_3=_clean_text(data.old_result_3) or None,
        old_result_4=_clean_text(data.old_result_4) or None,
        old_result_5=_clean_text(data.old_result_5) or None,
        new_result_1=_clean_text(data.new_result_1) or None,
        new_result_2=_clean_text(data.new_result_2) or None,
        new_result_3=_clean_text(data.new_result_3) or None,
        new_result_4=_clean_text(data.new_result_4) or None,
        new_result_5=_clean_text(data.new_result_5) or None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _serialize_record(record, db)


@router.put("/calibration/records/{record_id}", response_model=CalibrationRecordItem)
def update_calibration_record(record_id: int, data: CalibrationRecordUpdate, db: Session = Depends(get_db)):
    record = db.query(CalibrationRecord).filter(CalibrationRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="校准记录不存在")

    operator = _require_operator(data.operator, db)
    target = db.query(Reagent).filter(Reagent.id == data.target_reagent_id).first()
    if not target or target.is_archived or target.is_calibrator:
        raise HTTPException(status_code=400, detail="被校准试剂不存在，或当前选择的是校准品")

    calibrator_batch = db.query(BatchStock).filter(BatchStock.id == record.calibrator_batch_stock_id).first()
    if not calibrator_batch:
        raise HTTPException(status_code=400, detail="校准品批次不存在，无法编辑本次校准")

    delta_usage = data.usage_times - record.usage_times
    if delta_usage > 0:
        available_min_quantity = _batch_total_min_units(calibrator_batch)
        if available_min_quantity < delta_usage:
            raise HTTPException(status_code=400, detail="校准品库存不足，不能增加本次校准用量")
        _set_batch_total_min_units(calibrator_batch, available_min_quantity - delta_usage)
    elif delta_usage < 0:
        _set_batch_total_min_units(calibrator_batch, _batch_total_min_units(calibrator_batch) + abs(delta_usage))

    record.target_reagent_id = target.id
    record.target_old_batch_no = _clean_text(data.target_old_batch_no) or None
    record.target_new_batch_no = _clean_text(data.target_new_batch_no) or None
    record.usage_times = data.usage_times
    record.result_unit = _clean_text(data.result_unit) or _clean_text(target.calibration_result_unit) or "nmmol/L"
    record.operator = operator
    record.old_result_1 = _clean_text(data.old_result_1) or None
    record.old_result_2 = _clean_text(data.old_result_2) or None
    record.old_result_3 = _clean_text(data.old_result_3) or None
    record.old_result_4 = _clean_text(data.old_result_4) or None
    record.old_result_5 = _clean_text(data.old_result_5) or None
    record.new_result_1 = _clean_text(data.new_result_1) or None
    record.new_result_2 = _clean_text(data.new_result_2) or None
    record.new_result_3 = _clean_text(data.new_result_3) or None
    record.new_result_4 = _clean_text(data.new_result_4) or None
    record.new_result_5 = _clean_text(data.new_result_5) or None

    if record.transaction_id:
        transaction = db.query(Transaction).filter(Transaction.id == record.transaction_id).first()
        if transaction:
            transaction.quantity = data.usage_times
            transaction.operator = operator
            transaction.remark = _calibration_transaction_remark(
                target_reagent_id=target.id,
                target_reagent_name=target.name,
                target_old_batch_no=record.target_old_batch_no,
                target_new_batch_no=record.target_new_batch_no,
                usage_times=data.usage_times,
                result_unit=record.result_unit,
            )

    db.commit()
    db.refresh(record)
    return _serialize_record(record, db)
