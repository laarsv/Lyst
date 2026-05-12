from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ListItemBase(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    quantity: float | None = None
    unit: str | None = Field(default=None, max_length=32)


class ListItemCreate(ListItemBase):
    is_checked: bool = False


class ListItemUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=500)
    is_checked: bool | None = None
    quantity: float | None = None
    unit: str | None = Field(default=None, max_length=32)
    # When the client patches `category` directly, the items router treats
    # that as a manual override and flips category_locked to True so future
    # auto-categorization runs leave it alone.
    category: str | None = Field(default=None, max_length=64)


class ListItemOut(ListItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    list_id: int
    is_checked: bool
    position: int
    category: str | None = None
    category_locked: bool = False
    created_at: datetime
    updated_at: datetime


class BulkItemsCreate(BaseModel):
    lines: list[str] = Field(min_length=1)


class ReorderItem(BaseModel):
    id: int
    position: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]
