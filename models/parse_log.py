from datetime import datetime
from sqlalchemy import Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db.base import Base


class ParseLog(Base):
    __tablename__ = "parse_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    raw_barcode: Mapped[str] = mapped_column(String(500), nullable=False)
    match_result: Mapped[str] = mapped_column(String(20), nullable=False)
    matched_reagent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("reagents.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.now
    )

    matched_reagent: Mapped["Reagent"] = relationship("Reagent")
