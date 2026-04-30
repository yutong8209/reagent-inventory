import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from db import get_db
from models import BatchStock, Instrument, Operator, Reagent, Transaction, WorkGroup
from schemas import (
    BatchStockInfo,
    OutboundReagentItem,
    OutboundPreviewBatch,
    StockOutBatchItem,
    StockOutBatchRequest,
    StockOutBatchResponse,
    StockOutItemResult,
    StockOutPreviewRequest,
    StockOutPreviewResponse,
    StockOutRequest,
    StockOutResponse,
)

router = APIRouter()


def _require_operator(operator_name: str, db: Session) -> str:
    cleaned_operator = _clean_text(operator_name)
    if not cleaned_operator:
        raise HTTPException(status_code=400, detail="出库人不能为空")

    operator = (
        db.query(Operator)
        .filter(Operator.name == cleaned_operator, Operator.is_active.is_(True))
        .first()
    )
    if not operator:
        raise HTTPException(status_code=400, detail=f"出库人“{cleaned_operator}”不存在或已停用")

    return cleaned_operator


def _safe_ratio(value: int | None) -> int:
    return value if value and value > 0 else 1


def _clean_text(value: str | None) -> str:
    return (value or "").strip()


def _batch_total_min_units(batch: BatchStock) -> int:
    return (batch.quantity * _safe_ratio(batch.package_to_min_qty)) + (batch.loose_min_quantity or 0)


def _set_batch_total_min_units(batch: BatchStock, total_min_units: int):
    ratio = _safe_ratio(batch.package_to_min_qty)
    batch.quantity = total_min_units // ratio
    batch.loose_min_quantity = total_min_units % ratio


def _is_batch_expired(batch: BatchStock) -> bool:
    return batch.expiry_date < date.today()


def _query_available_batches(db: Session, reagent_id: int) -> list[BatchStock]:
    return (
        db.query(BatchStock)
        .filter(
            BatchStock.reagent_id == reagent_id,
            BatchStock.is_archived.is_(False),
            or_(BatchStock.quantity > 0, BatchStock.loose_min_quantity > 0),
        )
        .order_by(BatchStock.expiry_date.asc(), BatchStock.created_at.asc(), BatchStock.id.asc())
        .all()
    )


def _query_all_batches(db: Session, reagent_id: int) -> list[BatchStock]:
    return (
        db.query(BatchStock)
        .filter(
            BatchStock.reagent_id == reagent_id,
            BatchStock.is_archived.is_(False),
        )
        .order_by(BatchStock.expiry_date.desc(), BatchStock.created_at.desc(), BatchStock.id.desc())
        .all()
    )


def _requested_min_quantity(quantity: int, outbound_unit: str, package_to_min_qty: int) -> int:
    ratio = _safe_ratio(package_to_min_qty)
    return quantity * ratio if outbound_unit == "package" else quantity


def _build_preview_batch(
    batch: BatchStock,
    deducted_min_quantity: int = 0,
    *,
    is_scanned_batch: bool = False,
) -> OutboundPreviewBatch:
    return OutboundPreviewBatch(
        batch_stock_id=batch.id,
        batch_no=batch.batch_no,
        expiry_date=batch.expiry_date,
        package_quantity=batch.quantity,
        loose_min_quantity=batch.loose_min_quantity or 0,
        available_min_quantity=_batch_total_min_units(batch),
        deducted_min_quantity=deducted_min_quantity,
        is_expired=_is_batch_expired(batch),
        is_scanned_batch=is_scanned_batch,
    )


def _build_batch_stock_info(batch: BatchStock) -> BatchStockInfo:
    return BatchStockInfo(
        id=batch.id,
        batch_no=batch.batch_no,
        expiry_date=batch.expiry_date,
        quantity=batch.quantity,
        loose_min_quantity=batch.loose_min_quantity or 0,
        available_min_quantity=_batch_total_min_units(batch),
        package_unit=batch.package_unit,
        min_unit=batch.min_unit,
        package_to_min_qty=_safe_ratio(batch.package_to_min_qty),
        is_expired=_is_batch_expired(batch),
        created_at=batch.created_at,
    )


def _find_scanned_batch(
    batches: list[BatchStock],
    scanned_batch_no: str | None,
    scanned_expiry_date: date | None,
) -> BatchStock | None:
    batch_no = _clean_text(scanned_batch_no)
    if not batch_no:
        return None

    for batch in batches:
        if batch.batch_no != batch_no:
            continue
        if scanned_expiry_date and batch.expiry_date != scanned_expiry_date:
            continue
        return batch

    return None


