from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class StockAdjustmentRecord(Base):
    __tablename__ = "stock_adjustment_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    adjustment_group_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    work_group_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    work_group_name: Mapped[str] = mapped_column(String(100), nullable=False)
    instrument_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    instrument_name: Mapped[str] = mapped_column(String(100), nullable=False)
    reagent_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    reagent_name: Mapped[str] = mapped_column(String(200), nullable=False)
    batch_stock_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    batch_no: Mapped[str] = mapped_column(String(100), nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    old_min_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    new_min_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    delta_min_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    min_unit: Mapped[str] = mapped_column(String(50), nullable=False)
    package_unit: Mapped[str] = mapped_column(String(50), nullable=False)
    package_to_min_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    operator: Mapped[str] = mapped_column(String(50), nullable=False, default="库存调整")
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="stock_adjustment")
    remark: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, index=True)
