from datetime import date, datetime, time, timedelta
from io import BytesIO
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from db import get_db
from models import BatchStock, Instrument, Reagent, Transaction, WorkGroup
from schemas import ReportReagentOption, TransactionListItem, UsageSummaryItem

router = APIRouter()


def _clean_text(value: str | None) -> str:
    return (value or "").strip()


def _safe_ratio(value: int | None) -> int:
    return value if value and value > 0 else 1


def _safe_min_unit(transaction: Transaction, batch_stock: BatchStock | None, reagent: Reagent) -> str:
    return (
        _clean_text(transaction.min_unit)
        or _clean_text(batch_stock.min_unit if batch_stock else None)
        or _clean_text(reagent.unit)
        or "最小单位"
    )


def _transaction_min_quantity(transaction: Transaction) -> int:
    if transaction.type == "IN":
        return transaction.quantity * _safe_ratio(transaction.package_to_min_qty)
    return transaction.quantity


def _normalize_date_range(start_date: date | None, end_date: date | None) -> tuple[date, date]:
    today = date.today()
    normalized_end = end_date or today
    normalized_start = start_date or (normalized_end - timedelta(days=29))
    if normalized_start > normalized_end:
        normalized_start, normalized_end = normalized_end, normalized_start
    return normalized_start, normalized_end


def _build_datetime_range(start_date: date | None, end_date: date | None) -> tuple[datetime | None, datetime | None]:
    if start_date is None and end_date is None:
        return None, None

    normalized_start, normalized_end = _normalize_date_range(start_date, end_date)
    start_dt = datetime.combine(normalized_start, time.min)
    end_dt = datetime.combine(normalized_end + timedelta(days=1), time.min)
    return start_dt, end_dt


def _build_transaction_query(
    db: Session,
    *,
    work_group_id: int | None = None,
    instrument_id: int | None = None,
    reagent_id: int | None = None,
    keyword: str | None = None,
    transaction_type: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
):
    query = (
        db.query(Transaction, Reagent, Instrument, WorkGroup, BatchStock)
        .join(Reagent, Transaction.reagent_id == Reagent.id)
        .join(Instrument, Reagent.instrument_id == Instrument.id)
        .join(WorkGroup, Instrument.work_group_id == WorkGroup.id)
        .outerjoin(BatchStock, Transaction.batch_stock_id == BatchStock.id)
    )

    if work_group_id is not None:
        query = query.filter(WorkGroup.id == work_group_id)
    if instrument_id is not None:
        query = query.filter(Instrument.id == instrument_id)
    if reagent_id is not None:
        query = query.filter(Reagent.id == reagent_id)

    cleaned_keyword = _clean_text(keyword)
    if cleaned_keyword:
        like_pattern = f"%{cleaned_keyword}%"
        query = query.filter(
            or_(
                Reagent.name.ilike(like_pattern),
                Reagent.manufacturer.ilike(like_pattern),
                Instrument.name.ilike(like_pattern),
                WorkGroup.name.ilike(like_pattern),
            )
        )

    normalized_type = _clean_text(transaction_type).upper()
    if normalized_type in {"IN", "OUT"}:
        query = query.filter(Transaction.type == normalized_type)

    start_dt, end_dt = _build_datetime_range(start_date, end_date)
    if start_dt is not None:
        query = query.filter(Transaction.created_at >= start_dt)
    if end_dt is not None:
        query = query.filter(Transaction.created_at < end_dt)

    return query


def _serialize_transaction_row(row) -> TransactionListItem:
    transaction, reagent, instrument, work_group, batch_stock = row
    return TransactionListItem(
        id=transaction.id,
        created_at=transaction.created_at,
        type=transaction.type,
        work_group_id=work_group.id if work_group else None,
        work_group_name=work_group.name if work_group else "",
        instrument_id=instrument.id if instrument else None,
        instrument_name=instrument.name if instrument else "",
        reagent_id=reagent.id,
        reagent_name=reagent.name,
        manufacturer=reagent.manufacturer,
        batch_no=batch_stock.batch_no if batch_stock and batch_stock.batch_no else "",
        quantity_min=_transaction_min_quantity(transaction),
        min_unit=_safe_min_unit(transaction, batch_stock, reagent),
        operator=transaction.operator,
        source=transaction.source,
    )


