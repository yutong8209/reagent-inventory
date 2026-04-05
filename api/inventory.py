from datetime import date, datetime, time, timedelta
from io import BytesIO
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from db import get_db
from models import BatchStock, Instrument, Operator, ParseLog, Reagent, Transaction, UnitOption, WorkGroup
from schemas import (
    BatchInfo,
    InstrumentCatalogItem,
    InstrumentCreate,
    InstrumentInfo,
    InstrumentUpdate,
    InstrumentWarningDefaultsUpdate,
    ClearTransactionsRequest,
    OperatorCreate,
    OperatorResponse,
    OperatorUpdate,
    ReagentCatalogItem,
    ReagentInfo,
    ReagentUpdate,
    ReagentWarningSettingsUpdate,
    UnitOptionCreate,
    UnitOptionResponse,
    UnitOptionUpdate,
    WorkGroupCatalogItem,
    WorkGroupCreate,
    WorkGroupInfo,
    WorkGroupUpdate,
)

router = APIRouter()

EXPORT_HEADERS = [
    "工作组",
    "仪器名称",
    "仪器型号",
    "试剂名称",
    "厂家",
    "试剂状态",
    "失效预警天数",
    "库存预警最小单位数",
    "总库存最小单位数",
    "最小单位",
    "最近效期",
    "距最近效期天数",
    "批次数",
    "最近出入库时间",
    "批号",
    "该批号库存最小单位数",
    "批号有效期",
    "该批号距失效天数",
    "是否过期",
    "包装单位",
    "每包装对应最小单位数",
    "整包装数量",
    "散装最小单位数量",
    "批次入库时间",
]
RED_FILL = PatternFill(fill_type="solid", fgColor="FDECEC")
YELLOW_FILL = PatternFill(fill_type="solid", fgColor="FFF6CF")
HEADER_FILL = PatternFill(fill_type="solid", fgColor="E8EEF7")
STATUS_RED_LEVELS = {"empty", "expired"}
STATUS_YELLOW_LEVELS = {"expiring", "low"}
STATUS_LABELS = {
    "empty": "零库存",
    "expired": "已过期",
    "expiring": "近效期",
    "low": "低库存",
    "normal": "正常",
}


def _clean_text(value: str | None) -> str:
    return (value or "").strip()


def _normalize_name(value: str | None) -> str:
    return "".join(_clean_text(value).lower().split())


def _safe_int(value: int | None, fallback: int) -> int:
    if value is None:
        return fallback
    return max(value, 0)


def _unit_option_sort_key(option: UnitOption):
    scope_priority = {"both": 0, "package": 1, "min": 2}
    return (
        option.sort_order if option.sort_order is not None else 100,
        scope_priority.get(option.scope, 9),
        option.name.lower(),
        option.id,
    )


def _unit_option_matches_scope(option_scope: str, scope: str | None) -> bool:
    if not scope:
        return True
    if scope == "package":
        return option_scope in {"package", "both"}
    if scope == "min":
        return option_scope in {"min", "both"}
    return True


def _days_until(target: date) -> int:
    return (target - date.today()).days


def _batch_total_min_units(batch: BatchStock) -> int:
    ratio = batch.package_to_min_qty if batch.package_to_min_qty and batch.package_to_min_qty > 0 else 1
    return (batch.quantity * ratio) + (batch.loose_min_quantity or 0)


def _reagent_total_min_units(db: Session, reagent_id: int) -> int:
    batches = db.query(BatchStock).filter(BatchStock.reagent_id == reagent_id).all()
    return sum(_batch_total_min_units(batch) for batch in batches)


def _effective_warning_values(reagent: Reagent) -> tuple[int, int, str]:
    instrument = reagent.instrument
    if reagent.follow_instrument and instrument:
        return (
            _safe_int(instrument.default_warning_days, 30),
            _safe_int(instrument.default_warning_stock, 5),
            "instrument",
        )

    return (
        _safe_int(reagent.warning_days, 30),
        _safe_int(reagent.warning_stock, 5),
        "reagent",
    )


def _build_status_level(
    *,
    has_expired_batch: bool,
    nearest_expiry_days: int | None,
    effective_warning_days: int,
    total_min_quantity: int,
    effective_warning_stock: int,
) -> str:
    if total_min_quantity <= 0:
        return "empty"
    if has_expired_batch:
        return "expired"
    if nearest_expiry_days is not None and nearest_expiry_days <= effective_warning_days:
        return "expiring"
    if total_min_quantity <= effective_warning_stock:
        return "low"
    return "normal"


