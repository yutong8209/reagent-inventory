from datetime import date, datetime

import models  # noqa: F401
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api import barcode, calibration, inbound, inventory, reports
from db import get_db
from db.base import Base
from models import BatchStock, Instrument, Reagent, Transaction, WorkGroup
from services import ensure_default_catalog, ensure_default_operators, ensure_default_unit_options


def build_client(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        ensure_default_catalog(db)
        ensure_default_operators(db)
        ensure_default_unit_options(db)

    app = FastAPI()
    app.include_router(barcode.router, prefix="/api")
    app.include_router(inbound.router, prefix="/api")
    app.include_router(inventory.router, prefix="/api")
    app.include_router(calibration.router, prefix="/api")
    app.include_router(reports.router, prefix="/api")

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), TestingSessionLocal


def first_catalog_ids(SessionLocal):
    with SessionLocal() as db:
        work_group = db.query(WorkGroup).order_by(WorkGroup.id.asc()).first()
        instrument = (
            db.query(Instrument)
            .filter(Instrument.work_group_id == work_group.id)
            .order_by(Instrument.id.asc())
            .first()
        )
        return work_group.id, instrument.id


def seed_tt4_calibration_case(SessionLocal):
    with SessionLocal() as db:
        work_group_id, instrument_id = first_catalog_ids(SessionLocal)
        instrument = db.query(Instrument).filter(Instrument.id == instrument_id).first()

        target = Reagent(
            instrument_id=instrument_id,
            name="TT4",
            match_mode="exact",
            match_pattern="TT4-RAW",
            raw_barcode_sample="TT4-RAW",
            manufacturer="Maker TT4",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=30,
            warning_stock=5,
            follow_instrument=False,
            calibration_result_unit="nmmol/L",
        )
        calibrator = Reagent(
            instrument_id=instrument_id,
            name="TT4校准品",
            match_mode="exact",
            match_pattern="CAL-TT4-001",
            raw_barcode_sample="CAL-TT4-001",
            manufacturer="Maker Cal",
            unit="次",
            package_unit="次",
            package_to_min_qty=1,
            warning_days=30,
            warning_stock=5,
            follow_instrument=False,
            is_calibrator=True,
            calibration_result_unit="nmmol/L",
        )
        db.add_all([target, calibrator])
        db.flush()

        old_batch = BatchStock(
            reagent_id=target.id,
            batch_no="TT4-OLD",
            expiry_date=date(2026, 6, 30),
            quantity=0,
            loose_min_quantity=0,
            package_unit="盒",
            min_unit="瓶",
            package_to_min_qty=1,
            created_at=datetime(2026, 1, 1, 8, 0, 0),
        )
        new_batch = BatchStock(
            reagent_id=target.id,
            batch_no="TT4-NEW",
            expiry_date=date(2026, 8, 31),
            quantity=3,
            loose_min_quantity=0,
            package_unit="盒",
            min_unit="瓶",
            package_to_min_qty=1,
            created_at=datetime(2026, 2, 1, 8, 0, 0),
        )
        calibrator_batch = BatchStock(
            reagent_id=calibrator.id,
            batch_no="CAL-LOT-001",
            expiry_date=date(2026, 12, 31),
            quantity=5,
            loose_min_quantity=0,
            package_unit="次",
            min_unit="次",
            package_to_min_qty=1,
        )
        db.add_all([old_batch, new_batch, calibrator_batch])
        db.commit()

        return {
            "work_group_id": work_group_id,
            "instrument_id": instrument_id,
            "target_id": target.id,
            "calibrator_id": calibrator.id,
            "calibrator_batch_id": calibrator_batch.id,
        }


