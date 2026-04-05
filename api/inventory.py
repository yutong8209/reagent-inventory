from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
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
    OperatorCreate,
    OperatorResponse,
    OperatorUpdate,
    ReagentCatalogItem,
    ReagentInfo,
    ReagentUpdate,
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


def _serialize_reagent(reagent: Reagent) -> ReagentCatalogItem:
    instrument = reagent.instrument
    work_group = instrument.work_group if instrument else None
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
    instrument_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    work_groups = db.query(WorkGroup).order_by(WorkGroup.id.asc()).all()

    result = []
    for work_group in work_groups:
        work_group_data = WorkGroupInfo(id=work_group.id, name=work_group.name, instruments=[])

        instruments_query = (
            db.query(Instrument)
            .filter(Instrument.work_group_id == work_group.id)
            .order_by(Instrument.id.asc())
        )
        if instrument_id:
            instruments_query = instruments_query.filter(Instrument.id == instrument_id)

        instruments = instruments_query.all()
        for instrument in instruments:
            instrument_data = InstrumentInfo(
                id=instrument.id,
                name=instrument.name,
                model=instrument.model,
                reagents=[],
            )

            reagents = db.query(Reagent).filter(Reagent.instrument_id == instrument.id).all()
            for reagent in reagents:
                reagent_data = ReagentInfo(
                    id=reagent.id,
                    name=reagent.name,
                    unit=reagent.unit,
                    package_unit=reagent.package_unit,
                    package_to_min_qty=reagent.package_to_min_qty,
                    manufacturer=reagent.manufacturer,
                    batches=[],
                )

                batches = (
                    db.query(BatchStock)
                    .filter(BatchStock.reagent_id == reagent.id)
                    .order_by(BatchStock.expiry_date.asc())
                    .all()
                )

                for batch in batches:
                    available_min_quantity = (
                        (batch.quantity * (batch.package_to_min_qty or 1))
                        + (batch.loose_min_quantity or 0)
                    )
                    reagent_data.batches.append(
                        BatchInfo(
                            id=batch.id,
                            batch_no=batch.batch_no,
                            expiry_date=batch.expiry_date.isoformat(),
                            quantity=batch.quantity,
                            loose_min_quantity=batch.loose_min_quantity or 0,
                            available_min_quantity=available_min_quantity,
                            package_unit=batch.package_unit,
                            min_unit=batch.min_unit,
                            package_to_min_qty=batch.package_to_min_qty,
                            is_expired=batch.expiry_date < date.today(),
                        )
                    )

                if reagent_data.batches:
                    instrument_data.reagents.append(reagent_data)

            if instrument_data.reagents:
                work_group_data.instruments.append(instrument_data)

        if work_group_data.instruments:
            result.append(work_group_data)

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
            )
            for instrument in instruments
        ],
    )


@router.get("/instruments")
def get_instruments(
    work_group_id: Optional[int] = Query(None),
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
    )
    db.add(instrument)
    db.commit()
    db.refresh(instrument)

    return InstrumentCatalogItem(
        id=instrument.id,
        work_group_id=instrument.work_group_id,
        name=instrument.name,
        model=instrument.model,
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
    db.commit()
    db.refresh(instrument)

    return InstrumentCatalogItem(
        id=instrument.id,
        work_group_id=instrument.work_group_id,
        name=instrument.name,
        model=instrument.model,
    )


@router.get("/reagents", response_model=List[ReagentCatalogItem])
def get_reagents(
    work_group_id: Optional[int] = Query(None),
    instrument_id: Optional[int] = Query(None),
    keyword: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Reagent)
        .join(Instrument, Reagent.instrument_id == Instrument.id)
        .join(WorkGroup, Instrument.work_group_id == WorkGroup.id)
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
    reagent.warning_days = data.warning_days
    reagent.warning_stock = data.warning_stock
    db.commit()
    db.refresh(reagent)

    return _serialize_reagent(reagent)


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
