from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class TransactionListItem(BaseModel):
    id: int
    created_at: datetime
    type: str
    work_group_id: Optional[int] = None
    work_group_name: str = ""
    instrument_id: Optional[int] = None
    instrument_name: str = ""
    reagent_id: int
    reagent_name: str
    manufacturer: Optional[str] = None
    batch_no: str = ""
    quantity_min: int
    min_unit: str = ""
    operator: str
    source: str


class UsageSummaryItem(BaseModel):
    reagent_id: int
    reagent_name: str
    manufacturer: Optional[str] = None
    work_group_id: Optional[int] = None
    work_group_name: str = ""
    instrument_id: Optional[int] = None
    instrument_name: str = ""
    start_date: date
    end_date: date
    total_usage_min: int
    min_unit: str = ""


class ReportReagentOption(BaseModel):
    id: int
    name: str
    manufacturer: Optional[str] = None
    work_group_id: Optional[int] = None
    work_group_name: str = ""
    instrument_id: Optional[int] = None
    instrument_name: str = ""
    min_unit: str = ""
    is_archived: bool = False
