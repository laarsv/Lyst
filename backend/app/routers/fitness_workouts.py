"""Fitness — workout templates (mounted under /fitness). Strictly private."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.fitness import (
    ReorderRequest,
    WorkoutCreate,
    WorkoutExerciseCreate,
    WorkoutExerciseOut,
    WorkoutExerciseUpdate,
    WorkoutOut,
    WorkoutSummary,
    WorkoutUpdate,
)
from app.services.fitness_service import (
    FitnessError,
    add_workout_exercise,
    create_workout,
    delete_workout,
    delete_workout_exercise,
    get_workout,
    get_workout_exercise,
    list_workouts,
    reorder_workout_exercises,
    update_workout,
    update_workout_exercise,
)

router = APIRouter(prefix="/fitness", tags=["fitness"])


def _summary(w, count: int) -> dict:
    return WorkoutSummary.model_validate(w).model_copy(update={"exercise_count": count}).model_dump(mode="json")


def _full(w) -> dict:
    return WorkoutOut.model_validate(w).model_dump(mode="json")


@router.get("/workouts")
async def get_workouts(user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    rows = await list_workouts(db, user.id)
    return ok([_summary(w, c) for w, c in rows])


@router.post("/workouts", status_code=status.HTTP_201_CREATED)
async def post_workout(
    payload: WorkoutCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    w = await create_workout(db, user.id, name=payload.name, description=payload.description)
    return ok(_full(w))


@router.get("/workouts/{workout_id}")
async def get_workout_route(
    workout_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        w = await get_workout(db, workout_id, user.id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(_full(w))


@router.patch("/workouts/{workout_id}")
async def patch_workout(
    workout_id: int,
    payload: WorkoutUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        w = await get_workout(db, workout_id, user.id)
        w = await update_workout(db, w, **payload.model_dump(exclude_unset=True))
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(_full(w))


@router.delete("/workouts/{workout_id}")
async def del_workout(
    workout_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        w = await get_workout(db, workout_id, user.id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    await delete_workout(db, w)
    return ok({"message": "Deleted"})


# ----- Exercise slots -----

async def _owned_workout(db: AsyncSession, workout_id: int, user_id: int):
    try:
        return await get_workout(db, workout_id, user_id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)


@router.post("/workouts/{workout_id}/exercises", status_code=status.HTTP_201_CREATED)
async def post_workout_exercise(
    workout_id: int,
    payload: WorkoutExerciseCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _owned_workout(db, workout_id, user.id)
    try:
        we = await add_workout_exercise(db, workout_id, **payload.model_dump())
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(WorkoutExerciseOut.model_validate(we).model_dump(mode="json"))


# Declared BEFORE /{we_id} so "reorder" isn't captured as a slot id.
@router.patch("/workouts/{workout_id}/exercises/reorder")
async def patch_workout_exercises_reorder(
    workout_id: int,
    payload: ReorderRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _owned_workout(db, workout_id, user.id)
    await reorder_workout_exercises(db, workout_id, [(i.id, i.position) for i in payload.items])
    return ok({"message": "Reordered"})


@router.patch("/workouts/{workout_id}/exercises/{we_id}")
async def patch_workout_exercise(
    workout_id: int,
    we_id: int,
    payload: WorkoutExerciseUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _owned_workout(db, workout_id, user.id)
    we = await get_workout_exercise(db, workout_id, we_id)
    if not we:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Übung im Workout nicht gefunden")
    we = await update_workout_exercise(db, we, **payload.model_dump(exclude_unset=True))
    return ok(WorkoutExerciseOut.model_validate(we).model_dump(mode="json"))


@router.delete("/workouts/{workout_id}/exercises/{we_id}")
async def del_workout_exercise(
    workout_id: int,
    we_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _owned_workout(db, workout_id, user.id)
    we = await get_workout_exercise(db, workout_id, we_id)
    if not we:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Übung im Workout nicht gefunden")
    await delete_workout_exercise(db, we)
    return ok({"message": "Deleted"})
