from sqlalchemy.orm import Session

from models import Instrument, WorkGroup


DEFAULT_CATALOG = [
    {
        "name": "临检组",
        "legacy_names": ["临检"],
        "instruments": [
            {"name": "血球仪", "aliases": ["血球分析仪"]},
            {"name": "血凝仪", "aliases": ["凝血分析仪"]},
            {"name": "血流变仪", "aliases": []},
            {"name": "尿干化学仪", "aliases": []},
            {"name": "尿沉渣仪", "aliases": []},
            {"name": "其他耗材", "aliases": []},
        ],
    },
    {
        "name": "生化组",
        "legacy_names": ["生化"],
        "instruments": [
            {"name": "生化仪", "aliases": ["生化分析仪"]},
            {"name": "血锂分析仪", "aliases": ["电解质分析仪"]},
            {"name": "其他耗材", "aliases": []},
        ],
    },
    {
        "name": "免疫组",
        "legacy_names": ["免疫"],
        "instruments": [
            {"name": "DXI800化学发光仪", "model": "DXI800", "aliases": ["化学发光仪"]},
            {"name": "MAGLUMI X8化学发光分析仪", "model": "MAGLUMI X8", "aliases": ["酶标仪"]},
            {"name": "糖化血红蛋白分析仪", "aliases": []},
            {"name": "其他耗材", "aliases": []},
        ],
    },
]


def _get_or_create_group(group_name: str, legacy_names: list[str], db: Session) -> WorkGroup:
    target_group = db.query(WorkGroup).filter(WorkGroup.name == group_name).first()

    for legacy_name in legacy_names:
        legacy_group = db.query(WorkGroup).filter(WorkGroup.name == legacy_name).first()
        if not legacy_group:
            continue

        if target_group and target_group.id != legacy_group.id:
            instruments = db.query(Instrument).filter(Instrument.work_group_id == legacy_group.id).all()
            for instrument in instruments:
                instrument.work_group_id = target_group.id
            db.delete(legacy_group)
            db.flush()
            return target_group

        legacy_group.name = group_name
        db.flush()
        return legacy_group

    if target_group:
        return target_group

    new_group = WorkGroup(name=group_name)
    db.add(new_group)
    db.flush()
    return new_group


def _sync_group_instruments(group: WorkGroup, instrument_specs: list[dict], db: Session):
    instruments = db.query(Instrument).filter(Instrument.work_group_id == group.id).order_by(Instrument.id.asc()).all()
    instruments_by_name = {instrument.name: instrument for instrument in instruments}
    used_ids: set[int] = set()

    for spec in instrument_specs:
        target_name = spec["name"]
        target_model = spec.get("model")

        instrument = instruments_by_name.get(target_name)
        if instrument:
            instrument.model = target_model
            used_ids.add(instrument.id)
            continue

        instrument = None
        for alias in spec.get("aliases", []):
            alias_match = instruments_by_name.get(alias)
            if alias_match and alias_match.id not in used_ids:
                instrument = alias_match
                break

        if instrument:
            instrument.name = target_name
            instrument.model = target_model
            used_ids.add(instrument.id)
            continue

        new_instrument = Instrument(work_group_id=group.id, name=target_name, model=target_model)
        db.add(new_instrument)
        db.flush()
        used_ids.add(new_instrument.id)


def ensure_default_catalog(db: Session):
    for group_spec in DEFAULT_CATALOG:
        group = _get_or_create_group(group_spec["name"], group_spec.get("legacy_names", []), db)
        _sync_group_instruments(group, group_spec["instruments"], db)
    db.commit()
