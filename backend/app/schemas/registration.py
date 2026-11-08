from datetime import datetime, timezone
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    computed_field,
)


class RegistrationLinkCreate(BaseModel):
    expires_in_days: int = Field(default=7, ge=1, le=30)
    max_uses: int = Field(default=10, ge=1, le=100)


class RegistrationLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    token: str
    max_uses: int
    used_count: int
    expires_at: datetime
    created_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def status(self) -> str:
        """active | expired | exhausted — what the admin list shows."""
        if self.expires_at <= datetime.now(timezone.utc):
            return "expired"
        if self.used_count >= self.max_uses:
            return "exhausted"
        return "active"


class RegisterRequest(BaseModel):
    token: str = Field(min_length=1, max_length=64)
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
