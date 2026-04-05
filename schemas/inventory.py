from typing import List, Optional

from pydantic import BaseModel, Field


class BatchInfo(BaseModel):
    id: int
    batch_no: str
    expiry_date: str
    quantity: int
    loose_min_quantity: int = 0
    available_min_quantity: int = 0
    package_unit: str
    min_unit: str
    package_to_min_qty: int
    is_expired: bool = False


class ReagentInfo(BaseModel):
    id: int
    name: str
    unit: str
    package_unit: Optional[str]
    package_to_min_qty: int
    manufacturer: Optional[str]
    batches: List[BatchInfo]


class InstrumentInfo(BaseModel):
    id: int
    name: str
    model: Optional[str]
    reagents: List[ReagentInfo]


class WorkGroupInfo(BaseModel):
    id: int
    name: str
    instruments: List[InstrumentInfo]


class ReagentCatalogItem(BaseModel):
    id: int
    instrument_id: int
    instrument_name: str
    work_group_id: int
    work_group_name: str
    name: str
    manufacturer: Optional[str] = None
    unit: str
    package_unit: str
    package_to_min_qty: int
    warning_days: int
    warning_stock: int


class InstrumentCatalogItem(BaseModel):
    id: int
    work_group_id: int
    name: str
    model: Optional[str] = None

    class Config:
        from_attributes = True


class WorkGroupCatalogItem(BaseModel):
    id: int
    name: str
    instruments: List[InstrumentCatalogItem] = Field(default_factory=list)


class WorkGroupCreate(BaseModel):
    name: str


class WorkGroupUpdate(BaseModel):
    name: str


class InstrumentCreate(BaseModel):
    work_group_id: int
    name: str
    model: Optional[str] = None


class InstrumentUpdate(BaseModel):
    work_group_id: int
    name: str
    model: Optional[str] = None
