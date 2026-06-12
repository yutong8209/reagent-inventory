from sqlalchemy.orm import Session

from models import Operator


DEFAULT_OPERATORS = [
    "陈茜",
    "陈茹",
    "刘进文",
    "徐元庆",
    "杨振华",
    "刘亚平",
    "周雨桐",
    "嵇婷",
    "陈慧",
    "张萱",
]


def ensure_default_operators(db: Session):
    existing = {
        operator.name.strip()
        for operator in db.query(Operator).all()
        if operator.name and operator.name.strip()
    }

    changed = False
    for name in DEFAULT_OPERATORS:
        if name in existing:
            continue
        db.add(Operator(name=name, is_active=True))
        changed = True

    if changed:
        db.commit()