def test_create_reagent_name_with_calibrator_suffix_defaults_to_calibrator(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = first_catalog_ids(SessionLocal)

    response = client.post(
        "/api/reagents",
        json={
            "instrument_id": instrument_id,
            "name": "TT4校准品",
            "match_mode": "exact",
            "match_pattern": "TT4-CAL-NEW",
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["is_calibrator"] is True
    assert payload["package_unit"] == "次"
    assert payload["unit"] == "次"
    assert payload["package_to_min_qty"] == 1
    assert payload["calibration_result_unit"] == "nmmol/L"


def test_calibration_scan_preview_matches_target_and_history_batches(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    ids = seed_tt4_calibration_case(SessionLocal)

    response = client.post("/api/calibration/scan-preview", json={"barcode": "CAL-TT4-001"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["calibrator_reagent_id"] == ids["calibrator_id"]
    assert payload["target_reagent_id"] == ids["target_id"]
    assert payload["target_reagent_name"] == "TT4"
    assert payload["default_new_batch_no"] == "TT4-NEW"
    assert payload["default_old_batch_no"] == "TT4-OLD"
    assert [item["batch_no"] for item in payload["new_batch_candidates"]] == ["TT4-NEW", "TT4-OLD"]


def test_calibration_scan_preview_rejects_non_calibrator(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    _, instrument_id = first_catalog_ids(SessionLocal)

    with SessionLocal() as db:
        reagent = Reagent(
            instrument_id=instrument_id,
            name="TT4",
            match_mode="exact",
            match_pattern="TT4-ONLY",
            raw_barcode_sample="TT4-ONLY",
            manufacturer="Maker TT4",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=30,
            warning_stock=5,
            follow_instrument=False,
        )
        db.add(reagent)
        db.commit()

    response = client.post("/api/calibration/scan-preview", json={"barcode": "TT4-ONLY"})
    assert response.status_code == 400
    assert "不是校准品" in response.json()["detail"]


def test_create_calibration_record_deducts_stock_and_generates_transaction(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    ids = seed_tt4_calibration_case(SessionLocal)

    response = client.post(
        "/api/calibration/records",
        json={
            "calibrator_reagent_id": ids["calibrator_id"],
            "calibrator_batch_stock_id": ids["calibrator_batch_id"],
            "target_reagent_id": ids["target_id"],
            "target_old_batch_no": "TT4-OLD",
            "target_new_batch_no": "TT4-NEW",
            "usage_times": 1,
            "result_unit": "nmmol/L",
            "operator": "陈茹",
            "raw_barcode": "CAL-TT4-001",
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["target_reagent_name"] == "TT4"
    assert payload["usage_times"] == 1

    with SessionLocal() as db:
        calibrator_batch = db.query(BatchStock).filter(BatchStock.id == ids["calibrator_batch_id"]).first()
        assert calibrator_batch.quantity == 4
        transaction = db.query(Transaction).filter(Transaction.type == "CALIBRATION").first()
        assert transaction is not None
        assert transaction.quantity == 1

    tx_response = client.get("/api/transactions", params={"type": "CALIBRATION"})
    assert tx_response.status_code == 200
    tx_payload = tx_response.json()
    assert len(tx_payload) == 1
    assert tx_payload[0]["type"] == "CALIBRATION"


def test_update_calibration_record_can_adjust_usage_and_results(tmp_path):
    client, SessionLocal = build_client(tmp_path)
    ids = seed_tt4_calibration_case(SessionLocal)

    create_response = client.post(
        "/api/calibration/records",
        json={
            "calibrator_reagent_id": ids["calibrator_id"],
            "calibrator_batch_stock_id": ids["calibrator_batch_id"],
            "target_reagent_id": ids["target_id"],
            "target_old_batch_no": "TT4-OLD",
            "target_new_batch_no": "TT4-NEW",
            "usage_times": 1,
            "result_unit": "nmmol/L",
            "operator": "陈茹",
        },
    )
    record_id = create_response.json()["id"]

    update_response = client.put(
        f"/api/calibration/records/{record_id}",
        json={
            "target_reagent_id": ids["target_id"],
            "target_old_batch_no": "TT4-OLD",
            "target_new_batch_no": "TT4-NEW",
            "usage_times": 2,
            "result_unit": "nmmol/L",
            "operator": "陈茹",
            "old_result_1": "12.1",
            "new_result_1": "12.8",
        },
    )
    assert update_response.status_code == 200
    payload = update_response.json()
    assert payload["usage_times"] == 2
    assert payload["old_result_1"] == "12.1"
    assert payload["new_result_1"] == "12.8"

    with SessionLocal() as db:
        calibrator_batch = db.query(BatchStock).filter(BatchStock.id == ids["calibrator_batch_id"]).first()
        assert calibrator_batch.quantity == 3
        transaction = db.query(Transaction).filter(Transaction.type == "CALIBRATION").first()
        assert transaction.quantity == 2