def _apply_transaction_filters(query, filters: ClearTransactionsRequest):
    if filters.work_group_id is not None:
        query = query.join(Reagent, Transaction.reagent_id == Reagent.id)
        query = query.join(Instrument, Reagent.instrument_id == Instrument.id)
        query = query.filter(Instrument.work_group_id == filters.work_group_id)
        if filters.instrument_id is not None:
            query = query.filter(Instrument.id == filters.instrument_id)
    elif filters.instrument_id is not None:
        query = query.join(Reagent, Transaction.reagent_id == Reagent.id)
        query = query.filter(Reagent.instrument_id == filters.instrument_id)

    if filters.reagent_id is not None:
        query = query.filter(Transaction.reagent_id == filters.reagent_id)

    if filters.start_date is not None:
        query = query.filter(Transaction.created_at >= datetime.combine(filters.start_date, time.min))

    if filters.end_date is not None:
        query = query.filter(Transaction.created_at < datetime.combine(filters.end_date + timedelta(days=1), time.min))

    return query


def _serialize_batch(batch: BatchStock) -> BatchInfo:
    return BatchInfo(
        id=batch.id,
        batch_no=batch.batch_no,
        expiry_date=batch.expiry_date.isoformat(),
        expiry_days_left=_days_until(batch.expiry_date),
        quantity=batch.quantity,
        loose_min_quantity=batch.loose_min_quantity or 0,
        available_min_quantity=_batch_total_min_units(batch),
        package_unit=batch.package_unit,
        min_unit=batch.min_unit,
        package_to_min_qty=batch.package_to_min_qty,
        is_expired=batch.expiry_date < date.today(),
        created_at=batch.created_at,
    )


def _serialize_reagent(reagent: Reagent) -> ReagentCatalogItem:
    instrument = reagent.instrument
    work_group = instrument.work_group if instrument else None
    effective_warning_days, effective_warning_stock, warning_source = _effective_warning_values(reagent)
    return ReagentCatalogItem(
        id=reagent.id,
        instrument_id=reagent.instrument_id,
        instrument_name=instrument.name if instrument else "",
        work_group_id=work_group.id if work_group else 0,
        work_group_name=work_group.name if work_group else "",
        name=reagent.name,
        manufacturer=reagent.manufacturer,
        unit=reagent.unit,
        package_unit=reagent.package_unit,
        package_to_min_qty=reagent.package_to_min_qty,
        warning_days=reagent.warning_days,
        warning_stock=reagent.warning_stock,
        follow_instrument=reagent.follow_instrument,
        is_archived=bool(reagent.is_archived),
        effective_warning_days=effective_warning_days,
        effective_warning_stock=effective_warning_stock,
        warning_source=warning_source,
    )


def _build_catalog(db: Session) -> list[WorkGroupCatalogItem]:
    work_groups = db.query(WorkGroup).order_by(WorkGroup.id.asc()).all()
    instruments = (
        db.query(Instrument)
        .order_by(Instrument.work_group_id.asc(), Instrument.id.asc())
        .all()
    )

    instruments_by_group: dict[int, list[InstrumentCatalogItem]] = {}
    for instrument in instruments:
        instruments_by_group.setdefault(instrument.work_group_id, []).append(
            InstrumentCatalogItem(
                id=instrument.id,
                work_group_id=instrument.work_group_id,
                name=instrument.name,
                model=instrument.model,
                default_warning_days=_safe_int(instrument.default_warning_days, 30),
                default_warning_stock=_safe_int(instrument.default_warning_stock, 5),
            )
        )

    return [
        WorkGroupCatalogItem(
            id=work_group.id,
            name=work_group.name,
            instruments=instruments_by_group.get(work_group.id, []),
        )
        for work_group in work_groups
    ]


def _build_reagent_info(
    reagent: Reagent,
    batches: list[BatchStock],
    last_transaction_at,
) -> ReagentInfo:
    batch_items = [_serialize_batch(batch) for batch in batches]
    total_package_quantity = sum(batch.quantity for batch in batches)
    total_min_quantity = sum(batch.available_min_quantity for batch in batch_items)
    nearest_expiry = batch_items[0] if batch_items else None
    effective_warning_days, effective_warning_stock, warning_source = _effective_warning_values(reagent)
    has_expired_batch = any(batch.is_expired for batch in batch_items)
    nearest_expiry_days = nearest_expiry.expiry_days_left if nearest_expiry else None
    has_expiring_soon = (
        not has_expired_batch
        and nearest_expiry_days is not None
        and nearest_expiry_days <= effective_warning_days
    )
    is_low_stock = total_min_quantity <= effective_warning_stock
    status_level = _build_status_level(
        has_expired_batch=has_expired_batch,
        nearest_expiry_days=nearest_expiry_days,
        effective_warning_days=effective_warning_days,
        total_min_quantity=total_min_quantity,
        effective_warning_stock=effective_warning_stock,
    )

    return ReagentInfo(
        id=reagent.id,
        instrument_id=reagent.instrument_id,
        name=reagent.name,
        unit=reagent.unit,
        package_unit=reagent.package_unit,
        package_to_min_qty=reagent.package_to_min_qty,
        manufacturer=reagent.manufacturer,
        warning_days=reagent.warning_days,
        warning_stock=reagent.warning_stock,
        effective_warning_days=effective_warning_days,
        effective_warning_stock=effective_warning_stock,
        warning_source=warning_source,
        follow_instrument=reagent.follow_instrument,
        total_package_quantity=total_package_quantity,
        total_min_quantity=total_min_quantity,
        batch_count=len(batch_items),
        nearest_expiry_date=nearest_expiry.expiry_date if nearest_expiry else None,
        nearest_expiry_days=nearest_expiry_days,
        has_expired_batch=has_expired_batch,
        has_expiring_soon=has_expiring_soon,
        is_low_stock=is_low_stock,
        status_level=status_level,
        last_transaction_at=last_transaction_at,
        batches=batch_items,
    )


