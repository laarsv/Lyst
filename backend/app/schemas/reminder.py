from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReminderCreate(BaseModel):
    remind_at: datetime
    message: str | None = Field(default=None, max_length=500)


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    list_id: int
    user_id: int
    remind_at: datetime
    message: str | None
    sent: bool
    created_at: datetime
