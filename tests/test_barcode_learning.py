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


def test_scan_inbound_x8_barcode_parses_without_learning_specific_rule(tmp_path):
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
    assert first_payload["extracted_batch_no"] == "123250711"

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
        assert specific_rule is None


def test_product_specific_batch_rule_does_not_bleed_into_other_x8_product(tmp_path):
    client, session_local = build_client(tmp_path)
    _, instrument_id = get_first_catalog_session(session_local)
    barcode_hbsag = "0106947145508814112511201727052010123250711240130210009M"
    barcode_hbsab = "0106947145508838112510161726101610124250411240130210010M"

    with session_local() as db:
        operator_name = (
            db.query(Operator)
            .filter(Operator.is_active.is_(True))
            .order_by(Operator.id.asc())
            .first()
            .name
        )
        reagent_hbsag = Reagent(
            instrument_id=instrument_id,
            name="HBsAg",
            match_mode="prefix",
            match_pattern="0106947145508814",
            raw_barcode_sample=barcode_hbsag,
            manufacturer="Snibe",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=30,
            warning_stock=5,
            follow_instrument=False,
        )
        reagent_hbsab = Reagent(
            instrument_id=instrument_id,
            name="HBsAb",
            match_mode="prefix",
            match_pattern="0106947145508838",
            raw_barcode_sample=barcode_hbsab,
            manufacturer="Snibe",
            unit="瓶",
            package_unit="盒",
            package_to_min_qty=1,
            warning_days=30,
            warning_stock=5,
            follow_instrument=False,
        )
        db.add_all([reagent_hbsag, reagent_hbsab])
        db.commit()
        reagent_hbsag_id = reagent_hbsag.id
        reagent_hbsab_id = reagent_hbsab.id

    learned_parse = client.post("/api/barcode/parse", json={"barcode": barcode_hbsag})
    assert learned_parse.status_code == 200
    learned_payload = learned_parse.json()
    assert learned_payload["reagent_id"] == reagent_hbsag_id

    inbound_response = client.post("/api/inbound/batch", json={
        "operator": operator_name,
        "items": [{
            "source": "scan",
            "reagent_id": reagent_hbsag_id,
            "reagent_name": "HBsAg",
            "batch_no": "123250711",
            "parsed_batch_no": learned_payload["extracted_batch_no"],
            "expiry_date": "2027-05-20",
            "quantity": 1,
            "package_unit": "盒",
            "min_unit": "瓶",
            "package_to_min_qty": 1,
            "raw_barcode": barcode_hbsag
        }]
    })
    assert inbound_response.status_code == 200

    parse_other = client.post("/api/barcode/parse", json={"barcode": barcode_hbsab})
    assert parse_other.status_code == 200
    payload = parse_other.json()
    assert payload["reagent_id"] == reagent_hbsab_id
    assert payload["extracted_batch_no"] == "124250411"


def test_generic_instrument_rule_does_not_override_structured_x8_batch(tmp_path):
    client, session_local = build_client(tmp_path)
    barcode = "0106947145518158112602031727080310136250611240130210011M"

    with session_local() as db:
        fallback_instrument = db.query(Instrument).order_by(Instrument.id.asc()).first()
        x8_instrument = (
            db.query(Instrument)
            .filter(Instrument.name == "MAGLUMI X8化学发光分析仪")
            .first()
        )
        db.add(
            Reagent(
                instrument_id=x8_instrument.id,
                name="X8 Family Sample",
                match_mode="prefix",
                match_pattern="0106947145508814",
                raw_barcode_sample="0106947145508814112511201727052010123250711240130210009M",
                manufacturer="Snibe",
                unit="次",
                package_unit="盒",
                package_to_min_qty=1,
                warning_days=30,
                warning_stock=5,
                follow_instrument=False,
            )
        )
        db.add(
            BarcodeBatchRule(
                instrument_id=fallback_instrument.id,
                reagent_id=None,
                product_code=None,
                batch_anchor="10",
                batch_offset=0,
                batch_length=6,
                raw_barcode_sample="0106947145518158112602031727080310136250611240130210011M",
                learned_batch_no="694714",
                is_active=True,
            )
        )
        db.commit()

    parse_result = client.post("/api/barcode/parse", json={"barcode": barcode})
    assert parse_result.status_code == 200
    payload = parse_result.json()
    assert payload["extracted_batch_no"] == "136250611"
    assert payload["instrument_name"] == "MAGLUMI X8化学发光分析仪"


