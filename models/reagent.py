from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class Reagent(Base):
    __tablename__ = "reagents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    instrument_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("instruments.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    match_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="exact")
    match_pattern: Mapped[str] = mapped_column(String(500), nullable=False)
    raw_barcode_sample: Mapped[str] = mapped_column(String(500), nullable=True)
    manufacturer: Mapped[str] = mapped_column(String(200), nullable=True)
    unit: Mapped[str] = mapped_column(String(50), nullable=False, default="瓶")
    package_unit: Mapped[str] = mapped_column(String(50), nullable=False, default="盒")
    package_to_min_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    warning_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    warning_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    follow_instrument: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_calibrator: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    calibration_result_unit: Mapped[str] = mapped_column(
        String(50), nullable=False, default="nmmol/L"
    )
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.now
    )

    instrument: Mapped["Instrument"] = relationship("Instrument")
