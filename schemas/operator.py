from datetime import datetime

from pydantic import BaseModel


class OperatorBase(BaseModel):
    name: str


class OperatorCreate(OperatorBase):
    pass


class OperatorUpdate(OperatorBase):
    is_active: bool = True


class OperatorResponse(BaseModel):
    id: int
    name: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
