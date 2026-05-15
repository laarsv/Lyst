from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    # Task fields (alembic 0018). Sending null explicitly clears the
    # column — the router uses exclude_unset to distinguish "not
    # provided" from "set to null". assignee_id is validated against
    # the parent list's owner + collaborator set; non-permitted values
    # are rejected with a 400.
    assignee_id: int | None = None
    due_at: datetime | None = None
    reminder_at: datetime | None = None


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
    # Task fields surface on every list item — clients use null vs
    # non-null on any of (assignee_id, due_at, reminder_at) to decide
    # whether the item is an "active task" worth rendering chips for.
    assignee_id: int | None = None
    assignee_name: str | None = None
    due_at: datetime | None = None
    reminder_at: datetime | None = None
    reminder_sent: bool = False


class BulkItemsCreate(BaseModel):
    """Bulk add accepts either a list of plain text lines (legacy) or a list
    of fully-structured items (so the frontend can send pre-parsed
    quantity/unit/text per line). Exactly one of the two must be set."""

    lines: list[str] | None = None
    items: list[ListItemCreate] | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "BulkItemsCreate":
        has_lines = bool(self.lines)
        has_items = bool(self.items)
        if has_lines == has_items:
            raise ValueError("Provide exactly one of `lines` or `items`")
        return self


class ReorderItem(BaseModel):
    id: int
    position: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]
