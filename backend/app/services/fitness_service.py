"""Fitness module service — exercises (shared), workouts + sessions (private).

Ownership rules:
  - exercises: EVERYONE reads ALL (global seeds owner_id NULL + any user's).
    Edit/delete only your own; seeds are read-only for all.
  - workouts / workout_sessions / set_logs: strictly private per owner.
"""
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.fitness import (
    Exercise,
    SetLog,
    TrackingType,
    Workout,
    WorkoutExercise,
    WorkoutSession,
)


class FitnessError(Exception):
    """Carries an HTTP status the router re-raises as HTTPException."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# =============================================================================
#  Exercises (shared library)
# =============================================================================

async def list_exercises(
    db: AsyncSession,
    *,
    q: str | None = None,
    muscle_group: str | None = None,
    type_: str | None = None,
    location: str | None = None,
) -> list[Exercise]:
    """All exercises (global + everyone's), filtered. No owner filter — the
    library is shared."""
    stmt = select(Exercise).order_by(Exercise.name)
    if q:
        stmt = stmt.where(func.lower(Exercise.name).like(f"%{q.lower()}%"))
    if muscle_group:
        stmt = stmt.where(Exercise.muscle_group == muscle_group)
    if type_:
        stmt = stmt.where(Exercise.type == type_)
    if location:
        # An exercise tagged BEIDES matches both STUDIO and HOME filters.
        from app.models.fitness import ExerciseLocation
        stmt = stmt.where(Exercise.location.in_([location, ExerciseLocation.BEIDES]))
    return list((await db.execute(stmt)).scalars().all())


async def get_exercise(db: AsyncSession, exercise_id: int) -> Exercise:
    ex = (
        await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    ).scalar_one_or_none()
    if not ex:
        raise FitnessError(404, "Übung nicht gefunden")
    return ex


async def create_exercise(db: AsyncSession, owner_id: int, **fields) -> Exercise:
    ex = Exercise(owner_id=owner_id, **fields)
    db.add(ex)
    await db.commit()
    await db.refresh(ex)
    return ex


def _require_own_exercise(ex: Exercise, user_id: int) -> None:
    if ex.owner_id is None:
        raise FitnessError(403, "Globale Übungen können nicht bearbeitet werden")
    if ex.owner_id != user_id:
        raise FitnessError(403, "Nur eigene Übungen können bearbeitet werden")


_EX_NULLABLE = {"instructions", "image_url"}


async def update_exercise(db: AsyncSession, ex: Exercise, user_id: int, **fields) -> Exercise:
    _require_own_exercise(ex, user_id)
    for k, v in fields.items():
        if v is not None or k in _EX_NULLABLE:
            setattr(ex, k, v)
    await db.commit()
    await db.refresh(ex)
    return ex


async def delete_exercise(db: AsyncSession, ex: Exercise, user_id: int) -> None:
    _require_own_exercise(ex, user_id)
    await db.delete(ex)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise FitnessError(
            409,
            "Übung wird in einem Workout oder Trainingslog verwendet und kann nicht gelöscht werden.",
        ) from e


# =============================================================================
#  Workouts (private) + their exercise slots
# =============================================================================

async def list_workouts(db: AsyncSession, owner_id: int) -> list[tuple[Workout, int]]:
    count = func.count(WorkoutExercise.id).label("c")
    rows = await db.execute(
        select(Workout, count)
        .outerjoin(WorkoutExercise, WorkoutExercise.workout_id == Workout.id)
        .where(Workout.owner_id == owner_id)
        .group_by(Workout.id)
        .order_by(Workout.updated_at.desc())
    )
    return [(w, c) for w, c in rows.all()]


async def get_workout(db: AsyncSession, workout_id: int, owner_id: int) -> Workout:
    w = (
        await db.execute(
            select(Workout)
            .options(selectinload(Workout.exercises).selectinload(WorkoutExercise.exercise))
            .where(Workout.id == workout_id, Workout.owner_id == owner_id)
        )
    ).scalar_one_or_none()
    if not w:
        raise FitnessError(404, "Workout nicht gefunden")
    return w


async def create_workout(db: AsyncSession, owner_id: int, *, name: str, description: str | None) -> Workout:
    w = Workout(owner_id=owner_id, name=name, description=description)
    db.add(w)
    await db.commit()
    return await get_workout(db, w.id, owner_id)


async def update_workout(db: AsyncSession, w: Workout, **fields) -> Workout:
    for k, v in fields.items():
        if v is not None or k == "description":
            setattr(w, k, v)
    await db.commit()
    await db.refresh(w)
    return await get_workout(db, w.id, w.owner_id)


async def delete_workout(db: AsyncSession, w: Workout) -> None:
    await db.delete(w)
    await db.commit()


async def add_workout_exercise(db: AsyncSession, workout_id: int, **fields) -> WorkoutExercise:
    # Validate the referenced exercise exists (shared library — any owner).
    await get_exercise(db, fields["exercise_id"])
    pos = (
        await db.execute(
            select(func.coalesce(func.max(WorkoutExercise.position), -1) + 1).where(
                WorkoutExercise.workout_id == workout_id
            )
        )
    ).scalar_one()
    we = WorkoutExercise(workout_id=workout_id, position=pos, **fields)
    db.add(we)
    await db.commit()
    await db.refresh(we)
    return we


async def get_workout_exercise(db: AsyncSession, workout_id: int, we_id: int) -> WorkoutExercise | None:
    return (
        await db.execute(
            select(WorkoutExercise).where(
                WorkoutExercise.id == we_id, WorkoutExercise.workout_id == workout_id
            )
        )
    ).scalar_one_or_none()


async def update_workout_exercise(db: AsyncSession, we: WorkoutExercise, **fields) -> WorkoutExercise:
    for k, v in fields.items():
        if v is not None or k in {"target_sets", "target_reps", "target_weight", "notes"}:
            setattr(we, k, v)
    await db.commit()
    await db.refresh(we)
    return we


async def delete_workout_exercise(db: AsyncSession, we: WorkoutExercise) -> None:
    await db.delete(we)
    await db.commit()


async def reorder_workout_exercises(db: AsyncSession, workout_id: int, positions: list[tuple[int, int]]) -> None:
    ids = [i for i, _ in positions]
    rows = (
        await db.execute(
            select(WorkoutExercise).where(
                WorkoutExercise.workout_id == workout_id, WorkoutExercise.id.in_(ids)
            )
        )
    ).scalars().all()
    by_id = {r.id: r for r in rows}
    for we_id, pos in positions:
        if we_id in by_id:
            by_id[we_id].position = pos
    await db.commit()


# =============================================================================
#  Sessions (private) + set logs
# =============================================================================

async def get_open_session(db: AsyncSession, owner_id: int) -> WorkoutSession | None:
    return (
        await db.execute(
            select(WorkoutSession)
            .options(selectinload(WorkoutSession.sets))
            .where(WorkoutSession.owner_id == owner_id, WorkoutSession.finished_at.is_(None))
            .order_by(WorkoutSession.started_at.desc())
        )
    ).scalars().first()


async def start_session(db: AsyncSession, owner_id: int, workout_id: int | None) -> WorkoutSession:
    # Enforce a single open session per user.
    if await get_open_session(db, owner_id) is not None:
        raise FitnessError(
            409, "Es läuft bereits ein offenes Training — fortsetzen oder verwerfen."
        )
    if workout_id is not None:
        # Must be the user's own workout.
        await get_workout(db, workout_id, owner_id)
    s = WorkoutSession(owner_id=owner_id, workout_id=workout_id, started_at=_utcnow())
    db.add(s)
    await db.commit()
    return await get_session(db, s.id, owner_id)


async def get_session(db: AsyncSession, session_id: int, owner_id: int) -> WorkoutSession:
    s = (
        await db.execute(
            select(WorkoutSession)
            .options(selectinload(WorkoutSession.sets))
            .where(WorkoutSession.id == session_id, WorkoutSession.owner_id == owner_id)
        )
    ).scalar_one_or_none()
    if not s:
        raise FitnessError(404, "Session nicht gefunden")
    return s


async def list_sessions(db: AsyncSession, owner_id: int) -> list[tuple[WorkoutSession, str | None, int]]:
    count = func.count(SetLog.id).label("c")
    rows = await db.execute(
        select(WorkoutSession, Workout.name, count)
        .outerjoin(Workout, Workout.id == WorkoutSession.workout_id)
        .outerjoin(SetLog, SetLog.session_id == WorkoutSession.id)
        .where(WorkoutSession.owner_id == owner_id)
        .group_by(WorkoutSession.id, Workout.name)
        .order_by(WorkoutSession.started_at.desc())
    )
    return [(s, name, c) for s, name, c in rows.all()]


async def update_session(db: AsyncSession, s: WorkoutSession, **fields) -> WorkoutSession:
    for k, v in fields.items():
        if v is not None or k in {"finished_at", "notes"}:
            setattr(s, k, v)
    await db.commit()
    return await get_session(db, s.id, s.owner_id)


async def finish_session(db: AsyncSession, s: WorkoutSession) -> WorkoutSession:
    if s.finished_at is None:
        s.finished_at = _utcnow()
    await db.commit()
    return await get_session(db, s.id, s.owner_id)


async def delete_session(db: AsyncSession, s: WorkoutSession) -> None:
    await db.delete(s)
    await db.commit()


def _validate_set_fields(
    tracking: TrackingType,
    reps: int | None,
    weight: float | None,
    duration: int | None,
) -> None:
    """Enforce that only the fields matching the exercise's tracking_type are
    set (per the module spec). Mismatched fields are rejected outright."""
    if tracking == TrackingType.REPS:
        if weight is not None or duration is not None:
            raise FitnessError(400, "Diese Übung trackt nur Wiederholungen")
    elif tracking == TrackingType.WEIGHT_REPS:
        if duration is not None:
            raise FitnessError(400, "Diese Übung trackt Gewicht/Wiederholungen, keine Zeit")
        if reps is None:
            raise FitnessError(400, "Wiederholungen sind erforderlich")
    elif tracking == TrackingType.TIME:
        if reps is not None or weight is not None:
            raise FitnessError(400, "Diese Übung trackt nur die Zeit")


async def add_set_log(db: AsyncSession, session: WorkoutSession, **fields) -> SetLog:
    ex = await get_exercise(db, fields["exercise_id"])
    _validate_set_fields(
        ex.tracking_type,
        fields.get("reps_done"),
        fields.get("weight_done"),
        fields.get("duration_done"),
    )
    sl = SetLog(session_id=session.id, **fields)
    db.add(sl)
    await db.commit()
    await db.refresh(sl)
    return sl


async def get_set_log(db: AsyncSession, session_id: int, set_id: int) -> SetLog | None:
    return (
        await db.execute(
            select(SetLog).where(SetLog.id == set_id, SetLog.session_id == session_id)
        )
    ).scalar_one_or_none()


async def update_set_log(db: AsyncSession, sl: SetLog, **fields) -> SetLog:
    ex = await get_exercise(db, sl.exercise_id)
    merged_reps = fields.get("reps_done", sl.reps_done) if "reps_done" in fields else sl.reps_done
    merged_weight = fields.get("weight_done", sl.weight_done) if "weight_done" in fields else sl.weight_done
    merged_dur = fields.get("duration_done", sl.duration_done) if "duration_done" in fields else sl.duration_done
    _validate_set_fields(ex.tracking_type, merged_reps, merged_weight, merged_dur)
    for k, v in fields.items():
        if v is not None or k in {"reps_done", "weight_done", "duration_done"}:
            setattr(sl, k, v)
    await db.commit()
    await db.refresh(sl)
    return sl


async def delete_set_log(db: AsyncSession, sl: SetLog) -> None:
    await db.delete(sl)
    await db.commit()


# =============================================================================
#  Last values + history (per exercise, owner-scoped, finished sessions only)
# =============================================================================

async def last_values(db: AsyncSession, owner_id: int, exercise_id: int) -> tuple[WorkoutSession | None, list[SetLog]]:
    """Sets of the owner's most recent FINISHED session that included this
    exercise — drives the pre-fill. Open/aborted sessions are ignored."""
    session = (
        await db.execute(
            select(WorkoutSession)
            .where(
                WorkoutSession.owner_id == owner_id,
                WorkoutSession.finished_at.is_not(None),
                WorkoutSession.id.in_(
                    select(SetLog.session_id).where(SetLog.exercise_id == exercise_id)
                ),
            )
            .order_by(WorkoutSession.started_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if session is None:
        return None, []
    sets = (
        await db.execute(
            select(SetLog)
            .where(SetLog.session_id == session.id, SetLog.exercise_id == exercise_id)
            .order_by(SetLog.set_number)
        )
    ).scalars().all()
    return session, list(sets)


async def history(db: AsyncSession, owner_id: int, exercise_id: int) -> list[dict]:
    """One point per finished session: the best set for this exercise. Best =
    top weight (with its reps) / max reps / longest duration, by tracking_type.
    Sorted oldest→newest. Caller adds the tracking_type to the response."""
    rows = (
        await db.execute(
            select(
                WorkoutSession.id,
                WorkoutSession.started_at,
                SetLog.reps_done,
                SetLog.weight_done,
                SetLog.duration_done,
            )
            .join(SetLog, SetLog.session_id == WorkoutSession.id)
            .where(
                WorkoutSession.owner_id == owner_id,
                WorkoutSession.finished_at.is_not(None),
                SetLog.exercise_id == exercise_id,
                SetLog.completed.is_(True),
            )
        )
    ).all()

    by_session: dict[int, dict] = {}
    for sid, started_at, reps, weight, duration in rows:
        cur = by_session.get(sid)
        cand = {"date": started_at, "weight": weight, "reps": reps, "duration": duration}
        if cur is None:
            by_session[sid] = cand
            continue
        # Keep the "best" set of the session.
        if (weight or 0) > (cur["weight"] or 0):
            by_session[sid] = cand
        elif (weight or 0) == (cur["weight"] or 0):
            if (reps or 0) > (cur["reps"] or 0) or (duration or 0) > (cur["duration"] or 0):
                by_session[sid] = cand
    return sorted(by_session.values(), key=lambda p: p["date"])
