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
        "instruments": [
            (
                "default_warning_days",
                "ALTER TABLE instruments ADD COLUMN default_warning_days INTEGER NOT NULL DEFAULT 30",
            ),
            (
                "default_warning_stock",
                "ALTER TABLE instruments ADD COLUMN default_warning_stock INTEGER NOT NULL DEFAULT 5",
            ),
        ],
        "reagents": [
            (
                "reagent_group_id",
                "ALTER TABLE reagents ADD COLUMN reagent_group_id INTEGER",
            ),
            (
                "package_unit",
                "ALTER TABLE reagents ADD COLUMN package_unit VARCHAR(50) NOT NULL DEFAULT '盒'",
            ),
            (
                "package_to_min_qty",
                "ALTER TABLE reagents ADD COLUMN package_to_min_qty INTEGER NOT NULL DEFAULT 1",
            ),
            (
                "follow_instrument",
                "ALTER TABLE reagents ADD COLUMN follow_instrument BOOLEAN NOT NULL DEFAULT 1",
            ),
            (
                "is_archived",
                "ALTER TABLE reagents ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT 0",
            ),
            (
                "is_calibrator",
                "ALTER TABLE reagents ADD COLUMN is_calibrator BOOLEAN NOT NULL DEFAULT 0",
            ),
            (
                "calibration_result_unit",
                "ALTER TABLE reagents ADD COLUMN calibration_result_unit VARCHAR(50) NOT NULL DEFAULT 'nmmol/L'",
            ),
        ],
        "batch_stocks": [
            (
                "loose_min_quantity",
                "ALTER TABLE batch_stocks ADD COLUMN loose_min_quantity INTEGER NOT NULL DEFAULT 0",
            ),
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
        "operators": [
            (
                "is_active",
                "ALTER TABLE operators ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1",
            ),
        ],
        "unit_options": [
            (
                "scope",
                "ALTER TABLE unit_options ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'both'",
            ),
            (
                "is_active",
                "ALTER TABLE unit_options ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1",
            ),
            (
                "sort_order",
                "ALTER TABLE unit_options ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100",
            ),
        ],
        "reagent_groups": [
            (
                "sort_order",
                "ALTER TABLE reagent_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100",
            ),
            (
                "is_active",
                "ALTER TABLE reagent_groups ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1",
            ),
        ],
    }

    with engine.begin() as connection:
        for table_name, statements in migrations.items():
            existing_columns = table_columns.get(table_name, set())
            for column_name, statement in statements:
                if column_name not in existing_columns:
                    connection.execute(text(statement))

        if "instruments" in table_columns:
            connection.execute(
                text(
                    """
                    UPDATE instruments
                    SET default_warning_days = COALESCE(default_warning_days, 30),
                        default_warning_stock = COALESCE(default_warning_stock, 5)
                    """
                )
            )

        if "reagents" in table_columns:
            connection.execute(
                text(
                    """
                    UPDATE reagents
                    SET package_to_min_qty = COALESCE(NULLIF(package_to_min_qty, 0), 1),
                        warning_days = COALESCE(warning_days, 30),
                        warning_stock = COALESCE(warning_stock, 5),
                        follow_instrument = COALESCE(follow_instrument, 1),
                        is_archived = COALESCE(is_archived, 0),
                        is_calibrator = COALESCE(is_calibrator, 0),
                        calibration_result_unit = COALESCE(NULLIF(calibration_result_unit, ''), 'nmmol/L')
                    """
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE reagents
                    SET is_calibrator = 1
                    WHERE TRIM(COALESCE(name, '')) LIKE '%校准品'
                    """
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE reagents
                    SET package_unit = CASE
                            WHEN NULLIF(TRIM(package_unit), '') IS NULL OR package_unit = '次' THEN '盒'
                            ELSE package_unit
                        END,
                        unit = CASE
                            WHEN NULLIF(TRIM(unit), '') IS NULL THEN '次'
                            ELSE unit
                        END,
                        package_to_min_qty = COALESCE(NULLIF(package_to_min_qty, 0), 1)
                    WHERE is_calibrator = 1
                    """
                )
            )

        if "batch_stocks" in table_columns:
            connection.execute(
                text(
                    """
                    UPDATE batch_stocks
                    SET loose_min_quantity = COALESCE(loose_min_quantity, 0)
                    """
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE batch_stocks
                    SET package_unit = COALESCE(
                            (
                                SELECT CASE
                                    WHEN NULLIF(TRIM(batch_stocks.package_unit), '') IS NULL
                                        OR batch_stocks.package_unit = '次'
                                    THEN reagents.package_unit
                                    ELSE batch_stocks.package_unit
                                END
                                FROM reagents
                                WHERE reagents.id = batch_stocks.reagent_id
                            ),
                            '盒'
                        ),
                        min_unit = COALESCE(
                            (
                                SELECT CASE
                                    WHEN NULLIF(TRIM(batch_stocks.min_unit), '') IS NULL
                                    THEN reagents.unit
                                    ELSE batch_stocks.min_unit
                                END
                                FROM reagents
                                WHERE reagents.id = batch_stocks.reagent_id
                            ),
                            '次'
                        ),
                        package_to_min_qty = COALESCE(NULLIF(package_to_min_qty, 0), 1)
                    WHERE reagent_id IN (
                        SELECT id
                        FROM reagents
                        WHERE is_calibrator = 1
                    )
                    """
                )
            )
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

        if "unit_options" in table_columns:
            connection.execute(
                text(
                    """
                    UPDATE unit_options
                    SET scope = COALESCE(NULLIF(scope, ''), 'both'),
                        is_active = COALESCE(is_active, 1),
                        sort_order = COALESCE(sort_order, 100)
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

        if "reagent_groups" in table_columns:
            connection.execute(
                text(
                    """
                    UPDATE reagent_groups
                    SET sort_order = COALESCE(sort_order, 100),
                        is_active = COALESCE(is_active, 1)
                    """
                )
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
