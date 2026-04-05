import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/reagent.db")

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def ensure_schema():
    from db.base import Base

    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    table_columns = {
        table_name: {column["name"] for column in inspector.get_columns(table_name)}
        for table_name in inspector.get_table_names()
    }

    migrations = {
        "reagents": [
            (
                "package_unit",
                "ALTER TABLE reagents ADD COLUMN package_unit VARCHAR(50) NOT NULL DEFAULT '盒'",
            ),
            (
                "package_to_min_qty",
                "ALTER TABLE reagents ADD COLUMN package_to_min_qty INTEGER NOT NULL DEFAULT 1",
            ),
        ],
        "batch_stocks": [
            (
                "package_unit",
                "ALTER TABLE batch_stocks ADD COLUMN package_unit VARCHAR(50) NOT NULL DEFAULT '盒'",
            ),
            (
                "min_unit",
                "ALTER TABLE batch_stocks ADD COLUMN min_unit VARCHAR(50) NOT NULL DEFAULT '瓶'",
            ),
            (
                "package_to_min_qty",
                "ALTER TABLE batch_stocks ADD COLUMN package_to_min_qty INTEGER NOT NULL DEFAULT 1",
            ),
        ],
        "transactions": [
            (
                "source",
                "ALTER TABLE transactions ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'scan'",
            ),
            (
                "package_unit",
                "ALTER TABLE transactions ADD COLUMN package_unit VARCHAR(50)",
            ),
            (
                "min_unit",
                "ALTER TABLE transactions ADD COLUMN min_unit VARCHAR(50)",
            ),
            (
                "package_to_min_qty",
                "ALTER TABLE transactions ADD COLUMN package_to_min_qty INTEGER NOT NULL DEFAULT 1",
            ),
        ],
    }

    with engine.begin() as connection:
        for table_name, statements in migrations.items():
            existing_columns = table_columns.get(table_name, set())
            for column_name, statement in statements:
                if column_name not in existing_columns:
                    connection.execute(text(statement))

        if "reagents" in table_columns:
            connection.execute(
                text(
                    """
                    UPDATE reagents
                    SET package_to_min_qty = COALESCE(NULLIF(package_to_min_qty, 0), 1)
                    """
                )
            )

        if "batch_stocks" in table_columns:
            connection.execute(
                text(
                    """
                    UPDATE batch_stocks
                    SET min_unit = COALESCE(
                        NULLIF(min_unit, ''),
                        (
                            SELECT reagents.unit
                            FROM reagents
                            WHERE reagents.id = batch_stocks.reagent_id
                        ),
                        '瓶'
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE batch_stocks
                    SET package_to_min_qty = COALESCE(NULLIF(package_to_min_qty, 0), 1)
                    """
                )
            )

        if "transactions" in table_columns:
            connection.execute(
                text(
                    """
                    UPDATE transactions
                    SET min_unit = COALESCE(
                        NULLIF(min_unit, ''),
                        (
                            SELECT batch_stocks.min_unit
                            FROM batch_stocks
                            WHERE batch_stocks.id = transactions.batch_stock_id
                        ),
                        (
                            SELECT reagents.unit
                            FROM reagents
                            WHERE reagents.id = transactions.reagent_id
                        ),
                        '瓶'
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE transactions
                    SET package_to_min_qty = COALESCE(
                        NULLIF(package_to_min_qty, 0),
                        (
                            SELECT batch_stocks.package_to_min_qty
                            FROM batch_stocks
                            WHERE batch_stocks.id = transactions.batch_stock_id
                        ),
                        (
                            SELECT reagents.package_to_min_qty
                            FROM reagents
                            WHERE reagents.id = transactions.reagent_id
                        ),
                        1
                    )
                    """
                )
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
