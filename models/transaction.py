from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class Transaction(Base):
    __tablename__ = "transactions"

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_transactions_quantity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reagent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("reagents.id"), nullable=False
    )
    batch_stock_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("batch_stocks.id"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    operator: Mapped[str] = mapped_column(String(50), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="scan")
    raw_barcode: Mapped[str] = mapped_column(String(500), nullable=False)
    package_unit: Mapped[str] = mapped_column(String(50), nullable=True)
    min_unit: Mapped[str] = mapped_column(String(50), nullable=True)
    package_to_min_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    remark: Mapped[str] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.now
    )

    reagent: Mapped["Reagent"] = relationship("Reagent")
    batch_stock: Mapped["BatchStock"] = relationship("BatchStock")
