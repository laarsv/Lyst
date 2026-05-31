import logging
import pathlib
import uuid as _uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.plant import PlantCreate, PlantPrefillRequest, PlantUpdate
from app.services.plant_prefill_service import prefill_plant
from app.services.plant_service import (
    create_plant,
    delete_plant,
    due_this_week,
    fertilize_in_season,
    get_plant,
    list_plants,
    mark_fertilized,
    mark_watered,
    next_fertilize_due,
    next_water_due,
    prune_due,
    update_plant,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plants", tags=["plants"])


def _serialize(plant) -> dict:
    """PlantOut + the computed care fields. Mirrors the recipes router's
    _full() pattern (model_validate → model_copy(update=...))."""
    from app.schemas.plant import PlantOut  # local import keeps module head tidy

    now = datetime.now(timezone.utc)
    nwd = next_water_due(plant)
    nfd = next_fertilize_due(plant)
    return PlantOut.model_validate(plant).model_copy(
        update={
            "next_water_due": nwd,
            "next_fertilize_due": nfd,
            "water_due": nwd is not None and nwd <= now,
            # Out of the fertilize season → not "due" even if the interval elapsed.
            "fertilize_due": nfd is not None and nfd <= now and fertilize_in_season(plant, now),
            "prune_due": prune_due(plant, now),
        }
    ).model_dump(mode="json")


@router.get("")
async def get_plants(
    q: str | None = None,
    tag: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    plants = await list_plants(db, user.id, q=q, tag=tag)
    return ok([_serialize(p) for p in plants])


# Declared BEFORE /{plant_id} so "due" isn't captured as a plant id.
@router.get("/due")
async def get_due(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Plants needing water/fertilizer — overdue or within the next 7 days."""
    groups = await due_this_week(db, user.id)
    return ok({
        "water": [_serialize(p) for p in groups["water"]],
        "fertilize": [_serialize(p) for p in groups["fertilize"]],
    })


# Declared BEFORE /{plant_id} so "prefill" isn't captured as a plant id.
@router.post("/prefill")
async def post_prefill(
    payload: PlantPrefillRequest,
    user: User = Depends(require_user),
):
    """Ollama-powered, advisory care suggestions for the create form. Always
    200: returns ok=false ("manuell ausfüllen") on any failure. Never sets
    the real `edible` field — edibility is hint-only."""
    result = await prefill_plant(payload.name)
    return ok(result.model_dump(mode="json"))


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_plant(
    payload: PlantCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump()
    last_watered_at = data.pop("last_watered_at", None)
    last_fertilized_at = data.pop("last_fertilized_at", None)
    plant = await create_plant(
        db, user.id,
        last_watered_at=last_watered_at,
        last_fertilized_at=last_fertilized_at,
        **data,
    )
    return ok(_serialize(plant))


@router.get("/{plant_id}")
async def get_plant_route(
    plant_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        plant = await get_plant(db, plant_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok(_serialize(plant))


@router.patch("/{plant_id}")
async def patch_plant(
    plant_id: int,
    payload: PlantUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        plant = await get_plant(db, plant_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    plant = await update_plant(db, plant, **payload.model_dump(exclude_unset=True))
    return ok(_serialize(plant))


@router.delete("/{plant_id}")
async def del_plant(
    plant_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        plant = await get_plant(db, plant_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await delete_plant(db, plant)
    return ok({"message": "Deleted"})


# ---------- Re-arm actions ----------

@router.post("/{plant_id}/water")
async def post_water(
    plant_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """"Gegossen" — stamps last_watered_at = now and arms the next cycle."""
    try:
        plant = await get_plant(db, plant_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    plant = await mark_watered(db, plant)
    return ok(_serialize(plant))


@router.post("/{plant_id}/fertilize")
async def post_fertilize(
    plant_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """"Gedüngt" — stamps last_fertilized_at = now and arms the next cycle."""
    try:
        plant = await get_plant(db, plant_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    plant = await mark_fertilized(db, plant)
    return ok(_serialize(plant))


# ---------- Image upload ----------
#
# Same mechanism as recipe images: files land in
# /app/uploads/plants/{id}/<uuid>.<ext> and are served via the StaticFiles
# mount at /static/. No resize step — raw bytes, just like recipes.

ALLOWED_IMAGE_EXTS = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
UPLOADS_BASE = pathlib.Path("/app/uploads")


def _delete_owned_image(image_url: str | None) -> None:
    """Best-effort delete of a previously-uploaded image. No-ops for external
    URLs (anything not under /static/)."""
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


@router.post("/{plant_id}/image", status_code=status.HTTP_200_OK)
async def post_plant_image(
    plant_id: int,
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        plant = await get_plant(db, plant_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    if file.content_type not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Nur JPG, PNG und WebP werden unterstützt",
        )

    # Stream-read in 64 KiB chunks so we reject oversized uploads without
    # buffering the whole payload first.
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
    target_dir = UPLOADS_BASE / "plants" / str(plant_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / fname
    target_path.write_bytes(data)

    # Drop the previous file only after the new write succeeds.
    _delete_owned_image(plant.image_url)

    plant.image_url = f"/static/plants/{plant_id}/{fname}"
    await db.commit()
    await db.refresh(plant)
    return ok(_serialize(plant))


@router.delete("/{plant_id}/image", status_code=status.HTTP_200_OK)
async def del_plant_image(
    plant_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        plant = await get_plant(db, plant_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    _delete_owned_image(plant.image_url)
    plant.image_url = None
    await db.commit()
    await db.refresh(plant)
    return ok(_serialize(plant))
