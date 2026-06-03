"""Fitness — exercise library endpoints (mounted under /fitness).

The library is SHARED: every user reads every exercise (global seeds with
owner_id NULL + any user's). Create makes your own; edit/delete only your own.
"""
import logging
import pathlib
import uuid as _uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.fitness import ExerciseCreate, ExerciseOut, ExerciseUpdate
from app.services.fitness_service import (
    FitnessError,
    create_exercise,
    delete_exercise,
    get_exercise,
    list_exercises,
    update_exercise,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fitness", tags=["fitness"])


def exercise_out(ex, user_id: int) -> dict:
    """ExerciseOut + the is_global / editable flags the frontend gates on."""
    return ExerciseOut.model_validate(ex).model_copy(
        update={
            "is_global": ex.owner_id is None,
            "editable": ex.owner_id is not None and ex.owner_id == user_id,
        }
    ).model_dump(mode="json")


@router.get("/exercises")
async def get_exercises(
    q: str | None = None,
    muscle_group: str | None = None,
    type: str | None = None,
    location: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_exercises(db, q=q, muscle_group=muscle_group, type_=type, location=location)
    return ok([exercise_out(e, user.id) for e in rows])


@router.post("/exercises", status_code=status.HTTP_201_CREATED)
async def post_exercise(
    payload: ExerciseCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    ex = await create_exercise(db, user.id, **payload.model_dump())
    return ok(exercise_out(ex, user.id))


@router.get("/exercises/{exercise_id}")
async def get_exercise_route(
    exercise_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ex = await get_exercise(db, exercise_id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(exercise_out(ex, user.id))


@router.patch("/exercises/{exercise_id}")
async def patch_exercise(
    exercise_id: int,
    payload: ExerciseUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ex = await get_exercise(db, exercise_id)
        ex = await update_exercise(db, ex, user.id, **payload.model_dump(exclude_unset=True))
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(exercise_out(ex, user.id))


@router.delete("/exercises/{exercise_id}")
async def del_exercise(
    exercise_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ex = await get_exercise(db, exercise_id)
        await delete_exercise(db, ex, user.id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok({"message": "Deleted"})


# ---------- Exercise image (own exercises only; same mechanism as recipes) ----------

ALLOWED_IMAGE_EXTS = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
UPLOADS_BASE = pathlib.Path("/app/uploads")


def _delete_owned_image(image_url: str | None) -> None:
    if not image_url or not image_url.startswith("/static/"):
        return
    rel = image_url[len("/static/") :]
    path = UPLOADS_BASE / rel
    try:
        resolved = path.resolve()
        if UPLOADS_BASE.resolve() in resolved.parents:
            resolved.unlink(missing_ok=True)
    except OSError:
        pass


@router.post("/exercises/{exercise_id}/image", status_code=status.HTTP_200_OK)
async def post_exercise_image(
    exercise_id: int,
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ex = await get_exercise(db, exercise_id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if ex.owner_id is None or ex.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nur eigene Übungen")

    if file.content_type not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Nur JPG, PNG und WebP werden unterstützt",
        )
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Maximale Bildgröße: 10 MB",
            )
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leere Datei")

    ext = ALLOWED_IMAGE_EXTS[file.content_type]
    fname = f"{_uuid.uuid4().hex}{ext}"
    target_dir = UPLOADS_BASE / "exercises" / str(exercise_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / fname).write_bytes(data)

    _delete_owned_image(ex.image_url)
    ex.image_url = f"/static/exercises/{exercise_id}/{fname}"
    await db.commit()
    await db.refresh(ex)
    return ok(exercise_out(ex, user.id))


@router.delete("/exercises/{exercise_id}/image", status_code=status.HTTP_200_OK)
async def del_exercise_image(
    exercise_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ex = await get_exercise(db, exercise_id)
    except FitnessError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if ex.owner_id is None or ex.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nur eigene Übungen")
    _delete_owned_image(ex.image_url)
    ex.image_url = None
    await db.commit()
    await db.refresh(ex)
    return ok(exercise_out(ex, user.id))
