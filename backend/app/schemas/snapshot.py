from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SnapshotItem(BaseModel):
    text: str
    quantity: float | None = None
    unit: str | None = None
    position: int = 0
    was_checked: bool = False


class SnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    list_id: int
    created_at: datetime
    item_count: int
    checked_count: int


class RestoreResponse(BaseModel):
    list_id: int
    list_title: str
