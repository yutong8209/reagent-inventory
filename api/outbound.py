from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models import BatchStock, Operator, Transaction
from schemas import BatchStockInfo, StockOutRequest, StockOutResponse

router = APIRouter()


def _require_operator(operator_name: str, db: Session) -> str:
    cleaned_operator = (operator_name or "").strip()
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


@router.get("/stock/{reagent_id}", response_model=list[BatchStockInfo])
def get_stock_by_reagent(reagent_id: int, db: Session = Depends(get_db)):
    stocks = (
        db.query(BatchStock)
        .filter(BatchStock.reagent_id == reagent_id)
        .order_by(BatchStock.expiry_date.asc(), BatchStock.created_at.asc(), BatchStock.id.asc())
        .all()
    )
    return stocks


@router.post("/outbound", response_model=StockOutResponse)
def stock_out(request: StockOutRequest, db: Session = Depends(get_db)):
    operator = _require_operator(request.operator, db)
    deducted_batches = []

    if request.batch_stock_id:
        batch_stock = db.query(BatchStock).filter(BatchStock.id == request.batch_stock_id).first()
        if not batch_stock:
            raise HTTPException(status_code=404, detail="批次不存在")

        if batch_stock.expiry_date < date.today():
            raise HTTPException(
                status_code=400,
                detail=f"该试剂已过期，过期日期：{batch_stock.expiry_date}",
            )

        if batch_stock.quantity < request.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"库存不足，当前库存：{batch_stock.quantity}",
            )

        batch_stock.quantity -= request.quantity

        transaction = Transaction(
            reagent_id=batch_stock.reagent_id,
            batch_stock_id=batch_stock.id,
            type="OUT",
            quantity=request.quantity,
            operator=operator,
            source="outbound",
            raw_barcode=request.raw_barcode,
            package_unit=batch_stock.package_unit,
            min_unit=batch_stock.min_unit,
            package_to_min_qty=batch_stock.package_to_min_qty,
            remark=None,
        )
        db.add(transaction)
        db.commit()
        db.refresh(batch_stock)

        deducted_batches.append(
            {
                "batch_id": batch_stock.id,
                "batch_no": batch_stock.batch_no,
                "quantity": request.quantity,
            }
        )

        return StockOutResponse(
            success=True,
            remaining_quantity=batch_stock.quantity,
            deducted_batches=deducted_batches,
        )

    if request.reagent_id:
        return _fefo_deduction(
            db,
            request.reagent_id,
            request.quantity,
            operator,
            request.raw_barcode,
        )

    raise HTTPException(status_code=400, detail="请提供 batch_stock_id 或 reagent_id")


def _fefo_deduction(
    db: Session,
    reagent_id: int,
    total_quantity: int,
    operator: str,
    raw_barcode: str,
) -> StockOutResponse:
    batches = (
        db.query(BatchStock)
        .filter(BatchStock.reagent_id == reagent_id, BatchStock.quantity > 0)
        .order_by(BatchStock.expiry_date.asc(), BatchStock.created_at.asc(), BatchStock.id.asc())
        .all()
    )

    if not batches:
        raise HTTPException(status_code=400, detail="该试剂无库存")

    total_stock = sum(batch.quantity for batch in batches)
    if total_stock < total_quantity:
        raise HTTPException(status_code=400, detail=f"库存不足，当前总库存：{total_stock}")

    expired_batches = [batch for batch in batches if batch.expiry_date < date.today()]
    if expired_batches:
        raise HTTPException(
            status_code=400,
            detail=f"该试剂已过期，过期日期：{expired_batches[0].expiry_date}",
        )

    remaining_to_deduct = total_quantity
    deducted_batches = []
    last_batch = None

    for batch in batches:
        if remaining_to_deduct <= 0:
            break

        deduct_qty = min(batch.quantity, remaining_to_deduct)
        batch.quantity -= deduct_qty
        remaining_to_deduct -= deduct_qty
        last_batch = batch

        db.add(
            Transaction(
                reagent_id=reagent_id,
                batch_stock_id=batch.id,
                type="OUT",
                quantity=deduct_qty,
                operator=operator,
                source="outbound",
                raw_barcode=raw_barcode,
                package_unit=batch.package_unit,
                min_unit=batch.min_unit,
                package_to_min_qty=batch.package_to_min_qty,
                remark=None,
            )
        )

        deducted_batches.append(
            {
                "batch_id": batch.id,
                "batch_no": batch.batch_no,
                "quantity": deduct_qty,
            }
        )

    db.commit()

    return StockOutResponse(
        success=True,
        remaining_quantity=last_batch.quantity if last_batch else 0,
        deducted_batches=deducted_batches,
    )
