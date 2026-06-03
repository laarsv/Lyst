"""Fitness — logged training sessions + set logs + per-exercise last/history
(mounted under /fitness). Strictly private per user."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.fitness import (
    HistoryPoint,
    HistoryResponse,
    LastSetValue,
    LastValuesResponse,
    SessionOut,
    SessionStart,
    SessionSummary,
    SessionUpdate,
    SetLogCreate,
    SetLogOut,
    SetLogUpdate,
)
from app.services.fitness_service import (
    FitnessError,
    add_set_log,
    delete_session,
    delete_set_log,
    finish_session,
    get_exercise,
    get_open_session,
    get_session,
    get_set_log,
    history,
    last_values,
    list_sessions,
    start_session,
    update_session,
    update_set_log,
)

router = APIRouter(prefix="/fitness", tags=["fitness"])


@router.get("/sessions")
async def get_sessions(user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    rows = await list_sessions(db, user.id)
    return ok([
        SessionSummary.model_validate(s)
        .model_copy(update={"workout_name": name, "set_count": c})
        .model_dump(mode="json")
        for s, name, c in rows
    ])


# Declared BEFORE /{session_id} so "open" isn't captured as a session id.
@router.get("/sessions/open")
async def get_open(user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    s = await get_open_session(db, user.id)
    return ok(SessionOut.model_validate(s).model_dump(mode="json") if s else None)


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def post_session(
    payload: SessionStart,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        s = await start_session(db, user.id, payload.workout_id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(SessionOut.model_validate(s).model_dump(mode="json"))


async def _owned_session(db: AsyncSession, session_id: int, user_id: int):
    try:
        return await get_session(db, session_id, user_id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)


@router.get("/sessions/{session_id}")
async def get_session_route(
    session_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _owned_session(db, session_id, user.id)
    return ok(SessionOut.model_validate(s).model_dump(mode="json"))


@router.patch("/sessions/{session_id}")
async def patch_session(
    session_id: int,
    payload: SessionUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _owned_session(db, session_id, user.id)
    s = await update_session(db, s, **payload.model_dump(exclude_unset=True))
    return ok(SessionOut.model_validate(s).model_dump(mode="json"))


@router.post("/sessions/{session_id}/finish")
async def post_finish_session(
    session_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _owned_session(db, session_id, user.id)
    s = await finish_session(db, s)
    return ok(SessionOut.model_validate(s).model_dump(mode="json"))


@router.delete("/sessions/{session_id}")
async def del_session(
    session_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _owned_session(db, session_id, user.id)
    await delete_session(db, s)
    return ok({"message": "Deleted"})


# ----- Set logs -----

@router.post("/sessions/{session_id}/sets", status_code=status.HTTP_201_CREATED)
async def post_set_log(
    session_id: int,
    payload: SetLogCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _owned_session(db, session_id, user.id)
    try:
        sl = await add_set_log(db, s, **payload.model_dump())
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(SetLogOut.model_validate(sl).model_dump(mode="json"))


@router.patch("/sessions/{session_id}/sets/{set_id}")
async def patch_set_log(
    session_id: int,
    set_id: int,
    payload: SetLogUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _owned_session(db, session_id, user.id)
    sl = await get_set_log(db, session_id, set_id)
    if not sl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Satz nicht gefunden")
    try:
        sl = await update_set_log(db, sl, **payload.model_dump(exclude_unset=True))
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(SetLogOut.model_validate(sl).model_dump(mode="json"))


@router.delete("/sessions/{session_id}/sets/{set_id}")
async def del_set_log(
    session_id: int,
    set_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _owned_session(db, session_id, user.id)
    sl = await get_set_log(db, session_id, set_id)
    if not sl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Satz nicht gefunden")
    await delete_set_log(db, sl)
    return ok({"message": "Deleted"})


# ----- Per-exercise last values + history -----

@router.get("/exercises/{exercise_id}/last")
async def get_last_values(
    exercise_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    session, sets = await last_values(db, user.id, exercise_id)
    return ok(
        LastValuesResponse(
            session_id=session.id if session else None,
            performed_at=session.started_at if session else None,
            sets=[
                LastSetValue(
                    set_number=s.set_number,
                    reps_done=s.reps_done,
                    weight_done=s.weight_done,
                    duration_done=s.duration_done,
                )
                for s in sets
            ],
        ).model_dump(mode="json")
    )


@router.get("/exercises/{exercise_id}/history")
async def get_history(
    exercise_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ex = await get_exercise(db, exercise_id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    points = await history(db, user.id, exercise_id)
    return ok(
        HistoryResponse(
            tracking_type=ex.tracking_type,
            points=[
                HistoryPoint(date=p["date"], weight=p["weight"], reps=p["reps"], duration=p["duration"])
                for p in points
            ],
        ).model_dump(mode="json")
    )
