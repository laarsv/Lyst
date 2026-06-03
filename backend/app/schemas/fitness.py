from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.fitness import ExerciseLocation, ExerciseType, TrackingType


# ---------- Exercises (shared library) ----------

class ExerciseBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    muscle_group: str = Field(min_length=1, max_length=64)
    type: ExerciseType
    location: ExerciseLocation
    tracking_type: TrackingType
    instructions: str | None = None
    image_url: str | None = Field(default=None, max_length=1024)


class ExerciseCreate(ExerciseBase):
    pass


class ExerciseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    muscle_group: str | None = Field(default=None, min_length=1, max_length=64)
    type: ExerciseType | None = None
    location: ExerciseLocation | None = None
    tracking_type: TrackingType | None = None
    instructions: str | None = None
    image_url: str | None = Field(default=None, max_length=1024)


class ExerciseOut(ExerciseBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int | None = None
    created_at: datetime
    updated_at: datetime
    # Convenience flags the frontend uses to gate edit/delete (global seeds and
    # other users' exercises are read-only).
    is_global: bool = False
    editable: bool = False


# ---------- Workouts + their exercise slots ----------

class WorkoutExerciseBase(BaseModel):
    exercise_id: int
    target_sets: int | None = Field(default=None, ge=1, le=99)
    target_reps: int | None = Field(default=None, ge=1, le=999)
    target_weight: float | None = Field(default=None, ge=0)
    notes: str | None = None


class WorkoutExerciseCreate(WorkoutExerciseBase):
    pass


class WorkoutExerciseUpdate(BaseModel):
    target_sets: int | None = Field(default=None, ge=1, le=99)
    target_reps: int | None = Field(default=None, ge=1, le=999)
    target_weight: float | None = Field(default=None, ge=0)
    notes: str | None = None


class WorkoutExerciseOut(WorkoutExerciseBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    workout_id: int
    position: int
    exercise: ExerciseOut


class WorkoutBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class WorkoutCreate(WorkoutBase):
    pass


class WorkoutUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None


class WorkoutSummary(WorkoutBase):
    """List view — without the exercise slots."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    exercise_count: int = 0


class WorkoutOut(WorkoutBase):
    """Detail view — with ordered exercise slots."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    exercises: list[WorkoutExerciseOut] = Field(default_factory=list)


# ---------- Reorder (shared shape with recipes) ----------

class ReorderItem(BaseModel):
    id: int
    position: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


# ---------- Sessions + set logs ----------

class SessionStart(BaseModel):
    """Start a session. workout_id null = free training."""
    workout_id: int | None = None


class SessionUpdate(BaseModel):
    finished_at: datetime | None = None
    notes: str | None = None


class SetLogCreate(BaseModel):
    exercise_id: int
    set_number: int = Field(ge=1, le=99)
    reps_done: int | None = Field(default=None, ge=0, le=9999)
    weight_done: float | None = Field(default=None, ge=0)
    duration_done: int | None = Field(default=None, ge=0)  # seconds
    completed: bool = True


class SetLogUpdate(BaseModel):
    reps_done: int | None = Field(default=None, ge=0, le=9999)
    weight_done: float | None = Field(default=None, ge=0)
    duration_done: int | None = Field(default=None, ge=0)
    completed: bool | None = None


class SetLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    session_id: int
    exercise_id: int
    set_number: int
    reps_done: int | None = None
    weight_done: float | None = None
    duration_done: int | None = None
    completed: bool = False


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    workout_id: int | None = None
    started_at: datetime
    finished_at: datetime | None = None
    notes: str | None = None
    sets: list[SetLogOut] = Field(default_factory=list)


class SessionSummary(BaseModel):
    """History list — no set rows, just counts."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    workout_id: int | None = None
    workout_name: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
    set_count: int = 0


# ---------- Last values + history (per exercise) ----------

class LastSetValue(BaseModel):
    set_number: int
    reps_done: int | None = None
    weight_done: float | None = None
    duration_done: int | None = None


class LastValuesResponse(BaseModel):
    """Most recent FINISHED session's sets for an exercise — drives the
    pre-fill when logging the same exercise again."""
    session_id: int | None = None
    performed_at: datetime | None = None
    sets: list[LastSetValue] = Field(default_factory=list)


class HistoryPoint(BaseModel):
    date: datetime
    # Best set of that session for the exercise: top weight (and its reps), or
    # max reps / longest duration depending on tracking_type.
    weight: float | None = None
    reps: int | None = None
    duration: int | None = None


class HistoryResponse(BaseModel):
    tracking_type: TrackingType
    points: list[HistoryPoint] = Field(default_factory=list)