def _status_sort_key(reagent: ReagentInfo):
    level_priority = {
        "empty": 0,
        "expired": 1,
        "expiring": 2,
        "low": 3,
        "normal": 4,
    }
    return (
        level_priority.get(reagent.status_level, 99),
        reagent.nearest_expiry_days if reagent.nearest_expiry_days is not None else 10**9,
        reagent.name,
        reagent.id,
    )


def _query_inventory_data(
    db: Session,
    *,
    work_group_id: int | None = None,
    instrument_id: int | None = None,
) -> list[WorkGroupInfo]:
    work_groups_query = db.query(WorkGroup).order_by(WorkGroup.id.asc())
    if work_group_id is not None:
        work_groups_query = work_groups_query.filter(WorkGroup.id == work_group_id)
    work_groups = work_groups_query.all()

    instruments_query = db.query(Instrument).order_by(Instrument.work_group_id.asc(), Instrument.id.asc())
    if work_group_id is not None:
        instruments_query = instruments_query.filter(Instrument.work_group_id == work_group_id)
    if instrument_id is not None:
        instruments_query = instruments_query.filter(Instrument.id == instrument_id)

    instruments = instruments_query.all()
    instruments_by_group: dict[int, list[Instrument]] = {}
    for instrument in instruments:
        instruments_by_group.setdefault(instrument.work_group_id, []).append(instrument)

    last_transaction_rows = (
        db.query(Transaction.reagent_id, func.max(Transaction.created_at))
        .group_by(Transaction.reagent_id)
        .all()
    )
    last_transactions = {reagent_id: last_created_at for reagent_id, last_created_at in last_transaction_rows}

    result: list[WorkGroupInfo] = []
    for work_group in work_groups:
        group_instruments = []
        for instrument in instruments_by_group.get(work_group.id, []):
            reagents = (
                db.query(Reagent)
                .filter(
                    Reagent.instrument_id == instrument.id,
                    Reagent.is_archived.is_(False),
                )
                .order_by(Reagent.name.asc(), Reagent.id.asc())
                .all()
            )

            reagent_items: list[ReagentInfo] = []
            for reagent in reagents:
                batches = (
                    db.query(BatchStock)
                    .filter(BatchStock.reagent_id == reagent.id)
                    .order_by(BatchStock.expiry_date.asc(), BatchStock.created_at.asc(), BatchStock.id.asc())
                    .all()
                )
                if not batches:
                    continue

                reagent_items.append(
                    _build_reagent_info(
                        reagent,
                        batches,
                        last_transactions.get(reagent.id),
                    )
                )

            reagent_items.sort(key=_status_sort_key)
            group_instruments.append(
                InstrumentInfo(
                    id=instrument.id,
                    name=instrument.name,
                    model=instrument.model,
                    default_warning_days=_safe_int(instrument.default_warning_days, 30),
                    default_warning_stock=_safe_int(instrument.default_warning_stock, 5),
                    reagents=reagent_items,
                )
            )

        result.append(
            WorkGroupInfo(
                id=work_group.id,
                name=work_group.name,
                instruments=group_instruments,
            )
        )

    return result


def _sanitize_sheet_title(name: str, used_titles: set[str]) -> str:
    cleaned = "".join("_" if ch in '[]:*?/\\' else ch for ch in (name or "工作组")).strip() or "工作组"
    base = cleaned[:31]
    title = base
    index = 1
    while title in used_titles:
        suffix = f"_{index}"
        title = f"{base[: max(0, 31 - len(suffix))]}{suffix}" or f"Sheet{index}"
        index += 1
    used_titles.add(title)
    return title


def _format_export_datetime(value) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        return value
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _export_scope_label(
    db: Session,
    *,
    work_group_id: int | None,
    instrument_id: int | None,
) -> str:
    if instrument_id is not None:
        instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
        if instrument:
            return instrument.name
    if work_group_id is not None:
        work_group = db.query(WorkGroup).filter(WorkGroup.id == work_group_id).first()
        if work_group:
            return work_group.name
    return "全部工作组"


