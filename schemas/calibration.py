from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class CalibrationBatchCandidate(BaseModel):
    batch_stock_id: int
    batch_no: str
    expiry_date: str
    expiry_days_left: int
    available_min_quantity: int
    min_unit: str
    created_at: datetime


class CalibrationTargetCandidate(BaseModel):
    reagent_id: int
    reagent_name: str
    instrument_id: int
    instrument_name: str
    work_group_id: int
    work_group_name: str
    reagent_group_id: Optional[int] = None
    reagent_group_name: Optional[str] = None
    reagent_group_sort_order: int = 9999
    calibration_result_unit: str = "nmmol/L"


class CalibrationTargetPreviewResponse(BaseModel):
    target_reagent_id: int
    target_reagent_name: str
    result_unit: str = "nmmol/L"
    old_batch_candidates: list[CalibrationBatchCandidate] = Field(default_factory=list)
    new_batch_candidates: list[CalibrationBatchCandidate] = Field(default_factory=list)
    default_old_batch_no: Optional[str] = None
    default_new_batch_no: Optional[str] = None


class CalibrationScanPreviewResponse(BaseModel):
    calibration_source: str = "calibrator"
    calibrator_reagent_id: int
    calibrator_name: str
    calibrator_batch_stock_id: int
    calibrator_batch_no: str
    calibrator_expiry_date: Optional[str] = None
    calibrator_available_min_quantity: int = 0
    calibrator_min_unit: str = "次"
    target_reagent_id: Optional[int] = None
    target_reagent_name: Optional[str] = None
    target_options: list[CalibrationTargetCandidate] = Field(default_factory=list)
    old_batch_candidates: list[CalibrationBatchCandidate] = Field(default_factory=list)
    new_batch_candidates: list[CalibrationBatchCandidate] = Field(default_factory=list)
    default_old_batch_no: Optional[str] = None
    default_new_batch_no: Optional[str] = None
    default_usage_times: int = 1
    result_unit: str = "nmmol/L"
    raw_barcode: str


class CalibrationRecordCreate(BaseModel):
    calibrator_reagent_id: int
    calibrator_batch_stock_id: int
    target_reagent_id: int
    target_old_batch_no: Optional[str] = None
    target_new_batch_no: Optional[str] = None
    usage_times: int = Field(default=1, ge=1)
    result_unit: str = "nmmol/L"
    operator: str
    raw_barcode: Optional[str] = None
    auto_outbound_package: bool = False
    old_result_1: Optional[str] = None
    old_result_2: Optional[str] = None
    old_result_3: Optional[str] = None
    old_result_4: Optional[str] = None
    old_result_5: Optional[str] = None
    new_result_1: Optional[str] = None
    new_result_2: Optional[str] = None
    new_result_3: Optional[str] = None
    new_result_4: Optional[str] = None
    new_result_5: Optional[str] = None


class CalibrationRecordUpdate(BaseModel):
    target_reagent_id: int
    target_old_batch_no: Optional[str] = None
    target_new_batch_no: Optional[str] = None
    usage_times: int = Field(default=1, ge=1)
    result_unit: str = "nmmol/L"
    operator: str
    old_result_1: Optional[str] = None
    old_result_2: Optional[str] = None
    old_result_3: Optional[str] = None
    old_result_4: Optional[str] = None
    old_result_5: Optional[str] = None
    new_result_1: Optional[str] = None
    new_result_2: Optional[str] = None
    new_result_3: Optional[str] = None
    new_result_4: Optional[str] = None
    new_result_5: Optional[str] = None


class CalibrationRecordItem(BaseModel):
    id: int
    calibration_source: str = "calibrator"
    calibrator_reagent_id: int
    calibrator_name: str
    calibrator_batch_stock_id: int
    calibrator_batch_no: str
    target_reagent_id: int
    target_reagent_name: str
    target_old_batch_no: Optional[str] = None
    target_new_batch_no: Optional[str] = None
    usage_times: int
    result_unit: str
    operator: str
    old_result_1: Optional[str] = None
    old_result_2: Optional[str] = None
    old_result_3: Optional[str] = None
    old_result_4: Optional[str] = None
    old_result_5: Optional[str] = None
    new_result_1: Optional[str] = None
    new_result_2: Optional[str] = None
    new_result_3: Optional[str] = None
    new_result_4: Optional[str] = None
    new_result_5: Optional[str] = None
    target_options: list[CalibrationTargetCandidate] = Field(default_factory=list)
    old_batch_candidates: list[CalibrationBatchCandidate] = Field(default_factory=list)
    new_batch_candidates: list[CalibrationBatchCandidate] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
