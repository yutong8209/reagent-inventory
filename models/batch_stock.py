from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class BatchStock(Base):
    __tablename__ = "batch_stocks"

    __table_args__ = (
        UniqueConstraint("reagent_id", "batch_no", "expiry_date", name="uq_batch_stocks"),
        CheckConstraint("quantity >= 0", name="ck_batch_stocks_quantity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reagent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("reagents.id"), nullable=False
    )
    batch_no: Mapped[str] = mapped_column(String(100), nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    package_unit: Mapped[str] = mapped_column(String(50), nullable=False, default="盒")
    min_unit: Mapped[str] = mapped_column(String(50), nullable=False, default="瓶")
    package_to_min_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.now, onupdate=datetime.now
    )

    reagent: Mapped["Reagent"] = relationship("Reagent")
