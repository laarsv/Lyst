"""Pydantic schemas for the in-app notification feed."""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    """Single bell entry. `payload` carries per-kind denormalised
    fields (actor name, title, deep-link target, …) — the frontend
    reads it directly rather than chasing references on render."""

    id: int
    kind: str
    payload: dict[str, Any]
    read_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotificationListResponse(BaseModel):
    """Wrap the list with an unread_count so the bell badge has it
    without a second round-trip. count is total unread, not just
    the unread inside this page — the dropdown shows ~20 newest but
    the badge has to reflect everything."""

    items: list[NotificationOut]
    unread_count: int
