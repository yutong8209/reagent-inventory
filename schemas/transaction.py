from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class TransactionResponse(BaseModel):
    id: int
    reagent_id: int
    batch_stock_id: Optional[int]
    type: str
    quantity: int
    operator: str
    source: str
    raw_barcode: str
    package_unit: Optional[str]
    min_unit: Optional[str]
    package_to_min_qty: int
    remark: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
