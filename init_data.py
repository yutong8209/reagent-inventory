import sys
sys.path.insert(0, ".")

from db import SessionLocal, ensure_schema
from models import WorkGroup, Instrument
from services import ensure_default_catalog, ensure_default_operators


def init_database():
    print("Creating database tables...")
    ensure_schema()
    print("Tables created.")


def init_base_data():
    db = SessionLocal()
    try:
        print("Synchronizing default catalog...")
        ensure_default_catalog(db)
        ensure_default_operators(db)

        work_groups = db.query(WorkGroup).all()
        instruments = db.query(Instrument).all()
        print("Default catalog synchronized successfully.")
        print(f"  - Work groups: {len(work_groups)}")
        print(f"  - Instruments: {len(instruments)}")

    except Exception as e:
        db.rollback()
        print(f"Error initializing data: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    init_database()
    init_base_data()
    print("\nDatabase initialization complete.")
