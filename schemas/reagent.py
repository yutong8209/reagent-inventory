from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ReagentCreate(BaseModel):
    instrument_id: int
    reagent_group_id: Optional[int] = None
    name: str
    match_mode: Literal["exact", "prefix"] = "exact"
    match_pattern: str
    raw_barcode_sample: Optional[str] = None
    manufacturer: Optional[str] = None
    unit: str = "瓶"
    package_unit: str = "盒"
    package_to_min_qty: int = Field(default=1, gt=0)
    warning_days: int = Field(default=30, ge=0)
    warning_stock: int = Field(default=5, ge=0)
    single_batch_warning_stock: Optional[int] = Field(default=None, ge=0)
    follow_instrument: bool = True
    is_calibrator: Optional[bool] = None
    calibration_result_unit: Optional[str] = "nmmol/L"


class ReagentResponse(BaseModel):
    id: int
    instrument_id: int
    reagent_group_id: Optional[int]
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
    single_batch_warning_stock: Optional[int] = None
    follow_instrument: bool
    is_calibrator: bool = False
    calibration_result_unit: str = "nmmol/L"
    is_archived: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class ReagentUpdate(BaseModel):
    instrument_id: int
    reagent_group_id: Optional[int] = None
    name: str
    manufacturer: Optional[str] = None
    unit: str = "瓶"
    package_unit: str = "盒"
    package_to_min_qty: int = Field(default=1, gt=0)
    warning_days: int = Field(default=30, ge=0)
    warning_stock: int = Field(default=5, ge=0)
    single_batch_warning_stock: Optional[int] = Field(default=None, ge=0)
    follow_instrument: bool = False
    is_calibrator: bool = False
    calibration_result_unit: str = "nmmol/L"
