from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from db import get_db
from models import BatchStock, Instrument, Operator, ParseLog, Reagent, Transaction, WorkGroup
from schemas import (
    BatchInfo,
    InstrumentCatalogItem,
    InstrumentCreate,
    InstrumentInfo,
    InstrumentUpdate,
    InstrumentWarningDefaultsUpdate,
    OperatorCreate,
    OperatorResponse,
    OperatorUpdate,
    ReagentCatalogItem,
    ReagentInfo,
    ReagentUpdate,
    ReagentWarningSettingsUpdate,
    WorkGroupCatalogItem,
    WorkGroupCreate,
    WorkGroupInfo,
    WorkGroupUpdate,
)

router = APIRouter()


def _clean_text(value: str | None) -> str:
    return (value or "").strip()


def _normalize_name(value: str | None) -> str:
    return "".join(_clean_text(value).lower().split())


def _safe_int(value: int | None, fallback: int) -> int:
    if value is None:
        return fallback
    return max(value, 0)


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
    work_groups = db.query(WorkGroup).order_by(WorkGroup.id.asc()).all()
    instruments_query = db.query(Instrument).order_by(Instrument.work_group_id.asc(), Instrument.id.asc())
    if instrument_id:
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
    db: Session = Depends(get_db),
):
    query = (
        db.query(Reagent)
        .join(Instrument, Reagent.instrument_id == Instrument.id)
        .join(WorkGroup, Instrument.work_group_id == WorkGroup.id)
        .filter(Reagent.is_archived.is_(False))
        .order_by(WorkGroup.id.asc(), Instrument.id.asc(), Reagent.name.asc(), Reagent.id.asc())
    )

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

    operator = Operator(name=name, is_active=True)
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