def _build_export_rows(group: WorkGroupInfo) -> list[list[str | int]]:
    rows: list[list[str | int]] = []
    instruments = sorted(group.instruments, key=lambda item: (item.name, item.id))
    for instrument in instruments:
        reagents = sorted(
            instrument.reagents,
            key=lambda item: (
                instrument.name,
                item.name,
                _status_sort_key(item),
            ),
        )
        for reagent in reagents:
            for batch in reagent.batches:
                rows.append([
                    group.name,
                    instrument.name,
                    instrument.model or "",
                    reagent.name,
                    reagent.manufacturer or "",
                    STATUS_LABELS.get(reagent.status_level, reagent.status_level),
                    reagent.effective_warning_days,
                    reagent.effective_warning_stock,
                    reagent.total_min_quantity,
                    reagent.unit,
                    reagent.nearest_expiry_date or "",
                    reagent.nearest_expiry_days if reagent.nearest_expiry_days is not None else "",
                    reagent.batch_count,
                    _format_export_datetime(reagent.last_transaction_at),
                    batch.batch_no,
                    batch.available_min_quantity,
                    batch.expiry_date,
                    batch.expiry_days_left,
                    "是" if batch.is_expired else "否",
                    batch.package_unit,
                    batch.package_to_min_qty,
                    batch.quantity,
                    batch.loose_min_quantity,
                    _format_export_datetime(batch.created_at),
                ])
    return rows


def _apply_export_styles(worksheet):
    header_font = Font(bold=True)
    for cell in worksheet[1]:
        cell.font = header_font
        cell.fill = HEADER_FILL
    worksheet.freeze_panes = "A2"
    worksheet.auto_filter.ref = worksheet.dimensions

    status_col = 6
    for row_index in range(2, worksheet.max_row + 1):
        status_value = worksheet.cell(row=row_index, column=status_col).value
        if status_value in {STATUS_LABELS[level] for level in STATUS_RED_LEVELS}:
            worksheet.cell(row=row_index, column=status_col).fill = RED_FILL
        elif status_value in {STATUS_LABELS[level] for level in STATUS_YELLOW_LEVELS}:
            worksheet.cell(row=row_index, column=status_col).fill = YELLOW_FILL

    for column_cells in worksheet.columns:
        max_length = max(len(str(cell.value or "")) for cell in column_cells)
        worksheet.column_dimensions[column_cells[0].column_letter].width = min(max(max_length + 2, 10), 28)


def _build_inventory_export_workbook(
    db: Session,
    *,
    work_group_id: int | None,
    instrument_id: int | None,
) -> tuple[BytesIO, str]:
    inventory_data = _query_inventory_data(
        db,
        work_group_id=work_group_id,
        instrument_id=instrument_id,
    )
    workbook = Workbook()
    workbook.remove(workbook.active)
    used_titles: set[str] = set()

    for group in inventory_data:
        sheet = workbook.create_sheet(title=_sanitize_sheet_title(group.name, used_titles))
        sheet.append(EXPORT_HEADERS)
        rows = _build_export_rows(group)
        if rows:
            for row in rows:
                sheet.append(row)
        _apply_export_styles(sheet)

    if not workbook.sheetnames:
        sheet = workbook.create_sheet(title="库存")
        sheet.append(EXPORT_HEADERS)
        _apply_export_styles(sheet)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    scope_label = _export_scope_label(db, work_group_id=work_group_id, instrument_id=instrument_id)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"库存导出_{scope_label}_{timestamp}.xlsx"
    return buffer, filename


def _validate_reagent_payload(
    *,
    db: Session,
    instrument_id: int,
    name: str,
    exclude_reagent_id: int | None = None,
) -> tuple[Instrument, str]:
    instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
    if not instrument:
        raise HTTPException(status_code=400, detail=f"仪器 ID {instrument_id} 不存在")

    cleaned_name = _clean_text(name)
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="试剂名称不能为空")

    normalized_name = _normalize_name(cleaned_name)
    existing = db.query(Reagent).filter(Reagent.instrument_id == instrument_id).all()
    for reagent in existing:
        if exclude_reagent_id is not None and reagent.id == exclude_reagent_id:
            continue
        if _normalize_name(reagent.name) == normalized_name:
            raise HTTPException(
                status_code=400,
                detail=f"仪器“{instrument.name}”下已存在同名试剂“{reagent.name}”",
            )

    return instrument, cleaned_name


