from datetime import date

import models  # noqa: F401
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api import inbound, inventory
from db import get_db
from db.base import Base
from models import BatchStock, Instrument, Operator, ParseLog, Reagent, Transaction, WorkGroup
from services import ensure_default_catalog, ensure_default_operators


def build_client(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        ensure_default_catalog(db)
        ensure_default_operators(db)

    app = FastAPI()
    app.include_router(inbound.router, prefix="/api")
    app.include_router(inventory.router, prefix="/api")

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), TestingSessionLocal


def get_first_catalog_session(SessionLocal):
    with SessionLocal() as db:
        work_group = db.query(WorkGroup).order_by(WorkGroup.id.asc()).first()
        instrument = (
            db.query(Instrument)
            .filter(Instrument.work_group_id == work_group.id)
            .order_by(Instrument.id.asc())
            .first()
        )
        return work_group.id, instrument.id


def test_reagent_list_filters_and_keyword(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    work_group_id, instrument_id = get_first_catalog_session(SessionLocal)

    create_response = client.post("/api/reagents", json={
        "instrument_id": instrument_id,
        "name": "丙氨酸氨基转移酶试剂",
        "match_mode": "prefix",
        "match_pattern": "01999911112222",
        "manufacturer": "测试厂家",
        "unit": "瓶",
        "package_unit": "盒",
        "package_to_min_qty": 2,
        "warning_days": 20,
        "warning_stock": 3,
    })
    assert create_response.status_code == 201

    list_response = client.get(f"/api/reagents?work_group_id={work_group_id}&instrument_id={instrument_id}&keyword=丙氨酸")
    assert list_response.status_code == 200
    payload = list_response.json()
    assert len(payload) == 1
    assert payload[0]["name"] == "丙氨酸氨基转移酶试剂"
    assert payload[0]["manufacturer"] == "测试厂家"


def test_operator_crud(tmp_path):
    client, _ = build_client(tmp_path)

    list_response = client.get("/api/operators")
    assert list_response.status_code == 200
    assert len(list_response.json()) >= 1

    create_response = client.post("/api/operators", json={"name": "测试操作员"})
    assert create_response.status_code == 201
    operator_id = create_response.json()["id"]

    update_response = client.put(f"/api/operators/{operator_id}", json={
        "name": "测试操作员A",
        "is_active": False,
    })
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "测试操作员A"
    assert update_response.json()["is_active"] is False


def test_first_manual_inbound_creates_reagent_and_batch(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    work_group_id, instrument_id = get_first_catalog_session(SessionLocal)

    response = client.post("/api/inbound/batch", json={
        "operator": "陈茜",
        "items": [{
            "source": "manual",
            "work_group_id": work_group_id,
            "instrument_id": instrument_id,
            "reagent_name": "首次手工建档试剂",
            "manufacturer": "手工厂家",
            "batch_no": "BATCH-001",
            "expiry_date": "2030-12-31",
            "quantity": 4,
            "package_unit": "盒",
            "min_unit": "瓶",
            "package_to_min_qty": 6,
            "warning_days": 12,
            "warning_stock": 2,
            "raw_barcode": "MANUAL::TEST::001"
        }]
    })
    assert response.status_code == 200
    assert response.json()["item_count"] == 1

    with SessionLocal() as db:
        reagent = db.query(Reagent).filter(Reagent.name == "首次手工建档试剂").first()
        assert reagent is not None
        assert reagent.manufacturer == "手工厂家"
        assert reagent.package_to_min_qty == 6
        assert reagent.warning_days == 12
        assert reagent.warning_stock == 2
        batch = db.query(BatchStock).filter(BatchStock.reagent_id == reagent.id).first()
        assert batch is not None
        assert batch.quantity == 4


def test_existing_reagent_inbound_reuses_archive_package_info(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = get_first_catalog_session(SessionLocal)

    create_response = client.post("/api/reagents", json={
        "instrument_id": instrument_id,
        "name": "已有试剂",
        "match_mode": "prefix",
        "match_pattern": "01888877776666",
        "manufacturer": "归档厂家",
        "unit": "支",
        "package_unit": "袋",
        "package_to_min_qty": 8,
        "warning_days": 15,
        "warning_stock": 4,
    })
    reagent_id = create_response.json()["id"]

    response = client.post("/api/inbound/batch", json={
        "operator": "陈茜",
        "items": [{
            "source": "manual",
            "reagent_id": reagent_id,
            "reagent_name": "已有试剂",
            "batch_no": "KEEP-001",
            "expiry_date": "2031-01-01",
            "quantity": 2,
            "package_unit": "箱",
            "min_unit": "片",
            "package_to_min_qty": 99,
            "raw_barcode": "MANUAL::KEEP::001"
        }]
    })
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["package_unit"] == "袋"
    assert item["min_unit"] == "支"
    assert item["package_to_min_qty"] == 8


def test_reset_reagent_data_keeps_catalog_and_operators(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    work_group_id, instrument_id = get_first_catalog_session(SessionLocal)

    with SessionLocal() as db:
        reagent = Reagent(
            instrument_id=instrument_id,
            name="待清空试剂",
            match_mode="exact",
            match_pattern="RESET-001",
            raw_barcode_sample="RESET-001",
            manufacturer="厂家",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=30,
            warning_stock=5,
        )
        db.add(reagent)
        db.flush()

        batch = BatchStock(
            reagent_id=reagent.id,
            batch_no="RESET-BATCH",
            expiry_date=date(2030, 1, 1),
            quantity=1,
            package_unit="盒",
            min_unit="瓶",
            package_to_min_qty=1,
        )
        db.add(batch)
        db.flush()

        db.add(Transaction(
            reagent_id=reagent.id,
            batch_stock_id=batch.id,
            type="IN",
            quantity=1,
            operator="陈茜",
            source="manual",
            raw_barcode="RESET-001",
            package_unit="盒",
            min_unit="瓶",
            package_to_min_qty=1,
            remark=None,
        ))
        db.add(ParseLog(raw_barcode="RESET-001", match_result="exact", matched_reagent_id=reagent.id))
        db.commit()

    reset_response = client.post("/api/admin/reset-reagent-data")
    assert reset_response.status_code == 200
    assert reset_response.json()["success"] is True

    with SessionLocal() as db:
        assert db.query(WorkGroup).filter(WorkGroup.id == work_group_id).count() == 1
        assert db.query(Instrument).filter(Instrument.id == instrument_id).count() == 1
        assert db.query(Operator).count() >= 1
        assert db.query(Reagent).count() == 0
        assert db.query(BatchStock).count() == 0
        assert db.query(Transaction).count() == 0
        assert db.query(ParseLog).count() == 0
