from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ReagentCreate(BaseModel):
    instrument_id: int
    name: str
    match_mode: Literal["exact", "prefix"] = "exact"
    match_pattern: str
    raw_barcode_sample: Optional[str] = None
    manufacturer: Optional[str] = None
    unit: str = "瓶"
    package_unit: str = "盒"
    package_to_min_qty: int = Field(default=1, gt=0)
    warning_days: int = 30
    warning_stock: int = 5


class ReagentResponse(BaseModel):
    id: int
    instrument_id: int
    name: str
    match_mode: str
    match_pattern: str
    raw_barcode_sample: Optional[str]
    manufacturer: Optional[str]
    unit: str
    package_unit: str
    package_to_min_qty: int
    warning_days: int
    warning_stock: int
    created_at: datetime

    class Config:
        from_attributes = True


class ReagentUpdate(BaseModel):
    instrument_id: int
    name: str
    manufacturer: Optional[str] = None
    unit: str = "瓶"
    package_unit: str = "盒"
    package_to_min_qty: int = Field(default=1, gt=0)
    warning_days: int = 30
    warning_stock: int = 5