def _build_preview(request: StockOutPreviewRequest, db: Session) -> StockOutPreviewResponse:
    reagent = (
        db.query(Reagent)
        .filter(Reagent.id == request.reagent_id, Reagent.is_archived.is_(False))
        .first()
    )
    if not reagent:
        raise HTTPException(status_code=404, detail=f"试剂 ID {request.reagent_id} 不存在")

    batches = _query_available_batches(db, reagent.id)
    if not batches:
        raise HTTPException(status_code=400, detail=f"{reagent.name} 当前无可用库存")

    requested_min_quantity = _requested_min_quantity(
        request.quantity,
        request.outbound_unit,
        reagent.package_to_min_qty,
    )
    total_min_quantity = sum(_batch_total_min_units(batch) for batch in batches)
    if total_min_quantity < requested_min_quantity:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{reagent.name} 库存不足，当前可用 "
                f"{total_min_quantity}{_clean_text(reagent.unit) or '最小单位'}"
            ),
        )

    instrument = reagent.instrument
    work_group = instrument.work_group if instrument else None
    total_package_quantity = sum(batch.quantity for batch in batches)
    deducted_batches: list[OutboundPreviewBatch] = []
    earlier_expiring_batches: list[OutboundPreviewBatch] = []
    selected_batch: BatchStock | None = None

    if request.deduction_mode == "scanned_batch":
        selected_batch = _find_scanned_batch(
            batches,
            request.scanned_batch_no,
            request.scanned_expiry_date,
        )
        if not selected_batch:
            raise HTTPException(status_code=400, detail="未找到扫码对应的库存批次，请重新扫码")

        selected_batch_min = _batch_total_min_units(selected_batch)
        if selected_batch_min < requested_min_quantity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"扫码批次库存不足，当前仅剩 "
                    f"{selected_batch_min}{selected_batch.min_unit or reagent.unit or '最小单位'}"
                ),
            )

        deducted_batches.append(
            _build_preview_batch(
                selected_batch,
                deducted_min_quantity=requested_min_quantity,
                is_scanned_batch=True,
            )
        )
        earlier_expiring_batches = [
            _build_preview_batch(batch)
            for batch in batches
            if batch.id != selected_batch.id and batch.expiry_date < selected_batch.expiry_date
        ]
    else:
        remaining_to_deduct = requested_min_quantity
        for batch in batches:
            if remaining_to_deduct <= 0:
                break
            available_min = _batch_total_min_units(batch)
            deduct_min = min(available_min, remaining_to_deduct)
            if deduct_min <= 0:
                continue
            deducted_batches.append(
                _build_preview_batch(batch, deducted_min_quantity=deduct_min)
            )
            remaining_to_deduct -= deduct_min

    contains_expired = any(batch.is_expired for batch in deducted_batches)

    return StockOutPreviewResponse(
        reagent_id=reagent.id,
        reagent_name=reagent.name,
        instrument_id=instrument.id if instrument else None,
        instrument_name=instrument.name if instrument else None,
        work_group_id=work_group.id if work_group else None,
        work_group_name=work_group.name if work_group else None,
        package_unit=reagent.package_unit,
        min_unit=reagent.unit,
        package_to_min_qty=_safe_ratio(reagent.package_to_min_qty),
        requested_quantity=request.quantity,
        outbound_unit=request.outbound_unit,
        requested_min_quantity=requested_min_quantity,
        deduction_mode=request.deduction_mode,
        total_package_quantity=total_package_quantity,
        total_min_quantity=total_min_quantity,
        contains_expired=contains_expired,
        has_earlier_expiring_batch=bool(earlier_expiring_batches),
        earlier_expiring_batches=earlier_expiring_batches,
        selected_batch_stock_id=selected_batch.id if selected_batch else None,
        selected_batch_no=selected_batch.batch_no if selected_batch else None,
        selected_expiry_date=selected_batch.expiry_date if selected_batch else None,
        deducted_batches=deducted_batches,
    )


def _build_outbound_warning(result: StockOutItemResult) -> str | None:
    if not result.contains_expired:
        return None
    return f"{result.reagent_name} 本次出库包含过期批次，请注意使用记录"


