from sqlalchemy.orm import Session

from models import UnitOption


DEFAULT_UNIT_OPTIONS = [
    {"name": "盒", "scope": "package", "sort_order": 10},
    {"name": "瓶", "scope": "both", "sort_order": 20},
    {"name": "支", "scope": "both", "sort_order": 30},
    {"name": "袋", "scope": "package", "sort_order": 40},
    {"name": "箱", "scope": "package", "sort_order": 50},
    {"name": "套", "scope": "package", "sort_order": 60},
    {"name": "人份", "scope": "min", "sort_order": 70},
    {"name": "测试", "scope": "min", "sort_order": 80},
    {"name": "ml", "scope": "min", "sort_order": 90},
    {"name": "片", "scope": "min", "sort_order": 100},
]


def ensure_default_unit_options(db: Session):
    existing = {item.name: item for item in db.query(UnitOption).all()}
    changed = False

    for spec in DEFAULT_UNIT_OPTIONS:
        option = existing.get(spec["name"])
        if option:
            # 只补缺，不覆写用户自定义的 scope/sort_order/is_active
            continue

        db.add(
            UnitOption(
                name=spec["name"],
                scope=spec["scope"],
                is_active=True,
                sort_order=spec["sort_order"],
            )
        )
        changed = True

    if changed:
        db.commit()
