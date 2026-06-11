"""Orchestrates Picnic .eml → DB recipe — the SHARED core behind both the
frontend upload endpoint and the n8n X-API-Key endpoint (no duplicated logic).

parse → two-tier dedup (image hash primary, normalized title fallback) →
create_recipe(source="structured_import") → download + store the hero image
locally. The background nutrition fill is enqueued by the caller (reusing
recipes._bulk_fill_nutrition) since this layer has no BackgroundTasks handle.
"""
from __future__ import annotations

import logging
import pathlib
import uuid
from dataclasses import dataclass

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.recipe import Recipe
from app.services.picnic_parser import parse_picnic_eml
from app.services.recipe_service import create_recipe

logger = logging.getLogger(__name__)

UNRECOGNIZED_MESSAGE = (
    "Diese E-Mail sieht nicht wie eine Picnic-Rezept-Mail aus. Falls das Format "
    "sich geändert hat, bitte als Text importieren."
)

_UA = "LystRecipeImporter/1.0"
_UPLOADS_BASE = pathlib.Path("/app/uploads")  # container path; host mount = /opt/appdata/lyst/uploads
_IMG_EXT = {
    "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/gif": ".gif",
}
_MAX_IMG_BYTES = 10 * 1024 * 1024


@dataclass
class ImportOutcome:
    status: str  # "created" | "duplicate" | "unrecognized"
    recipe_id: int | None = None
    title: str | None = None
    message: str = ""


async def _download_image(url: str) -> tuple[bytes, str] | None:
    """Best-effort download; returns (bytes, ext) or None. Validates
    content-type + 10 MB cap, like the existing extracted-image pipeline."""
    try:
        async with httpx.AsyncClient(
            timeout=15.0, follow_redirects=True, headers={"User-Agent": _UA}
        ) as client:
            r = await client.get(url)
            r.raise_for_status()
    except Exception as e:
        logger.warning("Picnic image download failed: %s — %s", url, e)
        return None
    ct = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
    ext = _IMG_EXT.get(ct)
    data = r.content
    if not ext or not data or len(data) > _MAX_IMG_BYTES:
        logger.warning("Picnic image rejected (ct=%s, %d bytes): %s", ct, len(data or b""), url)
        return None
    return data, ext


def _store_image(recipe_id: int, data: bytes, ext: str) -> str:
    """Write under /app/uploads/recipes/{id}/<uuid>.<ext>, return the /static URL
    (same pattern as the recipe-image upload endpoint)."""
    target_dir = _UPLOADS_BASE / "recipes" / str(recipe_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    (target_dir / fname).write_bytes(data)
    return f"/static/recipes/{recipe_id}/{fname}"


async def _find_duplicate(
    db: AsyncSession, owner_id: int, *, image_hash: str | None, title: str
) -> int | None:
    """Image hash first (robust to title renames), then normalized title."""
    if image_hash:
        res = await db.execute(
            select(Recipe.id)
            .where(Recipe.owner_id == owner_id, Recipe.picnic_image_hash == image_hash)
            .limit(1)
        )
        rid = res.scalar_one_or_none()
        if rid:
            return rid
    res = await db.execute(
        select(Recipe.id)
        .where(
            Recipe.owner_id == owner_id,
            func.lower(func.trim(Recipe.title)) == title.strip().lower(),
        )
        .limit(1)
    )
    return res.scalar_one_or_none()


async def import_one_eml(
    db: AsyncSession, *, owner_id: int, raw: bytes, force: bool = False
) -> ImportOutcome:
    parsed = parse_picnic_eml(raw)
    if parsed is None:
        return ImportOutcome("unrecognized", message=UNRECOGNIZED_MESSAGE)

    if not force:
        dup = await _find_duplicate(
            db, owner_id, image_hash=parsed.image_hash, title=parsed.title
        )
        if dup:
            return ImportOutcome(
                "duplicate",
                recipe_id=dup,
                title=parsed.title,
                message=f'„{parsed.title}" ist schon in deinen Rezepten.',
            )

    ingredients = [
        {"name": i.name, "quantity": i.quantity, "unit": i.unit} for i in parsed.ingredients
    ]
    steps = [{"description": s} for s in parsed.steps]
    rec = await create_recipe(
        db,
        owner_id,
        title=parsed.title,
        ingredients=ingredients,
        steps=steps,
        servings=parsed.servings or 2,
        prep_time_minutes=parsed.prep_time_minutes,
        tags=["Picnic"],
        source="structured_import",
        picnic_image_hash=parsed.image_hash,
    )
    recipe_id = rec.id

    # Download + store the hero image locally (don't keep Picnic's remote URL).
    # Failure must not fail the import.
    image_stored = False
    if parsed.image_url:
        img = await _download_image(parsed.image_url)
        if img:
            try:
                rec.image_url = _store_image(recipe_id, *img)
                await db.commit()
                image_stored = True
            except OSError:
                logger.exception("Picnic image store failed for recipe %s", recipe_id)

    logger.info(
        "Picnic import: title=%r ingredients=%d steps=%d image=%s hash=%s owner=%s",
        parsed.title, len(parsed.ingredients), len(parsed.steps),
        image_stored, parsed.image_hash, owner_id,
    )
    return ImportOutcome(
        "created",
        recipe_id=recipe_id,
        title=parsed.title,
        message=f'„{parsed.title}" importiert.',
    )
