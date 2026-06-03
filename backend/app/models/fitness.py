from datetime import datetime
from typing import TYPE_CHECKING

import enum

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class ExerciseType(str, enum.Enum):
    AUFBAU = "AUFBAU"
    DEHNEN = "DEHNEN"
    PHYSIO = "PHYSIO"


class ExerciseLocation(str, enum.Enum):
    STUDIO = "STUDIO"
    HOME = "HOME"
    BEIDES = "BEIDES"


class TrackingType(str, enum.Enum):
    """Drives which set_log fields are logged/validated:
      REPS        → reps_done only
      WEIGHT_REPS → reps_done required, weight_done optional (bodyweight + add-on)
      TIME        → duration_done only
    """
    REPS = "REPS"
    WEIGHT_REPS = "WEIGHT_REPS"
    TIME = "TIME"


class Exercise(Base, TimestampMixin):
    """Shared exercise library. owner_id NULL = global seed (everyone sees it,
    nobody edits it). A non-null owner_id is a user-created exercise — visible
    to ALL users (read), editable/deletable only by its owner."""
    __tablename__ = "exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    muscle_group: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    type: Mapped[ExerciseType] = mapped_column(
        Enum(ExerciseType, name="exercise_type"), nullable=False
    )
    location: Mapped[ExerciseLocation] = mapped_column(
        Enum(ExerciseLocation, name="exercise_location"), nullable=False
    )
    tracking_type: Mapped[TrackingType] = mapped_column(
        Enum(TrackingType, name="tracking_type"), nullable=False
    )
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)


class Workout(Base, TimestampMixin):
    """A user's private workout template (an ordered list of exercises)."""
    __tablename__ = "workouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    exercises: Mapped[list["WorkoutExercise"]] = relationship(
        back_populates="workout",
        cascade="all, delete-orphan",
        order_by="WorkoutExercise.position",
    )


class WorkoutExercise(Base, TimestampMixin):
    """Join: an exercise inside a workout, with per-slot targets."""
    __tablename__ = "workout_exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workout_id: Mapped[int] = mapped_column(
        ForeignKey("workouts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # RESTRICT: an exercise referenced by a workout cannot be deleted (clear
    # error in the service instead of silently breaking the workout).
    exercise_id: Mapped[int] = mapped_column(
        ForeignKey("exercises.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    target_sets: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_reps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    workout: Mapped["Workout"] = relationship(back_populates="exercises")
    exercise: Mapped["Exercise"] = relationship()


class WorkoutSession(Base, TimestampMixin):
    """A logged training session (private per user). workout_id NULL = free
    training. Exactly one open session (finished_at IS NULL) per user."""
    __tablename__ = "workout_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workout_id: Mapped[int | None] = mapped_column(
        ForeignKey("workouts.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    sets: Mapped[list["SetLog"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SetLog.id",
    )


class SetLog(Base, TimestampMixin):
    """A single logged set within a session."""
    __tablename__ = "set_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exercise_id: Mapped[int] = mapped_column(
        ForeignKey("exercises.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    set_number: Mapped[int] = mapped_column(Integer, nullable=False)
    reps_done: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_done: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_done: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    session: Mapped["WorkoutSession"] = relationship(back_populates="sets")