def _create_outbound_transaction(
    reagent: Reagent,
    batch_stock: BatchStock,
    item: StockOutBatchItem,
    operator: str,
    deducted_min_quantity: int,
    requested_min_quantity: int,
    db: Session,
):
    remark_payload = {
        "outbound_unit": item.outbound_unit,
        "requested_quantity": item.quantity,
        "requested_min_quantity": requested_min_quantity,
        "deduction_mode": item.deduction_mode,
        "scanned_batch_no": item.scanned_batch_no,
        "scanned_expiry_date": (
            item.scanned_expiry_date.isoformat() if item.scanned_expiry_date else None
        ),
        "deducted_min_quantity": deducted_min_quantity,
    }

    db.add(
        Transaction(
            reagent_id=reagent.id,
            batch_stock_id=batch_stock.id,
            type="OUT",
            quantity=deducted_min_quantity,
            operator=operator,
            source=item.source,
            raw_barcode=item.raw_barcode or f"OUTBOUND::{reagent.id}",
            package_unit=batch_stock.package_unit,
            min_unit=batch_stock.min_unit,
            package_to_min_qty=_safe_ratio(batch_stock.package_to_min_qty),
            remark=json.dumps(remark_payload, ensure_ascii=False),
        )
    )


def _process_batch_outbound(request: StockOutBatchRequest, db: Session) -> StockOutBatchResponse:
    operator = _require_operator(request.operator, db)
    if not request.items:
        raise HTTPException(status_code=400, detail="请至少提交一条出库记录")

    try:
        preview_requests = [
            StockOutPreviewRequest(
                source=item.source,
                reagent_id=item.reagent_id,
                quantity=item.quantity,
                outbound_unit=item.outbound_unit,
                deduction_mode=item.deduction_mode,
                raw_barcode=item.raw_barcode,
                scanned_batch_no=item.scanned_batch_no,
                scanned_expiry_date=item.scanned_expiry_date,
            )
            for item in request.items
        ]
        previews = [_build_preview(preview_request, db) for preview_request in preview_requests]

        results: list[StockOutItemResult] = []
        warnings: list[str] = []

        for item, preview in zip(request.items, previews):
            reagent = (
                db.query(Reagent)
                .filter(Reagent.id == preview.reagent_id, Reagent.is_archived.is_(False))
                .first()
            )
            if not reagent:
                raise HTTPException(status_code=404, detail=f"试剂 ID {preview.reagent_id} 不存在")

            for deducted_batch in preview.deducted_batches:
                batch_stock = (
                    db.query(BatchStock)
                    .filter(BatchStock.id == deducted_batch.batch_stock_id)
                    .first()
                )
                if not batch_stock:
                    raise HTTPException(status_code=404, detail="库存批次不存在，无法完成出库")

                current_total_min = _batch_total_min_units(batch_stock)
                if current_total_min < deducted_batch.deducted_min_quantity:
                    raise HTTPException(
                        status_code=400,
                        detail=f"{reagent.name} 库存已变化，请重新确认后再出库",
                    )

                _set_batch_total_min_units(
                    batch_stock,
                    current_total_min - deducted_batch.deducted_min_quantity,
                )
                _create_outbound_transaction(
                    reagent,
                    batch_stock,
                    item,
                    operator,
                    deducted_batch.deducted_min_quantity,
                    preview.requested_min_quantity,
                    db,
                )

            result = StockOutItemResult(
                reagent_id=preview.reagent_id,
                reagent_name=preview.reagent_name,
                outbound_unit=preview.outbound_unit,
                requested_quantity=preview.requested_quantity,
                requested_min_quantity=preview.requested_min_quantity,
                deduction_mode=preview.deduction_mode,
                contains_expired=preview.contains_expired,
                deducted_batches=preview.deducted_batches,
            )
            results.append(result)

            warning = _build_outbound_warning(result)
            if warning:
                warnings.append(warning)

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"出库失败：{exc}") from exc

    return StockOutBatchResponse(
        success=True,
        item_count=len(results),
        items=results,
        warnings=warnings,
    )


@router.get("/stock/{reagent_id}", response_model=list[BatchStockInfo])
def get_stock_by_reagent(
    reagent_id: int,
    include_zero_stock: bool = Query(False),
    db: Session = Depends(get_db),
):
    stocks = _query_all_batches(db, reagent_id) if include_zero_stock else _query_available_batches(db, reagent_id)
    return [_build_batch_stock_info(stock) for stock in stocks]


