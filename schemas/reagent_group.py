from datetime import datetime

from pydantic import BaseModel, Field


class ReagentGroupCreate(BaseModel):
    name: str
    sort_order: int = Field(default=100, ge=0)
    is_active: bool = True


class ReagentGroupUpdate(BaseModel):
    name: str
    sort_order: int = Field(default=100, ge=0)
    is_active: bool = True


class ReagentGroupResponse(BaseModel):
    id: int
    name: str
    sort_order: int = 100
    is_active: bool = True
    created_at: datetime

    class Config:
        from_attributes = True
