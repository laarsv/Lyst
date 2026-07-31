"""Wire shapes for the "Heute" overview (GET /dashboard).

One response, five independent blocks. Every block is time-critical: it shows
things the user would otherwise MISS, not counters. Empty blocks come back as
empty lists / null and the frontend drops them entirely, so a quiet day means
a short screen rather than a wall of cheerful placeholders.
"""
from datetime import datetime

from pydantic import BaseModel


class OpenSessionOut(BaseModel):
    """The single in-progress workout session, if any (fitness_service
    guarantees at most one open session per user)."""

    id: int
    workout_id: int | None = None
    workout_name: str | None = None
    started_at: datetime
    logged_sets: int


class DuePlantOut(BaseModel):
    id: int
    name: str
    image_url: str | None = None
    next_water_due: datetime
    days_overdue: int  # 0 = due today, >0 = overdue


class DueTaskOut(BaseModel):
    """Mirrors the /tasks aggregator's wire shape for the fields we need.
    `source` distinguishes the two backing tables so the frontend can route
    the click to the right parent."""

    id: int
    source: str  # 'list' | 'note'
    text: str
    due_at: datetime | None = None
    is_overdue: bool
    parent_id: int
    parent_title: str


class TodayMealOut(BaseModel):
    entry_id: int
    recipe_id: int
    recipe_title: str
    meal_type: str
    servings: int
    image_url: str | None = None


class UpcomingReminderOut(BaseModel):
    id: int
    list_id: int
    list_title: str
    remind_at: datetime
    message: str | None = None


class DashboardOut(BaseModel):
    open_session: OpenSessionOut | None = None
    due_plants: list[DuePlantOut] = []
    due_tasks: list[DueTaskOut] = []
    today_meals: list[TodayMealOut] = []
    upcoming_reminders: list[UpcomingReminderOut] = []
