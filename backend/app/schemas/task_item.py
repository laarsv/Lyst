"""Schemas for note task items + the global /tasks aggregator."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TaskItemCreate(BaseModel):
    text: str = Field(default="", max_length=2000)
    is_done: bool = False
    position: int = 0


class TaskItemUpdate(BaseModel):
    text: str | None = Field(default=None, max_length=2000)
    is_done: bool | None = None
    position: int | None = None
    assignee_id: int | None = None
    due_at: datetime | None = None
    reminder_at: datetime | None = None


class TaskItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    note_id: int
    text: str
    is_done: bool
    position: int
    assignee_id: int | None = None
    assignee_name: str | None = None
    due_at: datetime | None = None
    reminder_at: datetime | None = None
    reminder_sent: bool = False
    created_at: datetime
    updated_at: datetime


class AggregatedTask(BaseModel):
    """Row in GET /tasks. Combines list items + note task items into a
    single uniform shape so the frontend doesn't have to special-case
    sources beyond a string discriminator."""

    id: int
    source: str  # "list" | "note"
    source_id: int  # list_id OR note_id
    source_title: str
    owner_id: int
    text: str
    is_done: bool
    assignee_id: int | None = None
    assignee_name: str | None = None
    due_at: datetime | None = None
    reminder_at: datetime | None = None
