from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class BatchStockInfo(BaseModel):
    id: int
    batch_no: str
    expiry_date: date
    quantity: int
    package_unit: str
    min_unit: str
    package_to_min_qty: int
    created_at: datetime

    class Config:
        from_attributes = True


class StockInRequest(BaseModel):
    reagent_id: int
    batch_no: str
    expiry_date: date
    quantity: int = Field(gt=0)
    operator: str
    raw_barcode: str
    package_unit: str = "盒"
    min_unit: Optional[str] = None
    package_to_min_qty: int = Field(default=1, gt=0)
    source: Literal["scan", "manual"] = "scan"


class StockInResponse(BaseModel):
    success: bool
    batch_stock_id: int
    current_quantity: int
    warning: Optional[str] = None


class StockInBatchItem(BaseModel):
    source: Literal["scan", "manual"] = "scan"
    reagent_id: Optional[int] = None
    work_group_id: Optional[int] = None
    instrument_id: Optional[int] = None
    reagent_name: str
    manufacturer: Optional[str] = None
    batch_no: str
    expiry_date: date
    quantity: int = Field(gt=0)
    package_unit: str = "盒"
    min_unit: Optional[str] = None
    package_to_min_qty: int = Field(default=1, gt=0)
    warning_days: int = Field(default=30, ge=0)
    warning_stock: int = Field(default=5, ge=0)
    raw_barcode: str = ""


class StockInItemResult(BaseModel):
    reagent_id: int
    reagent_name: str
    batch_stock_id: int
    batch_no: str
    quantity: int
    package_unit: str
    min_unit: str
    package_to_min_qty: int
    current_quantity: int
    warning: Optional[str] = None


class StockInBatchRequest(BaseModel):
    operator: str
    items: List[StockInBatchItem]


class StockInBatchResponse(BaseModel):
    success: bool
    item_count: int
    items: List[StockInItemResult]
    warnings: List[str] = Field(default_factory=list)


class StockOutRequest(BaseModel):
    batch_stock_id: Optional[int] = None
    reagent_id: Optional[int] = None
    quantity: int
    operator: str
    raw_barcode: str


class StockOutResponse(BaseModel):
    success: bool
    remaining_quantity: int
    deducted_batches: List[dict] = Field(default_factory=list)


class InventoryQuery(BaseModel):
    instrument_id: Optional[int] = None
