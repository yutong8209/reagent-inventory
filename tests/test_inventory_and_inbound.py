from datetime import date

import models  # noqa: F401
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api import barcode, inbound, inventory
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
    app.include_router(barcode.router, prefix="/api")
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


def test_inventory_uses_instrument_defaults_until_reagent_override(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = get_first_catalog_session(SessionLocal)

    with SessionLocal() as db:
        instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
        instrument.default_warning_days = 20
        instrument.default_warning_stock = 10

        reagent = Reagent(
            instrument_id=instrument_id,
            name="预警继承试剂",
            match_mode="exact",
            match_pattern="WARN-INHERIT-001",
            raw_barcode_sample="WARN-INHERIT-001",
            manufacturer="测试厂家",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=2,
            warning_stock=3,
            follow_instrument=True,
        )
        db.add(reagent)
        db.flush()

        db.add(BatchStock(
            reagent_id=reagent.id,
            batch_no="WARN-BATCH-1",
            expiry_date=date.today().replace(year=date.today().year + 1) if date.today().month != 2 or date.today().day != 29 else date(date.today().year + 1, 2, 28),
            quantity=8,
            package_unit="盒",
            min_unit="瓶",
            package_to_min_qty=1,
        ))
        db.commit()
        reagent_id = reagent.id

    with SessionLocal() as db:
        batch = db.query(BatchStock).filter(BatchStock.reagent_id == reagent_id).first()
        batch.expiry_date = date.today().fromordinal(date.today().toordinal() + 5)
        db.commit()

    inventory_response = client.get("/api/inventory")
    assert inventory_response.status_code == 200
    payload = inventory_response.json()
    reagent_payload = next(
        reagent
        for group in payload
        for instrument in group["instruments"]
        for reagent in instrument["reagents"]
        if reagent["id"] == reagent_id
    )
    assert reagent_payload["warning_source"] == "instrument"
    assert reagent_payload["effective_warning_days"] == 20
    assert reagent_payload["effective_warning_stock"] == 10
    assert reagent_payload["status_level"] == "expiring"

    update_response = client.put(f"/api/reagents/{reagent_id}/warning-settings", json={
        "follow_instrument": False,
        "warning_days": 2,
        "warning_stock": 5,
    })
    assert update_response.status_code == 200
    assert update_response.json()["warning_source"] == "reagent"

    inventory_response = client.get("/api/inventory")
    reagent_payload = next(
        reagent
        for group in inventory_response.json()
        for instrument in group["instruments"]
        for reagent in instrument["reagents"]
        if reagent["id"] == reagent_id
    )
    assert reagent_payload["warning_source"] == "reagent"
    assert reagent_payload["effective_warning_days"] == 2
    assert reagent_payload["effective_warning_stock"] == 5
    assert reagent_payload["status_level"] == "normal"


def test_apply_instrument_warning_defaults_switches_reagents_back_to_follow(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = get_first_catalog_session(SessionLocal)

    with SessionLocal() as db:
        instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
        instrument.default_warning_days = 6
        instrument.default_warning_stock = 7

        reagent = Reagent(
            instrument_id=instrument_id,
            name="批量切回跟随试剂",
            match_mode="exact",
            match_pattern="WARN-APPLY-001",
            raw_barcode_sample="WARN-APPLY-001",
            manufacturer="测试厂家",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=1,
            warning_stock=2,
            follow_instrument=False,
        )
        db.add(reagent)
        db.flush()

        db.add_all([
            BatchStock(
                reagent_id=reagent.id,
                batch_no="APPLY-BATCH-2",
                expiry_date=date.today().fromordinal(date.today().toordinal() + 9),
                quantity=2,
                package_unit="盒",
                min_unit="瓶",
                package_to_min_qty=1,
            ),
            BatchStock(
                reagent_id=reagent.id,
                batch_no="APPLY-BATCH-1",
                expiry_date=date.today().fromordinal(date.today().toordinal() + 5),
                quantity=3,
                package_unit="盒",
                min_unit="瓶",
                package_to_min_qty=1,
            ),
        ])
        db.commit()
        reagent_id = reagent.id

    defaults_response = client.put(f"/api/instruments/{instrument_id}/warning-defaults", json={
        "default_warning_days": 10,
        "default_warning_stock": 4,
    })
    assert defaults_response.status_code == 200

    apply_response = client.post(f"/api/instruments/{instrument_id}/warning-defaults/apply")
    assert apply_response.status_code == 200
    assert apply_response.json()["success"] is True
    assert apply_response.json()["updated_count"] >= 1

    inventory_response = client.get("/api/inventory")
    reagent_payload = next(
        reagent
        for group in inventory_response.json()
        for instrument in group["instruments"]
        for reagent in instrument["reagents"]
        if reagent["id"] == reagent_id
    )
    assert reagent_payload["warning_source"] == "instrument"
    assert reagent_payload["follow_instrument"] is True
    assert reagent_payload["effective_warning_days"] == 10
    assert reagent_payload["status_level"] == "expiring"
    assert [batch["batch_no"] for batch in reagent_payload["batches"]] == ["APPLY-BATCH-1", "APPLY-BATCH-2"]


def test_batch_update_instrument_warnings_updates_existing_reagents_and_defaults(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = get_first_catalog_session(SessionLocal)

    with SessionLocal() as db:
        reagent = Reagent(
            instrument_id=instrument_id,
            name="批量预警试剂",
            match_mode="exact",
            match_pattern="WARN-BULK-001",
            raw_barcode_sample="WARN-BULK-001",
            manufacturer="测试厂家",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=3,
            warning_stock=2,
            follow_instrument=True,
        )
        db.add(reagent)
        db.commit()
        reagent_id = reagent.id

    response = client.post(f"/api/instruments/{instrument_id}/warning-batch-update", json={
        "default_warning_days": 18,
        "default_warning_stock": 9,
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["updated_count"] >= 1

    with SessionLocal() as db:
        instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
        reagent = db.query(Reagent).filter(Reagent.id == reagent_id).first()
        assert instrument.default_warning_days == 18
        assert instrument.default_warning_stock == 9
        assert reagent.warning_days == 18
        assert reagent.warning_stock == 9
        assert reagent.follow_instrument is False


def test_inventory_keeps_zero_stock_reagent_and_marks_empty(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = get_first_catalog_session(SessionLocal)

    with SessionLocal() as db:
        reagent = Reagent(
            instrument_id=instrument_id,
            name="零库存试剂",
            match_mode="exact",
            match_pattern="EMPTY-001",
            raw_barcode_sample="EMPTY-001",
            manufacturer="测试厂家",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=10,
            warning_stock=2,
            follow_instrument=False,
        )
        db.add(reagent)
        db.flush()

        db.add(BatchStock(
            reagent_id=reagent.id,
            batch_no="EMPTY-BATCH-1",
            expiry_date=date.today().fromordinal(date.today().toordinal() + 30),
            quantity=0,
            loose_min_quantity=0,
            package_unit="盒",
            min_unit="瓶",
            package_to_min_qty=1,
        ))
        db.commit()
        reagent_id = reagent.id

    inventory_response = client.get("/api/inventory")
    assert inventory_response.status_code == 200
    reagent_payload = next(
        reagent
        for group in inventory_response.json()
        for instrument in group["instruments"]
        for reagent in instrument["reagents"]
        if reagent["id"] == reagent_id
    )
    assert reagent_payload["total_min_quantity"] == 0
    assert reagent_payload["status_level"] == "empty"
    assert reagent_payload["batch_count"] == 1


def test_archive_zero_stock_reagent_hides_it_from_inventory(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = get_first_catalog_session(SessionLocal)

    with SessionLocal() as db:
        reagent = Reagent(
            instrument_id=instrument_id,
            name="待归档零库存试剂",
            match_mode="exact",
            match_pattern="ARCHIVE-EMPTY-001",
            raw_barcode_sample="ARCHIVE-EMPTY-001",
            manufacturer="测试厂家",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=10,
            warning_stock=2,
            follow_instrument=False,
        )
        db.add(reagent)
        db.flush()

        db.add(BatchStock(
            reagent_id=reagent.id,
            batch_no="ARCHIVE-EMPTY-BATCH",
            expiry_date=date.today().fromordinal(date.today().toordinal() + 30),
            quantity=0,
            loose_min_quantity=0,
            package_unit="盒",
            min_unit="瓶",
            package_to_min_qty=1,
        ))
        db.commit()
        reagent_id = reagent.id

    archive_response = client.post(f"/api/reagents/{reagent_id}/archive")
    assert archive_response.status_code == 200
    assert archive_response.json()["success"] is True

    with SessionLocal() as db:
        reagent = db.query(Reagent).filter(Reagent.id == reagent_id).first()
        assert reagent.is_archived is True

    inventory_response = client.get("/api/inventory")
    assert inventory_response.status_code == 200
    reagent_ids = [
        reagent["id"]
        for group in inventory_response.json()
        for instrument in group["instruments"]
        for reagent in instrument["reagents"]
    ]
    assert reagent_id not in reagent_ids


def test_bulk_archive_zero_stock_reagents_only_archives_empty_ones(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = get_first_catalog_session(SessionLocal)

    with SessionLocal() as db:
        empty_reagent = Reagent(
            instrument_id=instrument_id,
            name="批量归档零库存试剂",
            match_mode="exact",
            match_pattern="ARCHIVE-BULK-EMPTY-001",
            raw_barcode_sample="ARCHIVE-BULK-EMPTY-001",
            manufacturer="测试厂家",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=10,
            warning_stock=2,
            follow_instrument=False,
        )
        stocked_reagent = Reagent(
            instrument_id=instrument_id,
            name="批量归档保留试剂",
            match_mode="exact",
            match_pattern="ARCHIVE-BULK-STOCK-001",
            raw_barcode_sample="ARCHIVE-BULK-STOCK-001",
            manufacturer="测试厂家",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=10,
            warning_stock=2,
            follow_instrument=False,
        )
        db.add_all([empty_reagent, stocked_reagent])
        db.flush()

        db.add(BatchStock(
            reagent_id=empty_reagent.id,
            batch_no="ARCHIVE-BULK-EMPTY-BATCH",
            expiry_date=date.today().fromordinal(date.today().toordinal() + 30),
            quantity=0,
            loose_min_quantity=0,
            package_unit="盒",
            min_unit="瓶",
            package_to_min_qty=1,
        ))
        db.add(BatchStock(
            reagent_id=stocked_reagent.id,
            batch_no="ARCHIVE-BULK-STOCK-BATCH",
            expiry_date=date.today().fromordinal(date.today().toordinal() + 30),
            quantity=3,
            loose_min_quantity=0,
            package_unit="盒",
            min_unit="瓶",
            package_to_min_qty=1,
        ))
        db.commit()
        empty_reagent_id = empty_reagent.id
        stocked_reagent_id = stocked_reagent.id

    archive_response = client.post("/api/reagents/archive-zero-stock")
    assert archive_response.status_code == 200
    payload = archive_response.json()
    assert payload["success"] is True
    assert empty_reagent_id in payload["reagent_ids"]
    assert stocked_reagent_id not in payload["reagent_ids"]

    with SessionLocal() as db:
        empty_reagent = db.query(Reagent).filter(Reagent.id == empty_reagent_id).first()
        stocked_reagent = db.query(Reagent).filter(Reagent.id == stocked_reagent_id).first()
        assert empty_reagent.is_archived is True
        assert stocked_reagent.is_archived is False


def test_archived_reagent_can_be_scanned_and_reactivated_by_inbound(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = get_first_catalog_session(SessionLocal)

    with SessionLocal() as db:
        operator_name = db.query(Operator).filter(Operator.is_active.is_(True)).order_by(Operator.id.asc()).first().name
        reagent = Reagent(
            instrument_id=instrument_id,
            name="CA-125",
            match_mode="exact",
            match_pattern="SCAN-ARCHIVE-001",
            raw_barcode_sample="SCAN-ARCHIVE-001",
            manufacturer="测试厂家",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=2,
            warning_days=30,
            warning_stock=5,
            follow_instrument=False,
            is_archived=True,
        )
        db.add(reagent)
        db.commit()
        reagent_id = reagent.id

    parse_response = client.post("/api/barcode/parse", json={"barcode": "SCAN-ARCHIVE-001"})
    assert parse_response.status_code == 200
    parse_payload = parse_response.json()
    assert parse_payload["reagent_id"] == reagent_id
    assert parse_payload["reagent_name"] == "CA-125"
    assert parse_payload["match_type"] == "exact"

    inbound_response = client.post("/api/inbound/batch", json={
        "operator": operator_name,
        "items": [{
            "source": "scan",
            "reagent_id": reagent_id,
            "reagent_name": "CA-125",
            "batch_no": "SCAN-ARCHIVE-BATCH",
            "expiry_date": "2031-12-31",
            "quantity": 3,
            "package_unit": "盒",
            "min_unit": "瓶",
            "package_to_min_qty": 2,
            "raw_barcode": "SCAN-ARCHIVE-001"
        }]
    })
    assert inbound_response.status_code == 200

    with SessionLocal() as db:
        reagent = db.query(Reagent).filter(Reagent.id == reagent_id).first()
        assert reagent.is_archived is False
        batch = db.query(BatchStock).filter(BatchStock.reagent_id == reagent_id).first()
        assert batch is not None
        assert batch.quantity == 3


def test_manual_inbound_new_reagent_inherits_instrument_defaults(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    work_group_id, instrument_id = get_first_catalog_session(SessionLocal)

    with SessionLocal() as db:
        operator_name = db.query(Operator).filter(Operator.is_active.is_(True)).order_by(Operator.id.asc()).first().name

    with SessionLocal() as db:
        instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()
        instrument.default_warning_days = 14
        instrument.default_warning_stock = 7
        db.commit()

    response = client.post("/api/inbound/batch", json={
        "operator": operator_name,
        "items": [{
            "source": "manual",
            "work_group_id": work_group_id,
            "instrument_id": instrument_id,
            "reagent_name": "继承仪器默认试剂",
            "manufacturer": "默认值厂家",
            "batch_no": "DEFAULT-001",
            "expiry_date": "2031-12-31",
            "quantity": 1,
            "package_unit": "盒",
            "min_unit": "瓶",
            "package_to_min_qty": 1,
            "raw_barcode": "MANUAL::DEFAULT::001"
        }]
    })
    assert response.status_code == 200

    with SessionLocal() as db:
        reagent = db.query(Reagent).filter(Reagent.name == "继承仪器默认试剂").first()
        assert reagent is not None
        assert reagent.warning_days == 14
        assert reagent.warning_stock == 7
        assert reagent.follow_instrument is False
