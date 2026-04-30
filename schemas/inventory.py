from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class BatchInfo(BaseModel):
    id: int
    batch_no: str
    expiry_date: str
    expiry_days_left: int
    quantity: int
    loose_min_quantity: int = 0
    available_min_quantity: int = 0
    package_unit: str
    min_unit: str
    package_to_min_qty: int
    is_archived: bool = False
    is_expired: bool = False
    created_at: datetime


class ReagentInfo(BaseModel):
    id: int
    instrument_id: int
    reagent_group_id: Optional[int] = None
    reagent_group_name: Optional[str] = None
    reagent_group_sort_order: int = 9999
    name: str
    unit: str
    package_unit: Optional[str]
    package_to_min_qty: int
    manufacturer: Optional[str]
    is_calibrator: bool = False
    calibration_result_unit: str = "nmmol/L"
    warning_days: int
    warning_stock: int
    single_batch_warning_stock: Optional[int] = None
    effective_warning_days: int
    effective_warning_stock: int
    effective_single_batch_warning_stock: int
    warning_source: Literal["instrument", "reagent"]
    follow_instrument: bool = True
    total_package_quantity: int = 0
    total_min_quantity: int = 0
    batch_count: int = 0
    nearest_expiry_date: Optional[str] = None
    nearest_expiry_days: Optional[int] = None
    has_expired_batch: bool = False
    has_expiring_soon: bool = False
    is_low_stock: bool = False
    status_level: Literal["empty", "expired", "expiring", "low", "normal"] = "normal"
    last_transaction_at: Optional[datetime] = None
    batches: List[BatchInfo]


class InstrumentInfo(BaseModel):
    id: int
    name: str
    model: Optional[str]
    default_warning_days: int
    default_warning_stock: int
    default_single_batch_warning_stock: Optional[int] = None
    reagents: List[ReagentInfo]


class WorkGroupInfo(BaseModel):
    id: int
    name: str
    instruments: List[InstrumentInfo]


class DashboardPendingTasks(BaseModel):
    expired_batch_count: int = 0
    expiring_reagent_count: int = 0
    low_stock_reagent_count: int = 0
    low_stock_batch_count: int = 0
    low_or_empty_reagent_count: int = 0
    zero_stock_unarchived_count: int = 0


class DashboardWarningReagent(BaseModel):
    reagent_id: int
    reagent_name: str
    work_group_id: int
    work_group_name: str
    instrument_id: int
    instrument_name: str
    total_min_quantity: int = 0
    min_unit: str = ""
    nearest_expiry_date: Optional[str] = None
    nearest_expiry_days: Optional[int] = None
    status_level: Literal["empty", "expired", "expiring", "low", "normal"] = "normal"


class DashboardOverviewResponse(BaseModel):
    pending_tasks: DashboardPendingTasks
    warning_reagents: List[DashboardWarningReagent] = Field(default_factory=list)
    recent_outbounds: List["TransactionListItem"] = Field(default_factory=list)


class MobileOverviewResponse(BaseModel):
    pending_tasks: DashboardPendingTasks
    warning_reagents: List[DashboardWarningReagent] = Field(default_factory=list)
    recent_outbounds: List["TransactionListItem"] = Field(default_factory=list)


class ReagentCatalogItem(BaseModel):
    id: int
    instrument_id: int
    instrument_name: str
    work_group_id: int
    work_group_name: str
    reagent_group_id: Optional[int] = None
    reagent_group_name: Optional[str] = None
    reagent_group_sort_order: int = 9999
    name: str
    manufacturer: Optional[str] = None
    is_calibrator: bool = False
    calibration_result_unit: str = "nmmol/L"
    unit: str
    package_unit: str
    package_to_min_qty: int
    warning_days: int
    warning_stock: int
    single_batch_warning_stock: Optional[int] = None
    follow_instrument: bool
    is_archived: bool = False
    effective_warning_days: int
    effective_warning_stock: int
    effective_single_batch_warning_stock: int
    warning_source: Literal["instrument", "reagent"]


class InstrumentCatalogItem(BaseModel):
    id: int
    work_group_id: int
    name: str
    model: Optional[str] = None
    default_warning_days: int = 30
    default_warning_stock: int = 5
    default_single_batch_warning_stock: Optional[int] = None

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
    default_warning_days: int = Field(default=30, ge=0)
    default_warning_stock: int = Field(default=5, ge=0)
    default_single_batch_warning_stock: Optional[int] = Field(default=None, ge=0)


class InstrumentUpdate(BaseModel):
    work_group_id: int
    name: str
    model: Optional[str] = None
    default_warning_days: int = Field(default=30, ge=0)
    default_warning_stock: int = Field(default=5, ge=0)
    default_single_batch_warning_stock: Optional[int] = Field(default=None, ge=0)


class InstrumentWarningDefaultsUpdate(BaseModel):
    default_warning_days: int = Field(default=30, ge=0)
    default_warning_stock: int = Field(default=5, ge=0)
    default_single_batch_warning_stock: Optional[int] = Field(default=None, ge=0)


class ReagentWarningSettingsUpdate(BaseModel):
    follow_instrument: bool = True
    warning_days: int = Field(default=30, ge=0)
    warning_stock: int = Field(default=5, ge=0)
    single_batch_warning_stock: Optional[int] = Field(default=None, ge=0)


class ReagentGroupCatalogItem(BaseModel):
    id: int
    name: str
    sort_order: int = 100
    is_active: bool = True


class AdminPasswordRequest(BaseModel):
    password: str


class ClearTransactionsRequest(BaseModel):
    password: str
    work_group_id: Optional[int] = None
    instrument_id: Optional[int] = None
    reagent_id: Optional[int] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class BatchStockAdjustmentItem(BaseModel):
    batch_stock_id: int
    target_min_quantity: int = Field(ge=0)


class BatchStockAdjustmentRequest(BaseModel):
    password: str
    items: List[BatchStockAdjustmentItem] = Field(default_factory=list)


from .reporting import TransactionListItem

DashboardOverviewResponse.model_rebuild()