@router.get("/outbound/reagents", response_model=list[OutboundReagentItem])
def search_outbound_reagents(
    q: str | None = Query(None),
    work_group_id: int | None = Query(None),
    instrument_id: int | None = Query(None),
    include_zero_stock: bool = Query(False),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Reagent)
        .join(Instrument, Reagent.instrument_id == Instrument.id)
        .join(WorkGroup, Instrument.work_group_id == WorkGroup.id)
        .filter(Reagent.is_archived.is_(False))
        .order_by(WorkGroup.id.asc(), Instrument.id.asc(), Reagent.id.asc())
    )

    if work_group_id is not None:
        query = query.filter(Instrument.work_group_id == work_group_id)
    if instrument_id is not None:
        query = query.filter(Reagent.instrument_id == instrument_id)

    keyword = _clean_text(q)
    if keyword:
        like_pattern = f"%{keyword}%"
        query = query.filter(
            or_(
                Reagent.name.ilike(like_pattern),
                Reagent.manufacturer.ilike(like_pattern),
                Instrument.name.ilike(like_pattern),
                WorkGroup.name.ilike(like_pattern),
            )
        )

    items: list[OutboundReagentItem] = []
    for reagent in query.all():
        batches = _query_available_batches(db, reagent.id)
        if not batches and not include_zero_stock:
            continue

        instrument = reagent.instrument
        work_group = instrument.work_group if instrument else None
        total_package_quantity = sum(batch.quantity for batch in batches)
        total_min_quantity = sum(_batch_total_min_units(batch) for batch in batches)

        items.append(
            OutboundReagentItem(
                reagent_id=reagent.id,
                reagent_name=reagent.name,
                instrument_id=instrument.id if instrument else 0,
                instrument_name=instrument.name if instrument else "",
                work_group_id=work_group.id if work_group else 0,
                work_group_name=work_group.name if work_group else "",
                reagent_group_id=reagent.reagent_group.id if reagent.reagent_group else None,
                reagent_group_name=reagent.reagent_group.name if reagent.reagent_group else None,
                reagent_group_sort_order=reagent.reagent_group.sort_order if reagent.reagent_group else 9999,
                package_unit=reagent.package_unit,
                min_unit=reagent.unit,
                package_to_min_qty=_safe_ratio(reagent.package_to_min_qty),
                total_package_quantity=total_package_quantity,
                total_min_quantity=total_min_quantity,
                nearest_expiry_date=batches[0].expiry_date if batches else None,
                contains_expired=any(_is_batch_expired(batch) for batch in batches),
                batch_count=len(batches),
            )
        )

    return items


@router.post("/outbound/preview", response_model=StockOutPreviewResponse)
def preview_outbound(request: StockOutPreviewRequest, db: Session = Depends(get_db)):
    return _build_preview(request, db)


@router.post("/outbound/batch", response_model=StockOutBatchResponse)
def stock_out_batch(request: StockOutBatchRequest, db: Session = Depends(get_db)):
    return _process_batch_outbound(request, db)


@router.post("/outbound", response_model=StockOutResponse)
def stock_out(request: StockOutRequest, db: Session = Depends(get_db)):
    if request.batch_stock_id:
        batch_stock = (
            db.query(BatchStock)
            .filter(
                BatchStock.id == request.batch_stock_id,
                BatchStock.is_archived.is_(False),
            )
            .first()
        )
        if not batch_stock:
            raise HTTPException(status_code=404, detail="批次不存在")

        batch_request = StockOutBatchRequest(
            operator=request.operator,
            items=[
                StockOutBatchItem(
                    source="scan",
                    reagent_id=batch_stock.reagent_id,
                    quantity=request.quantity,
                    outbound_unit=request.outbound_unit,
                    deduction_mode=request.deduction_mode or "scanned_batch",
                    raw_barcode=request.raw_barcode,
                    scanned_batch_no=request.scanned_batch_no or batch_stock.batch_no,
                    scanned_expiry_date=request.scanned_expiry_date or batch_stock.expiry_date,
                )
            ],
        )
    elif request.reagent_id:
        batch_request = StockOutBatchRequest(
            operator=request.operator,
            items=[
                StockOutBatchItem(
                    source="manual",
                    reagent_id=request.reagent_id,
                    quantity=request.quantity,
                    outbound_unit=request.outbound_unit,
                    deduction_mode=request.deduction_mode or "fefo",
                    raw_barcode=request.raw_barcode,
                    scanned_batch_no=request.scanned_batch_no,
                    scanned_expiry_date=request.scanned_expiry_date,
                )
            ],
        )
    else:
        raise HTTPException(status_code=400, detail="请提供 batch_stock_id 或 reagent_id")

    batch_result = _process_batch_outbound(batch_request, db)
    first_item = batch_result.items[0]
    remaining_quantity = 0

    if first_item.deducted_batches:
        first_batch = (
            db.query(BatchStock)
            .filter(BatchStock.id == first_item.deducted_batches[0].batch_stock_id)
            .first()
        )
        if first_batch:
            remaining_quantity = first_batch.quantity

    return StockOutResponse(
        success=True,
        remaining_quantity=remaining_quantity,
        deducted_batches=[
            {
                "batch_id": batch.batch_stock_id,
                "batch_no": batch.batch_no,
                "quantity": batch.deducted_min_quantity,
            }
            for batch in first_item.deducted_batches
        ],
    )