@router.get("/inventory", response_model=List[WorkGroupInfo])
def get_inventory(
    instrument_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    return _query_inventory_data(db, instrument_id=instrument_id)


@router.get("/inventory/export")
def export_inventory(
    work_group_id: int | None = Query(None),
    instrument_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    if instrument_id is not None:
        instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
        if not instrument:
            raise HTTPException(status_code=404, detail="仪器不存在")
        if work_group_id is not None and instrument.work_group_id != work_group_id:
            raise HTTPException(status_code=400, detail="所选仪器不属于当前工作组")
        work_group_id = instrument.work_group_id
    elif work_group_id is not None:
        work_group = db.query(WorkGroup).filter(WorkGroup.id == work_group_id).first()
        if not work_group:
            raise HTTPException(status_code=404, detail="工作组不存在")

    buffer, filename = _build_inventory_export_workbook(
        db,
        work_group_id=work_group_id,
        instrument_id=instrument_id,
    )
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
    }
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.get("/work-groups")
def get_work_groups(db: Session = Depends(get_db)):
    work_groups = db.query(WorkGroup).order_by(WorkGroup.id.asc()).all()
    return [{"id": work_group.id, "name": work_group.name} for work_group in work_groups]


@router.get("/catalog/work-groups", response_model=List[WorkGroupCatalogItem])
def get_work_group_catalog(db: Session = Depends(get_db)):
    return _build_catalog(db)


@router.post("/work-groups", response_model=WorkGroupCatalogItem, status_code=201)
def create_work_group(data: WorkGroupCreate, db: Session = Depends(get_db)):
    name = _clean_text(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="工作组名称不能为空")

    existing = db.query(WorkGroup).filter(WorkGroup.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"工作组“{name}”已存在")

    work_group = WorkGroup(name=name)
    db.add(work_group)
    db.commit()
    db.refresh(work_group)

    return WorkGroupCatalogItem(id=work_group.id, name=work_group.name, instruments=[])


@router.put("/work-groups/{work_group_id}", response_model=WorkGroupCatalogItem)
def update_work_group(work_group_id: int, data: WorkGroupUpdate, db: Session = Depends(get_db)):
    work_group = db.query(WorkGroup).filter(WorkGroup.id == work_group_id).first()
    if not work_group:
        raise HTTPException(status_code=404, detail="工作组不存在")

    name = _clean_text(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="工作组名称不能为空")

    existing = (
        db.query(WorkGroup)
        .filter(WorkGroup.name == name, WorkGroup.id != work_group_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"工作组“{name}”已存在")

    work_group.name = name
    db.commit()
    db.refresh(work_group)

    instruments = (
        db.query(Instrument)
        .filter(Instrument.work_group_id == work_group.id)
        .order_by(Instrument.id.asc())
        .all()
    )
    return WorkGroupCatalogItem(
        id=work_group.id,
        name=work_group.name,
        instruments=[
            InstrumentCatalogItem(
                id=instrument.id,
                work_group_id=instrument.work_group_id,
                name=instrument.name,
                model=instrument.model,
                default_warning_days=_safe_int(instrument.default_warning_days, 30),
                default_warning_stock=_safe_int(instrument.default_warning_stock, 5),
            )
            for instrument in instruments
        ],
    )


@router.get("/instruments")
def get_instruments(
    work_group_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Instrument).order_by(Instrument.work_group_id.asc(), Instrument.id.asc())
    if work_group_id:
        query = query.filter(Instrument.work_group_id == work_group_id)

    instruments = query.all()
    return [
        {
            "id": instrument.id,
            "name": instrument.name,
            "model": instrument.model,
            "work_group_id": instrument.work_group_id,
            "default_warning_days": _safe_int(instrument.default_warning_days, 30),
            "default_warning_stock": _safe_int(instrument.default_warning_stock, 5),
        }
        for instrument in instruments
    ]


@router.post("/instruments", response_model=InstrumentCatalogItem, status_code=201)
def create_instrument(data: InstrumentCreate, db: Session = Depends(get_db)):
    work_group = db.query(WorkGroup).filter(WorkGroup.id == data.work_group_id).first()
    if not work_group:
        raise HTTPException(status_code=400, detail="所属工作组不存在")

    name = _clean_text(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="仪器名称不能为空")

    existing = (
        db.query(Instrument)
        .filter(Instrument.work_group_id == data.work_group_id, Instrument.name == name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"工作组“{work_group.name}”下已存在仪器“{name}”")

    instrument = Instrument(
        work_group_id=data.work_group_id,
        name=name,
        model=_clean_text(data.model) or None,
        default_warning_days=_safe_int(data.default_warning_days, 30),
        default_warning_stock=_safe_int(data.default_warning_stock, 5),
    )
    db.add(instrument)
    db.commit()
    db.refresh(instrument)

    return InstrumentCatalogItem(
        id=instrument.id,
        work_group_id=instrument.work_group_id,
        name=instrument.name,
        model=instrument.model,
        default_warning_days=_safe_int(instrument.default_warning_days, 30),
        default_warning_stock=_safe_int(instrument.default_warning_stock, 5),
    )


@router.put("/instruments/{instrument_id}", response_model=InstrumentCatalogItem)
def update_instrument(instrument_id: int, data: InstrumentUpdate, db: Session = Depends(get_db)):
    instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
    if not instrument:
        raise HTTPException(status_code=404, detail="仪器不存在")

    work_group = db.query(WorkGroup).filter(WorkGroup.id == data.work_group_id).first()
    if not work_group:
        raise HTTPException(status_code=400, detail="所属工作组不存在")

    name = _clean_text(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="仪器名称不能为空")

    existing = (
        db.query(Instrument)
        .filter(
            Instrument.work_group_id == data.work_group_id,
            Instrument.name == name,
            Instrument.id != instrument_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"工作组“{work_group.name}”下已存在仪器“{name}”")

    instrument.work_group_id = data.work_group_id
    instrument.name = name
    instrument.model = _clean_text(data.model) or None
    instrument.default_warning_days = _safe_int(data.default_warning_days, 30)
    instrument.default_warning_stock = _safe_int(data.default_warning_stock, 5)
    db.commit()
    db.refresh(instrument)

    return InstrumentCatalogItem(
        id=instrument.id,
        work_group_id=instrument.work_group_id,
        name=instrument.name,
        model=instrument.model,
        default_warning_days=_safe_int(instrument.default_warning_days, 30),
        default_warning_stock=_safe_int(instrument.default_warning_stock, 5),
    )


@router.put("/instruments/{instrument_id}/warning-defaults", response_model=InstrumentCatalogItem)
def update_instrument_warning_defaults(
    instrument_id: int,
    data: InstrumentWarningDefaultsUpdate,
    db: Session = Depends(get_db),
):
    instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
    if not instrument:
        raise HTTPException(status_code=404, detail="仪器不存在")

    instrument.default_warning_days = _safe_int(data.default_warning_days, 30)
    instrument.default_warning_stock = _safe_int(data.default_warning_stock, 5)
    db.commit()
    db.refresh(instrument)

    return InstrumentCatalogItem(
        id=instrument.id,
        work_group_id=instrument.work_group_id,
        name=instrument.name,
        model=instrument.model,
        default_warning_days=_safe_int(instrument.default_warning_days, 30),
        default_warning_stock=_safe_int(instrument.default_warning_stock, 5),
    )


@router.post("/instruments/{instrument_id}/warning-defaults/apply")
def apply_instrument_warning_defaults(
    instrument_id: int,
    db: Session = Depends(get_db),
):
    instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
    if not instrument:
        raise HTTPException(status_code=404, detail="仪器不存在")

    updated_count = (
        db.query(Reagent)
        .filter(Reagent.instrument_id == instrument_id)
        .update({Reagent.follow_instrument: True}, synchronize_session=False)
    )
    db.commit()
    return {"success": True, "updated_count": updated_count}


@router.post("/instruments/{instrument_id}/warning-batch-update")
def batch_update_instrument_warnings(
    instrument_id: int,
    data: InstrumentWarningDefaultsUpdate,
    db: Session = Depends(get_db),
):
    instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
    if not instrument:
        raise HTTPException(status_code=404, detail="仪器不存在")

    warning_days = _safe_int(data.default_warning_days, 30)
    warning_stock = _safe_int(data.default_warning_stock, 5)
    instrument.default_warning_days = warning_days
    instrument.default_warning_stock = warning_stock

    updated_count = (
        db.query(Reagent)
        .filter(Reagent.instrument_id == instrument_id)
        .update(
            {
                Reagent.warning_days: warning_days,
                Reagent.warning_stock: warning_stock,
                Reagent.follow_instrument: False,
            },
            synchronize_session=False,
        )
    )
    db.commit()

    return {
        "success": True,
        "updated_count": updated_count,
        "default_warning_days": warning_days,
        "default_warning_stock": warning_stock,
    }


@router.get("/reagents", response_model=List[ReagentCatalogItem])
def get_reagents(
    work_group_id: Optional[int] = None,
    instrument_id: Optional[int] = None,
    keyword: Optional[str] = None,
    status: str = Query(default="active"),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Reagent)
        .join(Instrument, Reagent.instrument_id == Instrument.id)
        .join(WorkGroup, Instrument.work_group_id == WorkGroup.id)
        .order_by(WorkGroup.id.asc(), Instrument.id.asc(), Reagent.name.asc(), Reagent.id.asc())
    )

    if status == "active":
        query = query.filter(Reagent.is_archived.is_(False))
    elif status == "archived":
        query = query.filter(Reagent.is_archived.is_(True))
    elif status != "all":
        raise HTTPException(status_code=400, detail="状态筛选仅支持 active、archived 或 all")

    if work_group_id:
        query = query.filter(Instrument.work_group_id == work_group_id)

    if instrument_id:
        query = query.filter(Reagent.instrument_id == instrument_id)

    cleaned_keyword = _clean_text(keyword)
    if cleaned_keyword:
        query = query.filter(func.lower(Reagent.name).like(f"%{cleaned_keyword.lower()}%"))

    return [_serialize_reagent(reagent) for reagent in query.all()]


@router.put("/reagents/{reagent_id}", response_model=ReagentCatalogItem)
def update_reagent(reagent_id: int, data: ReagentUpdate, db: Session = Depends(get_db)):
    reagent = db.query(Reagent).filter(Reagent.id == reagent_id).first()
    if not reagent:
        raise HTTPException(status_code=404, detail="试剂不存在")

    instrument, name = _validate_reagent_payload(
        db=db,
        instrument_id=data.instrument_id,
        name=data.name,
        exclude_reagent_id=reagent_id,
    )

    reagent.instrument_id = instrument.id
    reagent.name = name
    reagent.manufacturer = _clean_text(data.manufacturer) or None
    reagent.unit = _clean_text(data.unit) or reagent.unit
    reagent.package_unit = _clean_text(data.package_unit) or reagent.package_unit
    reagent.package_to_min_qty = data.package_to_min_qty
    reagent.warning_days = _safe_int(data.warning_days, 30)
    reagent.warning_stock = _safe_int(data.warning_stock, 5)
    reagent.follow_instrument = bool(data.follow_instrument)
    db.commit()
    db.refresh(reagent)

    return _serialize_reagent(reagent)


@router.put("/reagents/{reagent_id}/warning-settings", response_model=ReagentCatalogItem)
def update_reagent_warning_settings(
    reagent_id: int,
    data: ReagentWarningSettingsUpdate,
    db: Session = Depends(get_db),
):
    reagent = db.query(Reagent).filter(Reagent.id == reagent_id).first()
    if not reagent:
        raise HTTPException(status_code=404, detail="试剂不存在")

    reagent.follow_instrument = bool(data.follow_instrument)
    reagent.warning_days = _safe_int(data.warning_days, 30)
    reagent.warning_stock = _safe_int(data.warning_stock, 5)
    db.commit()
    db.refresh(reagent)

    return _serialize_reagent(reagent)


@router.post("/reagents/{reagent_id}/archive")
def archive_reagent(reagent_id: int, db: Session = Depends(get_db)):
    reagent = (
        db.query(Reagent)
        .filter(Reagent.id == reagent_id, Reagent.is_archived.is_(False))
        .first()
    )
    if not reagent:
        raise HTTPException(status_code=404, detail="试剂不存在")

    total_min_quantity = _reagent_total_min_units(db, reagent_id)
    if total_min_quantity > 0:
        raise HTTPException(status_code=400, detail="仅支持归档零库存试剂")

    reagent.is_archived = True
    db.commit()
    return {"success": True, "reagent_id": reagent_id}


@router.post("/reagents/{reagent_id}/restore")
def restore_reagent(reagent_id: int, db: Session = Depends(get_db)):
    reagent = (
        db.query(Reagent)
        .filter(Reagent.id == reagent_id, Reagent.is_archived.is_(True))
        .first()
    )
    if not reagent:
        raise HTTPException(status_code=404, detail="试剂不存在或未归档")

    reagent.is_archived = False
    db.commit()
    return {"success": True, "reagent_id": reagent_id}


@router.post("/reagents/archive-zero-stock")
def archive_zero_stock_reagents(db: Session = Depends(get_db)):
    reagents = db.query(Reagent).filter(Reagent.is_archived.is_(False)).all()
    archived_ids: list[int] = []

    for reagent in reagents:
        if _reagent_total_min_units(db, reagent.id) <= 0:
            reagent.is_archived = True
            archived_ids.append(reagent.id)

    db.commit()
    return {"success": True, "archived_count": len(archived_ids), "reagent_ids": archived_ids}


@router.get("/unit-options", response_model=List[UnitOptionResponse])
def get_unit_options(
    scope: Optional[str] = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    cleaned_scope = _clean_text(scope).lower() or None
    if cleaned_scope not in {None, "package", "min", "all"}:
        raise HTTPException(status_code=400, detail="单位类型仅支持 package、min 或 all")

    query = db.query(UnitOption)
    if not include_inactive:
        query = query.filter(UnitOption.is_active.is_(True))

    options = query.all()
    if cleaned_scope and cleaned_scope != "all":
        options = [item for item in options if _unit_option_matches_scope(item.scope, cleaned_scope)]

    options.sort(key=_unit_option_sort_key)
    return options


@router.post("/unit-options", response_model=UnitOptionResponse, status_code=201)
def create_unit_option(data: UnitOptionCreate, db: Session = Depends(get_db)):
    name = _clean_text(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="单位名称不能为空")

    existing = db.query(UnitOption).filter(func.lower(UnitOption.name) == name.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"单位“{name}”已存在")

    option = UnitOption(
        name=name,
        scope=data.scope,
        is_active=data.is_active,
        sort_order=_safe_int(data.sort_order, 100),
    )
    db.add(option)
    db.commit()
    db.refresh(option)
    return option


@router.put("/unit-options/{option_id}", response_model=UnitOptionResponse)
def update_unit_option(option_id: int, data: UnitOptionUpdate, db: Session = Depends(get_db)):
    option = db.query(UnitOption).filter(UnitOption.id == option_id).first()
    if not option:
        raise HTTPException(status_code=404, detail="单位选项不存在")

    name = _clean_text(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="单位名称不能为空")

    existing = (
        db.query(UnitOption)
        .filter(func.lower(UnitOption.name) == name.lower(), UnitOption.id != option_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"单位“{name}”已存在")

    option.name = name
    option.scope = data.scope
    option.is_active = bool(data.is_active)
    option.sort_order = _safe_int(data.sort_order, 100)
    db.commit()
    db.refresh(option)
    return option


@router.get("/operators", response_model=List[OperatorResponse])
def get_operators(db: Session = Depends(get_db)):
    return db.query(Operator).order_by(Operator.is_active.desc(), Operator.name.asc()).all()


@router.post("/operators", response_model=OperatorResponse, status_code=201)
def create_operator(data: OperatorCreate, db: Session = Depends(get_db)):
    name = _clean_text(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="操作人名称不能为空")

    existing = db.query(Operator).filter(func.lower(Operator.name) == name.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"操作人“{name}”已存在")

    operator = Operator(name=name, is_active=bool(data.is_active))
    db.add(operator)
    db.commit()
    db.refresh(operator)
    return operator


@router.put("/operators/{operator_id}", response_model=OperatorResponse)
def update_operator(operator_id: int, data: OperatorUpdate, db: Session = Depends(get_db)):
    operator = db.query(Operator).filter(Operator.id == operator_id).first()
    if not operator:
        raise HTTPException(status_code=404, detail="操作人不存在")

    name = _clean_text(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="操作人名称不能为空")

    existing = (
        db.query(Operator)
        .filter(func.lower(Operator.name) == name.lower(), Operator.id != operator_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"操作人“{name}”已存在")

    operator.name = name
    operator.is_active = data.is_active
    db.commit()
    db.refresh(operator)
    return operator


@router.post("/admin/reset-reagent-data")
def reset_reagent_data(db: Session = Depends(get_db)):
    db.query(Transaction).delete(synchronize_session=False)
    db.query(BatchStock).delete(synchronize_session=False)
    db.query(ParseLog).delete(synchronize_session=False)
    db.query(Reagent).delete(synchronize_session=False)
    db.commit()

    try:
        db.execute(
            text(
                "DELETE FROM sqlite_sequence WHERE name IN ('transactions', 'batch_stocks', 'parse_logs', 'reagents')"
            )
        )
        db.commit()
    except Exception:
        db.rollback()

    return {"success": True}


@router.post("/admin/clear-stock")
def clear_stock(db: Session = Depends(get_db)):
    transaction_batch_links_cleared = (
        db.query(Transaction)
        .filter(Transaction.batch_stock_id.is_not(None))
        .update({Transaction.batch_stock_id: None}, synchronize_session=False)
    )
    cleared_count = db.query(BatchStock).delete(synchronize_session=False)
    db.commit()

    try:
        db.execute(text("DELETE FROM sqlite_sequence WHERE name = 'batch_stocks'"))
        db.commit()
    except Exception:
        db.rollback()

    return {
        "success": True,
        "cleared_batch_count": cleared_count,
        "cleared_transaction_batch_links": transaction_batch_links_cleared,
    }


@router.post("/admin/clear-transactions")
def clear_transactions(data: ClearTransactionsRequest, db: Session = Depends(get_db)):
    if data.start_date and data.end_date and data.start_date > data.end_date:
        raise HTTPException(status_code=400, detail="开始日期不能晚于结束日期")

    query = db.query(Transaction)
    query = _apply_transaction_filters(query, data)

    transaction_ids = [item.id for item in query.with_entities(Transaction.id).all()]
    if not transaction_ids:
        return {"success": True, "deleted_count": 0}

    deleted_count = (
        db.query(Transaction)
        .filter(Transaction.id.in_(transaction_ids))
        .delete(synchronize_session=False)
    )
    db.commit()

    return {"success": True, "deleted_count": deleted_count}