def test_x8_batch_with_internal_17_sequence_keeps_full_batch(tmp_path):
    client, session_local = build_client(tmp_path)
    barcode = "0106947145512262112505191727051910217250111240130201030M"

    with session_local() as db:
        x8_instrument = (
            db.query(Instrument)
            .filter(Instrument.name == "MAGLUMI X8化学发光分析仪")
            .first()
        )
        db.add(
            Reagent(
                instrument_id=x8_instrument.id,
                name="X8 Family Sample 2",
                match_mode="prefix",
                match_pattern="0106947145508814",
                raw_barcode_sample="0106947145508814112511201727052010123250711240130210009M",
                manufacturer="Snibe",
                unit="次",
                package_unit="盒",
                package_to_min_qty=1,
                warning_days=30,
                warning_stock=5,
                follow_instrument=False,
            )
        )
        db.commit()

    parse_result = client.post("/api/barcode/parse", json={"barcode": barcode})
    assert parse_result.status_code == 200
    payload = parse_result.json()
    assert payload["instrument_name"] == "MAGLUMI X8化学发光分析仪"
    assert payload["extracted_batch_no"] == "217250111"


def test_x8_expiry_after_production_date_suffix_17_is_detected(tmp_path):
    client, session_local = build_client(tmp_path)
    barcode = "0106947145512385112512171727061710223250211240130201036M"

    with session_local() as db:
        x8_instrument = (
            db.query(Instrument)
            .filter(Instrument.name == "MAGLUMI X8化学发光分析仪")
            .first()
        )
        db.add(
            Reagent(
                instrument_id=x8_instrument.id,
                name="CA50",
                match_mode="prefix",
                match_pattern="0106947145512385",
                raw_barcode_sample=barcode,
                manufacturer="Snibe",
                unit="盒",
                package_unit="盒",
                package_to_min_qty=1,
                warning_days=30,
                warning_stock=5,
                follow_instrument=False,
            )
        )
        db.commit()

    parse_result = client.post("/api/barcode/parse", json={"barcode": barcode})
    assert parse_result.status_code == 200
    payload = parse_result.json()
    assert payload["reagent_name"] == "CA50"
    assert payload["extracted_production_date"] == "2025-12-17"
    assert payload["extracted_expiry_date"] == "2027-06-17"
    assert payload["extracted_batch_no"] == "223250211"


def test_expiry_not_taken_from_gtin_internal_17(tmp_path):
    """H1 回归：GTIN 内含 '17'+合法日期时，效期必须取真实的 AI 17，而非 GTIN 内部片段"""
    client, _ = build_client(tmp_path)
    barcode = "01069471723010141727061010LOT123"  # GTIN 内 '17230101'，真实 AI 17 为 2027-06-10

    response = client.post("/api/barcode/parse", json={"barcode": barcode})
    assert response.status_code == 200
    payload = response.json()
    assert payload["extracted_expiry_date"] == "2027-06-10"
    assert payload["extracted_batch_no"] == "LOT123"


def test_batch_no_without_ai17_not_taken_from_serial_tail(tmp_path):
    """H3 回归：无 AI 17 的条码，批号必须取 AI 10 后的完整批号，而非序列号尾部的 '10'"""
    client, _ = build_client(tmp_path)
    barcode = "01069471455123851125121710223250211240130201036M"

    response = client.post("/api/barcode/parse", json={"barcode": barcode})
    assert response.status_code == 200
    payload = response.json()
    assert payload["extracted_batch_no"] == "223250211"


def test_batch_no_truncated_at_ai21_serial(tmp_path):
    """M1 回归：批号后跟 AI 21 序列号时应截断，不把序列号吞进批号"""
    client, _ = build_client(tmp_path)
    barcode = "010694714551238517270610101234521SERIAL123"

    response = client.post("/api/barcode/parse", json={"barcode": barcode})
    assert response.status_code == 200
    payload = response.json()
    assert payload["extracted_batch_no"] == "12345"
    assert payload["extracted_expiry_date"] == "2027-06-10"
