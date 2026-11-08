from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class RegistrationLink(Base, TimestampMixin):
    """A shareable sign-up link an admin hands to a group (e.g. a holiday party).

    Anyone holding the token can create a normal (role USER) account until the link
    expires or `used_count` reaches `max_uses`. Deleting the row revokes the link.
    `used_count` is only ever bumped by one atomic UPDATE in registration_service, so
    concurrent sign-ups cannot overshoot `max_uses`. `created_by_id` is informational
    and goes NULL if that admin is deleted.
    """

    __tablename__ = "registration_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
