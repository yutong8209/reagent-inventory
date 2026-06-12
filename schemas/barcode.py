from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class CandidateInfo(BaseModel):
    id: int
    name: str
    instrument_id: Optional[int] = None
    instrument_name: Optional[str] = None
    work_group_id: Optional[int] = None
    work_group_name: Optional[str] = None
    package_unit: Optional[str] = None
    min_unit: Optional[str] = None
    package_to_min_qty: int = 1


class BarcodeParseRequest(BaseModel):
    barcode: str


class BarcodeParseResult(BaseModel):
    raw_barcode: str
    match_type: Literal["exact", "prefix", "none"]
    reagent_id: Optional[int] = None
    reagent_name: Optional[str] = None
    instrument_id: Optional[int] = None
    instrument_name: Optional[str] = None
    work_group_id: Optional[int] = None
    work_group_name: Optional[str] = None
    extracted_product_code: Optional[str] = None
    extracted_production_date: Optional[date] = None
    extracted_batch_no: Optional[str] = None
    extracted_expiry_date: Optional[date] = None
    package_unit: Optional[str] = None
    min_unit: Optional[str] = None
    package_to_min_qty: int = 1
    confidence: Literal["high", "medium", "low"]
    candidates: List[CandidateInfo] = Field(default_factory=list)
