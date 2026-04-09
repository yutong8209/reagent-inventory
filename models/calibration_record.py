from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class CalibrationRecord(Base):
    __tablename__ = "calibration_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    calibrator_reagent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("reagents.id"), nullable=False
    )
    calibrator_batch_stock_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("batch_stocks.id"), nullable=False
    )
    target_reagent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("reagents.id"), nullable=False
    )
    transaction_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("transactions.id"), nullable=True
    )
    raw_barcode: Mapped[str | None] = mapped_column(String(500), nullable=True)
    target_old_batch_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    target_new_batch_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    usage_times: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    result_unit: Mapped[str] = mapped_column(String(50), nullable=False, default="nmmol/L")
    operator: Mapped[str] = mapped_column(String(50), nullable=False)
    old_result_1: Mapped[str | None] = mapped_column(String(100), nullable=True)
    old_result_2: Mapped[str | None] = mapped_column(String(100), nullable=True)
    old_result_3: Mapped[str | None] = mapped_column(String(100), nullable=True)
    old_result_4: Mapped[str | None] = mapped_column(String(100), nullable=True)
    old_result_5: Mapped[str | None] = mapped_column(String(100), nullable=True)
    new_result_1: Mapped[str | None] = mapped_column(String(100), nullable=True)
    new_result_2: Mapped[str | None] = mapped_column(String(100), nullable=True)
    new_result_3: Mapped[str | None] = mapped_column(String(100), nullable=True)
    new_result_4: Mapped[str | None] = mapped_column(String(100), nullable=True)
    new_result_5: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.now, onupdate=datetime.now
    )

    calibrator_reagent: Mapped["Reagent"] = relationship(
        "Reagent", foreign_keys=[calibrator_reagent_id]
    )
    calibrator_batch_stock: Mapped["BatchStock"] = relationship(
        "BatchStock", foreign_keys=[calibrator_batch_stock_id]
    )
    target_reagent: Mapped["Reagent"] = relationship(
        "Reagent", foreign_keys=[target_reagent_id]
    )
    transaction: Mapped["Transaction"] = relationship(
        "Transaction", foreign_keys=[transaction_id]
    )