def _build_usage_query(
    db: Session,
    *,
    work_group_id: int | None = None,
    instrument_id: int | None = None,
    reagent_id: int | None = None,
    keyword: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
):
    query = (
        db.query(
            Reagent.id.label("reagent_id"),
            Reagent.name.label("reagent_name"),
            Reagent.manufacturer.label("manufacturer"),
            Reagent.unit.label("min_unit"),
            Instrument.id.label("instrument_id"),
            Instrument.name.label("instrument_name"),
            WorkGroup.id.label("work_group_id"),
            WorkGroup.name.label("work_group_name"),
            func.coalesce(func.sum(Transaction.quantity), 0).label("total_usage_min"),
        )
        .join(Reagent, Transaction.reagent_id == Reagent.id)
        .join(Instrument, Reagent.instrument_id == Instrument.id)
        .join(WorkGroup, Instrument.work_group_id == WorkGroup.id)
        .filter(Transaction.type == "OUT")
    )

    if work_group_id is not None:
        query = query.filter(WorkGroup.id == work_group_id)
    if instrument_id is not None:
        query = query.filter(Instrument.id == instrument_id)
    if reagent_id is not None:
        query = query.filter(Reagent.id == reagent_id)

    cleaned_keyword = _clean_text(keyword)
    if cleaned_keyword:
        like_pattern = f"%{cleaned_keyword}%"
        query = query.filter(Reagent.name.ilike(like_pattern))

    start_dt, end_dt = _build_datetime_range(start_date, end_date)
    if start_dt is not None:
        query = query.filter(Transaction.created_at >= start_dt)
    if end_dt is not None:
        query = query.filter(Transaction.created_at < end_dt)

    return (
        query.group_by(
            Reagent.id,
            Reagent.name,
            Reagent.manufacturer,
            Reagent.unit,
            Instrument.id,
            Instrument.name,
            WorkGroup.id,
            WorkGroup.name,
        )
        .order_by(func.coalesce(func.sum(Transaction.quantity), 0).desc(), Reagent.name.asc(), Reagent.id.asc())
    )


def _build_reagent_report_query(
    db: Session,
    *,
    work_group_id: int | None = None,
    instrument_id: int | None = None,
    keyword: str | None = None,
):
    query = (
        db.query(Reagent, Instrument, WorkGroup)
        .join(Instrument, Reagent.instrument_id == Instrument.id)
        .join(WorkGroup, Instrument.work_group_id == WorkGroup.id)
        .order_by(WorkGroup.name.asc(), Instrument.name.asc(), Reagent.name.asc(), Reagent.id.asc())
    )

    if work_group_id is not None:
        query = query.filter(WorkGroup.id == work_group_id)
    if instrument_id is not None:
        query = query.filter(Instrument.id == instrument_id)

    cleaned_keyword = _clean_text(keyword)
    if cleaned_keyword:
        like_pattern = f"%{cleaned_keyword}%"
        query = query.filter(Reagent.name.ilike(like_pattern))

    return query


def _usage_filename(start_date: date | None, end_date: date | None) -> str:
    normalized_start, normalized_end = _normalize_date_range(start_date, end_date)
    return f"用量_{normalized_start.isoformat()}_{normalized_end.isoformat()}.xlsx"


def _transactions_filename(start_date: date | None, end_date: date | None) -> str:
    normalized_start, normalized_end = _normalize_date_range(start_date, end_date)
    return f"流水_{normalized_start.isoformat()}_{normalized_end.isoformat()}.xlsx"


