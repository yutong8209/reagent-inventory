from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UnitOptionResponse(BaseModel):
    id: int
    name: str
    scope: Literal["package", "min", "both"]
    is_active: bool = True
    sort_order: int = 100
    created_at: datetime

    class Config:
        from_attributes = True


class UnitOptionCreate(BaseModel):
    name: str
    scope: Literal["package", "min", "both"] = "both"
    is_active: bool = True
    sort_order: int = Field(default=100, ge=0)


class UnitOptionUpdate(BaseModel):
    name: str
    scope: Literal["package", "min", "both"] = "both"
    is_active: bool = True
    sort_order: int = Field(default=100, ge=0)
