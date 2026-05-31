from datetime import datetime
from typing import TYPE_CHECKING

import enum

from sqlalchemy import ARRAY, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class PlantLocation(str, enum.Enum):
    """Where the plant stands — drives nothing automatic, just metadata
    the user filters/sorts by. Names == values (like ListType), so no
    `values_callable` is needed on the column."""
    SONNIG = "SONNIG"
    HALBSCHATTEN = "HALBSCHATTEN"
    SCHATTEN = "SCHATTEN"


class Plant(Base, TimestampMixin):
    __tablename__ = "plants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    species: Mapped[str | None] = mapped_column(String(255), nullable=True)
    location: Mapped[PlantLocation] = mapped_column(
        Enum(PlantLocation, name="plant_location"),
        nullable=False,
        default=PlantLocation.HALBSCHATTEN,
    )

    # Care intervals in whole days. NULL = tracked, but no reminder fires
    # (mirrors fertilize_interval_days). The scheduler skips NULL intervals.
    watering_interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    watering_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    fertilize: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fertilize_interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    winterhardy: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    edible: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    height_cm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width_cm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free-form grouping ("Bereich": Garten, Wohnung, Balkon, …). Identical
    # mechanism to Recipe.tags — a string array, filtered with .any().
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, nullable=False)

    # --- Recurring-care bookkeeping (not user-facing fields) ---
    #
    # Lyst has no recurring-reminder engine — only one-shot reminders with a
    # `sent` flag. We get recurrence the cheap way: "next due" is computed as
    # last_*_at + interval (never stored), and a per-cycle `*_reminder_sent`
    # boolean stops the once-a-minute scheduler from re-sending. Marking a
    # plant watered/fertilised (POST /water, /fertilize) resets the flag, which
    # arms the next cycle — same re-arm shape as task reminders flipping
    # reminder_sent when reminder_at moves.
    last_watered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    last_fertilized_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    water_reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fertilize_reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    owner: Mapped["User"] = relationship()
