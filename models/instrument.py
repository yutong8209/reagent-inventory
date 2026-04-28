from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class Instrument(Base):
    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("work_groups.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=True)
    default_warning_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    default_warning_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    default_single_batch_warning_stock: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.now
    )

    work_group: Mapped["WorkGroup"] = relationship("WorkGroup")
