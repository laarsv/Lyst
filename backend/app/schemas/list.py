from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.list import ListType


class ListBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    type: ListType = ListType.CUSTOM
    description: str | None = None
    color: str | None = Field(default=None, max_length=9)
    icon: str | None = Field(default=None, max_length=16)


class ListCreate(ListBase):
    pass


class ListUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    type: ListType | None = None
    description: str | None = None
    color: str | None = Field(default=None, max_length=9)
    icon: str | None = Field(default=None, max_length=16)
    is_template: bool | None = None
    template_name: str | None = None


class ListDuplicate(BaseModel):
    title: str | None = None
    as_template: bool = False
    template_name: str | None = None


class ListOut(ListBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    is_template: bool
    template_name: str | None
    share_enabled: bool
    share_token: str | None
    created_at: datetime
    updated_at: datetime
    item_count: int = 0
    checked_count: int = 0
    is_owner: bool = True
    permission: str | None = None
