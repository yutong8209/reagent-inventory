from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models  # noqa: F401
from api import barcode, inbound, inventory
from db import get_db
from db.base import Base
from models import BarcodeBatchRule, Instrument, Operator, Reagent, WorkGroup
from services import ensure_default_catalog, ensure_default_operators, ensure_default_unit_options


def build_client(tmp_path):
    db_path = tmp_path / "barcode-learning.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    with testing_session_local() as db:
        ensure_default_catalog(db)
        ensure_default_operators(db)
        ensure_default_unit_options(db)

    app = FastAPI()
    app.include_router(barcode.router, prefix="/api")
    app.include_router(inbound.router, prefix="/api")
    app.include_router(inventory.router, prefix="/api")

    def override_get_db():
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), testing_session_local


def get_first_catalog_session(session_local):
    with session_local() as db:
        work_group = db.query(WorkGroup).order_by(WorkGroup.id.asc()).first()
        instrument = (
            db.query(Instrument)
            .filter(Instrument.work_group_id == work_group.id)
            .order_by(Instrument.id.asc())
            .first()
        )
        return work_group.id, instrument.id


def test_scan_inbound_specific_rule_helps_new_reagent_parse_on_same_instrument(tmp_path):
    client, session_local = build_client(tmp_path)
    work_group_id, instrument_id = get_first_catalog_session(session_local)
    barcode_one = "0106947145508814112511201727052010123250711240130210009M"
    barcode_two = "0106947145520175112512251727062510471250311240130266001M"

    with session_local() as db:
        operator_name = (
            db.query(Operator)
            .filter(Operator.is_active.is_(True))
            .order_by(Operator.id.asc())
            .first()
            .name
        )
        reagent = Reagent(
            instrument_id=instrument_id,
            name="MAGLUMI X8 Reagent A",
            match_mode="prefix",
            match_pattern="0106947145508814",
            raw_barcode_sample=barcode_one,
            manufacturer="Snibe",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=30,
            warning_stock=5,
            follow_instrument=False,
        )
        db.add(reagent)
        db.commit()
        reagent_id = reagent.id

    first_parse = client.post("/api/barcode/parse", json={"barcode": barcode_one})
    assert first_parse.status_code == 200
    first_payload = first_parse.json()
    assert first_payload["reagent_id"] == reagent_id
    assert first_payload["extracted_batch_no"] != "123250711"

    inbound_response = client.post("/api/inbound/batch", json={
        "operator": operator_name,
        "items": [{
            "source": "scan",
            "reagent_id": reagent_id,
            "reagent_name": "MAGLUMI X8 Reagent A",
            "batch_no": "123250711",
            "parsed_batch_no": first_payload["extracted_batch_no"],
            "expiry_date": "2027-05-20",
            "quantity": 1,
            "package_unit": "盒",
            "min_unit": "瓶",
            "package_to_min_qty": 1,
            "raw_barcode": barcode_one
        }]
    })
    assert inbound_response.status_code == 200

    second_parse = client.post("/api/barcode/parse", json={"barcode": barcode_two})
    assert second_parse.status_code == 200
    second_payload = second_parse.json()
    assert second_payload["match_type"] == "none"
    assert second_payload["instrument_id"] == instrument_id
    assert second_payload["work_group_id"] == work_group_id
    assert second_payload["extracted_batch_no"] == "471250311"

    with session_local() as db:
        specific_rule = db.query(BarcodeBatchRule).filter(
            BarcodeBatchRule.reagent_id == reagent_id
        ).first()
        assert specific_rule is not None
        assert specific_rule.product_code == "06947145508814"
        assert specific_rule.batch_anchor == "10"
        assert specific_rule.batch_offset == 0
        assert specific_rule.batch_length == 9
