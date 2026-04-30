from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class BatchStockInfo(BaseModel):
    id: int
    batch_no: str
    expiry_date: date
    quantity: int
    loose_min_quantity: int = 0
    available_min_quantity: int = 0
    package_unit: str
    min_unit: str
    package_to_min_qty: int
    is_archived: bool = False
    is_expired: bool = False
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
    package_unit: str = "鐩?"
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
    reagent_group_id: Optional[int] = None
    reagent_name: str
    manufacturer: Optional[str] = None
    batch_no: str
    expiry_date: date
    quantity: int = Field(gt=0)
    package_unit: str = "鐩?"
    min_unit: Optional[str] = None
    package_to_min_qty: int = Field(default=1, gt=0)
    warning_days: Optional[int] = Field(default=None, ge=0)
    warning_stock: Optional[int] = Field(default=None, ge=0)
    single_batch_warning_stock: Optional[int] = Field(default=None, ge=0)
    raw_barcode: str = ""
    parsed_batch_no: Optional[str] = None


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


class OutboundReagentItem(BaseModel):
    reagent_id: int
    reagent_name: str
    instrument_id: int
    instrument_name: str
    work_group_id: int
    work_group_name: str
    reagent_group_id: Optional[int] = None
    reagent_group_name: Optional[str] = None
    reagent_group_sort_order: int = 9999
    package_unit: str
    min_unit: str
    package_to_min_qty: int
    total_package_quantity: int
    total_min_quantity: int
    nearest_expiry_date: Optional[date] = None
    contains_expired: bool = False
    batch_count: int = 0


class StockOutPreviewRequest(BaseModel):
    source: Literal["scan", "manual"] = "manual"
    reagent_id: int
    quantity: int = Field(gt=0)
    outbound_unit: Literal["package", "min"] = "min"
    deduction_mode: Literal["fefo", "scanned_batch"] = "fefo"
    raw_barcode: str = ""
    scanned_batch_no: Optional[str] = None
    scanned_expiry_date: Optional[date] = None


class OutboundPreviewBatch(BaseModel):
    batch_stock_id: int
    batch_no: str
    expiry_date: date
    package_quantity: int
    loose_min_quantity: int
    available_min_quantity: int
    deducted_min_quantity: int
    is_expired: bool
    is_scanned_batch: bool = False


class StockOutPreviewResponse(BaseModel):
    reagent_id: int
    reagent_name: str
    instrument_id: Optional[int] = None
    instrument_name: Optional[str] = None
    work_group_id: Optional[int] = None
    work_group_name: Optional[str] = None
    package_unit: str
    min_unit: str
    package_to_min_qty: int
    requested_quantity: int
    outbound_unit: Literal["package", "min"]
    requested_min_quantity: int
    deduction_mode: Literal["fefo", "scanned_batch"]
    total_package_quantity: int
    total_min_quantity: int
    contains_expired: bool = False
    has_earlier_expiring_batch: bool = False
    earlier_expiring_batches: List[OutboundPreviewBatch] = Field(default_factory=list)
    selected_batch_stock_id: Optional[int] = None
    selected_batch_no: Optional[str] = None
    selected_expiry_date: Optional[date] = None
    deducted_batches: List[OutboundPreviewBatch] = Field(default_factory=list)


class StockOutBatchItem(BaseModel):
    source: Literal["scan", "manual"] = "manual"
    reagent_id: int
    quantity: int = Field(gt=0)
    outbound_unit: Literal["package", "min"] = "min"
    deduction_mode: Literal["fefo", "scanned_batch"] = "fefo"
    raw_barcode: str = ""
    scanned_batch_no: Optional[str] = None
    scanned_expiry_date: Optional[date] = None


class StockOutItemResult(BaseModel):
    reagent_id: int
    reagent_name: str
    outbound_unit: Literal["package", "min"]
    requested_quantity: int
    requested_min_quantity: int
    deduction_mode: Literal["fefo", "scanned_batch"]
    contains_expired: bool = False
    deducted_batches: List[OutboundPreviewBatch] = Field(default_factory=list)


class StockOutBatchRequest(BaseModel):
    operator: str
    items: List[StockOutBatchItem]


class StockOutBatchResponse(BaseModel):
    success: bool
    item_count: int
    items: List[StockOutItemResult]
    warnings: List[str] = Field(default_factory=list)


class StockOutRequest(BaseModel):
    batch_stock_id: Optional[int] = None
    reagent_id: Optional[int] = None
    quantity: int = Field(gt=0)
    operator: str
    raw_barcode: str
    outbound_unit: Literal["package", "min"] = "package"
    deduction_mode: Optional[Literal["fefo", "scanned_batch"]] = None
    scanned_batch_no: Optional[str] = None
    scanned_expiry_date: Optional[date] = None


class StockOutResponse(BaseModel):
    success: bool
    remaining_quantity: int
    deducted_batches: List[dict] = Field(default_factory=list)


class InventoryQuery(BaseModel):
    instrument_id: Optional[int] = None
