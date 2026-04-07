from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class BarcodeBatchRule(Base):
    __tablename__ = "barcode_batch_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    instrument_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("instruments.id"), nullable=False
    )
    reagent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("reagents.id"), nullable=True
    )
    product_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    batch_anchor: Mapped[str | None] = mapped_column(String(20), nullable=True)
    batch_offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    batch_length: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_barcode_sample: Mapped[str | None] = mapped_column(String(500), nullable=True)
    learned_batch_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.now
    )

    instrument: Mapped["Instrument"] = relationship("Instrument")
    reagent: Mapped["Reagent"] = relationship("Reagent")