def _create_workbook(sheet_name: str, headers: list[str], rows: list[list[object]]) -> BytesIO:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = sheet_name
    sheet.append(headers)
    for row in rows:
        sheet.append(row)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def _excel_response(buffer: BytesIO, filename: str) -> StreamingResponse:
    quoted_filename = quote(filename)
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quoted_filename}",
    }
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.get("/transactions", response_model=list[TransactionListItem])
def list_transactions(
    work_group_id: Optional[int] = Query(None),
    instrument_id: Optional[int] = Query(None),
    reagent_id: Optional[int] = Query(None),
    keyword: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    rows = (
        _build_transaction_query(
            db,
            work_group_id=work_group_id,
            instrument_id=instrument_id,
            reagent_id=reagent_id,
            keyword=keyword,
            transaction_type=type,
            start_date=start_date,
            end_date=end_date,
        )
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_transaction_row(row) for row in rows]


@router.get("/usage", response_model=list[UsageSummaryItem])
def list_usage(
    work_group_id: Optional[int] = Query(None),
    instrument_id: Optional[int] = Query(None),
    reagent_id: Optional[int] = Query(None),
    keyword: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    normalized_start, normalized_end = _normalize_date_range(start_date, end_date)
    rows = _build_usage_query(
        db,
        work_group_id=work_group_id,
        instrument_id=instrument_id,
        reagent_id=reagent_id,
        keyword=keyword,
        start_date=normalized_start,
        end_date=normalized_end,
    ).all()

    return [
        UsageSummaryItem(
            reagent_id=row.reagent_id,
            reagent_name=row.reagent_name,
            manufacturer=row.manufacturer,
            work_group_id=row.work_group_id,
            work_group_name=row.work_group_name or "",
            instrument_id=row.instrument_id,
            instrument_name=row.instrument_name or "",
            start_date=normalized_start,
            end_date=normalized_end,
            total_usage_min=int(row.total_usage_min or 0),
            min_unit=_clean_text(row.min_unit) or "最小单位",
        )
        for row in rows
    ]


@router.get("/reporting/reagents", response_model=list[ReportReagentOption])
def list_reporting_reagents(
    work_group_id: Optional[int] = Query(None),
    instrument_id: Optional[int] = Query(None),
    keyword: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = _build_reagent_report_query(
        db,
        work_group_id=work_group_id,
        instrument_id=instrument_id,
        keyword=keyword,
    ).all()

    return [
        ReportReagentOption(
            id=reagent.id,
            name=reagent.name,
            manufacturer=reagent.manufacturer,
            work_group_id=work_group.id if work_group else None,
            work_group_name=work_group.name if work_group else "",
            instrument_id=instrument.id if instrument else None,
            instrument_name=instrument.name if instrument else "",
            min_unit=_clean_text(reagent.unit) or "最小单位",
            is_archived=bool(reagent.is_archived),
        )
        for reagent, instrument, work_group in rows
    ]


@router.get("/transactions/export")
def export_transactions(
    work_group_id: Optional[int] = Query(None),
    instrument_id: Optional[int] = Query(None),
    reagent_id: Optional[int] = Query(None),
    keyword: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    items = [
        _serialize_transaction_row(row)
        for row in _build_transaction_query(
            db,
            work_group_id=work_group_id,
            instrument_id=instrument_id,
            reagent_id=reagent_id,
            keyword=keyword,
            transaction_type=type,
            start_date=start_date,
            end_date=end_date,
        )
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .all()
    ]
    rows = [
        [
            item.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "入库" if item.type == "IN" else "出库",
            item.work_group_name,
            item.instrument_name,
            item.reagent_name,
            item.batch_no,
            item.quantity_min,
            item.min_unit,
            item.operator,
            "扫码" if item.source == "scan" else "手工",
        ]
        for item in items
    ]
    buffer = _create_workbook(
        "流水",
        ["流水时间", "类型", "工作组", "仪器", "试剂名称", "批号", "数量(最小单位)", "最小单位", "操作人", "来源"],
        rows,
    )
    return _excel_response(buffer, _transactions_filename(start_date, end_date))


@router.get("/usage/export")
def export_usage(
    work_group_id: Optional[int] = Query(None),
    instrument_id: Optional[int] = Query(None),
    reagent_id: Optional[int] = Query(None),
    keyword: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    items = list_usage(
        work_group_id=work_group_id,
        instrument_id=instrument_id,
        reagent_id=reagent_id,
        keyword=keyword,
        start_date=start_date,
        end_date=end_date,
        db=db,
    )
    rows = [
        [
            item.work_group_name,
            item.instrument_name,
            item.reagent_name,
            item.manufacturer or "",
            item.start_date.isoformat(),
            item.end_date.isoformat(),
            item.total_usage_min,
            item.min_unit,
        ]
        for item in items
    ]
    buffer = _create_workbook(
        "用量",
        ["工作组", "仪器", "试剂名称", "厂家", "开始日期", "结束日期", "用量合计(最小单位)", "最小单位"],
        rows,
    )
    return _excel_response(buffer, _usage_filename(start_date, end_date))
