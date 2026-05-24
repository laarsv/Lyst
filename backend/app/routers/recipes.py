import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
logger = logging.getLogger(__name__)

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_client_id, require_user
from app.core.responses import ok
from app.models.collaborator import CollaboratorPermission
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.recipe import (
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    NutritionAggregate,
    NutritionCoverage,
    NutritionTotalsValues,
    RecipeCreate,
    RecipeDuplicate,
    RecipeOut,
    RecipeSummary,
    RecipeUpdate,
    ReorderRequest,
    StepCreate,
    StepOut,
    StepUpdate,
)
from app.services.notification_service import notify_share_created
from app.services.realtime_events import (
    emit_recipe_deleted,
    emit_recipe_event,
    emit_share_event,
    recipe_audience,
)
from app.services.recipe_service import (
    add_ingredient,
    add_step,
    create_recipe,
    delete_ingredient,
    delete_recipe,
    delete_step,
    duplicate_recipe,
    get_accessible_recipe,
    get_ingredient,
    get_recipe,
    get_step,
    list_accessible_recipes,
    list_book_internal_shares,
    list_recipe_internal_shares,
    list_recipes,
    reorder_ingredients,
    reorder_steps,
    revoke_book_internal_share,
    revoke_recipe_internal_share,
    share_book_with_email,
    share_recipe_with_email,
    update_ingredient,
    update_recipe,
    update_step,
)

router = APIRouter(prefix="/recipes", tags=["recipes"])


# =============================================================================
#  Permission helpers (alembic 0014)
# =============================================================================
#
# All mutating endpoints route through one of these so the checks stay
# uniform — recipients with EDIT can modify content, recipients with VIEW
# can only read, and owner-only actions (delete, share-management) keep
# their original gate.

async def require_recipe_edit(
    db: AsyncSession, recipe_id: int, user_id: int
) -> Recipe:
    """Owner OR EDIT recipient. Use for content-mutating endpoints."""
    try:
        rec, _, perm = await get_accessible_recipe(db, recipe_id, user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if perm != CollaboratorPermission.EDIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Du hast keine Bearbeitungsrechte für dieses Rezept.",
        )
    return rec


async def recipe_with_any_access(
    db: AsyncSession, recipe_id: int, user_id: int
) -> Recipe:
    """Owner OR any-permission recipient. Use for read-derivative writes
    that create resources owned by the caller (duplicate, copy-to-list)."""
    try:
        rec, _, _ = await get_accessible_recipe(db, recipe_id, user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return rec


def _summary(
    rec,
    ingredient_count: int,
    *,
    share_source: str | None = None,
    owner_name: str | None = None,
    internal_share_count: int | None = None,
    book_shared: bool = False,
) -> dict:
    # share_permission lives on RecipeOut only — RecipeSummary stays compact.
    from app.schemas.share import ShareState
    share_state = None
    if internal_share_count is not None:
        share_state = ShareState(
            internal_count=internal_share_count,
            public=bool(rec.share_enabled),
            via_book=book_shared,
        )
    return RecipeSummary.model_validate(rec).model_copy(
        update={
            "ingredient_count": ingredient_count,
            "share_source": share_source,
            "owner_name": owner_name,
            "share_state": share_state,
        }
    ).model_dump(mode="json")


def _nutrition_aggregate(rec) -> NutritionAggregate:
    """Per-recipe nutrition totals — total, per-serving, and coverage.

    For each ingredient with nutrition values AND a quantity/unit we
    can convert to grams (via app.services.unit_conversion), the
    contribution is `per_100g * grams / 100`. Ingredients with
    nutrition values but a non-convertible unit (e.g. "1 Bund
    Petersilie") are *excluded* from the sum but counted as missing in
    the coverage block — same with rows that have no nutrition values
    at all. The frontend uses `coverage.counted < coverage.total` to
    drive a "Basiert auf X von Y Zutaten" hint with a link to edit
    mode so the user can fill the gaps.

    `is_estimate` flips true when any *contributing* ingredient was
    filled from an AI estimate; the heading then shows "(geschätzt)"
    so the user knows the totals carry uncertainty."""
    from app.services.unit_conversion import convert_to_grams

    fields = (
        ("calories", "calories_per_100g"),
        ("protein", "protein_per_100g"),
        ("carbs", "carbs_per_100g"),
        ("fat", "fat_per_100g"),
        ("fiber", "fiber_per_100g"),
        ("sugar", "sugar_per_100g"),
        ("salt", "salt_per_100g"),
    )
    totals: dict[str, float | None] = {k: None for k, _ in fields}
    is_estimate = False
    counted = 0
    total_ings = len(rec.ingredients)

    for ing in rec.ingredients:
        # A row contributes only when (a) at least one per-100g field
        # is set AND (b) quantity+unit+name resolves to grams. Either
        # gap leaves the row uncounted but counted-as-missing.
        has_data = any(getattr(ing, attr) is not None for _, attr in fields)
        if not has_data:
            continue
        grams = convert_to_grams(ing.quantity, ing.unit, ing.name)
        if grams is None:
            continue
        counted += 1
        if getattr(ing, "nutrition_source", None) and ing.nutrition_source.value == "ai":
            is_estimate = True
        for key, attr in fields:
            v = getattr(ing, attr)
            if v is None:
                continue
            totals[key] = (totals[key] or 0.0) + grams / 100.0 * v

    servings = max(rec.servings, 1)
    total_values = NutritionTotalsValues(
        **{k: round(v, 1) if v is not None else None for k, v in totals.items()}
    )
    per_serving_values = NutritionTotalsValues(
        **{k: round(v / servings, 1) if v is not None else None for k, v in totals.items()}
    )
    return NutritionAggregate(
        per_serving=per_serving_values,
        total=total_values,
        coverage=NutritionCoverage(counted=counted, total=total_ings),
        is_estimate=is_estimate,
        servings=servings,
    )


def _full(
    rec,
    *,
    share_source: str | None = None,
    owner_name: str | None = None,
    share_permission: CollaboratorPermission | None = None,
    internal_share_count: int | None = None,
    book_shared: bool = False,
) -> dict:
    from app.schemas.share import ShareState
    share_state = None
    if internal_share_count is not None:
        share_state = ShareState(
            internal_count=internal_share_count,
            public=bool(rec.share_enabled),
            via_book=book_shared,
        )
    return RecipeOut.model_validate(rec).model_copy(
        update={
            "nutrition": _nutrition_aggregate(rec),
            "share_source": share_source,
            "owner_name": owner_name,
            "share_permission": share_permission,
            "share_state": share_state,
        }
    ).model_dump(mode="json")


# ---------- Recipes ----------

@router.get("")
async def get_recipes(
    q: str | None = None,
    tag: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns the user's own recipes plus anything shared with them
    (per-recipe internal share or via a whole-book share). De-duped —
    a recipe shared both ways is returned once with share_source="individual"."""
    rows = await list_accessible_recipes(db, user.id, q=q, tag=tag)
    # share_state populated for owned rows only — single GROUP BY
    # against recipe_shares keeps this O(1) per request.
    from app.services.share_state_service import recipe_internal_share_counts
    owned_ids = [r.id for r, _c, src, _name, _perm in rows if src is None]
    counts = await recipe_internal_share_counts(db, owned_ids)
    # Book-share coverage: a single per-viewer flag. Every recipe the
    # viewer owns is reachable to anyone they've granted a recipe-book
    # share to — independent of per-recipe RecipeShare rows. Cost:
    # one COUNT-ish query per overview request.
    from sqlalchemy import select as _select, func as _func
    from app.models.recipe import RecipeBookShare
    book_shared = bool(
        (
            await db.execute(
                _select(_func.count(RecipeBookShare.id)).where(
                    RecipeBookShare.owner_id == user.id
                )
            )
        ).scalar_one()
    )
    # Permission isn't surfaced on the summary — the detail endpoint adds it
    # when the user opens a specific recipe.
    return ok([
        _summary(
            r,
            c,
            share_source=src,
            owner_name=name,
            internal_share_count=counts.get(r.id, 0) if src is None else None,
            book_shared=book_shared if src is None else False,
        )
        for r, c, src, name, _perm in rows
    ])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_recipe(
    payload: RecipeCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    data = payload.model_dump()
    ingredients = data.pop("ingredients", [])
    steps = data.pop("steps", [])
    rec = await create_recipe(db, user.id, ingredients=ingredients, steps=steps, **data)
    # New recipe — audience is just the owner (no shares yet), so this
    # mostly serves the cross-device-same-user case.
    await emit_recipe_event(
        db, rec.id, "recipe.created", actor_id=user.id, client_id=client_id
    )
    return ok(_full(rec))


@router.get("/{recipe_id}")
async def get_recipe_route(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Owners see their recipe; recipients (individual or book share) get
    the same payload with share_source/owner_name set so the UI can render
    in read-only mode."""
    try:
        rec, share_source, perm = await get_accessible_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    owner_name = None
    if share_source is not None:
        # One small lookup — the listing endpoint batches these but here
        # it's a single user.
        owner = await db.execute(select(User.name).where(User.id == rec.owner_id))
        owner_name = owner.scalar_one_or_none()
    # share_state is owner-side only — recipients don't see how many
    # others were granted access. Single COUNT + single boolean.
    share_count: int | None = None
    book_shared = False
    if share_source is None:
        from app.services.share_state_service import recipe_internal_share_counts
        counts = await recipe_internal_share_counts(db, [rec.id])
        share_count = counts.get(rec.id, 0)
        from sqlalchemy import func as _func
        from app.models.recipe import RecipeBookShare
        book_shared = bool(
            (
                await db.execute(
                    select(_func.count(RecipeBookShare.id)).where(
                        RecipeBookShare.owner_id == user.id
                    )
                )
            ).scalar_one()
        )
    return ok(
        _full(
            rec,
            share_source=share_source,
            owner_name=owner_name,
            share_permission=perm,
            internal_share_count=share_count,
            book_shared=book_shared,
        )
    )


@router.patch("/{recipe_id}")
async def patch_recipe(
    recipe_id: int,
    payload: RecipeUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    rec = await require_recipe_edit(db, recipe_id, user.id)
    rec = await update_recipe(db, rec, **payload.model_dump(exclude_unset=True))
    # Re-load through the access path so the response carries fresh
    # share_source/permission for recipient editors.
    rec, share_source, perm = await get_accessible_recipe(db, recipe_id, user.id)
    owner_name = None
    if share_source is not None:
        owner = await db.execute(select(User.name).where(User.id == rec.owner_id))
        owner_name = owner.scalar_one_or_none()
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok(
        _full(
            rec,
            share_source=share_source,
            owner_name=owner_name,
            share_permission=perm,
        )
    )


@router.delete("/{recipe_id}")
async def del_recipe(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    # Snapshot the audience BEFORE delete — cascade nukes the shares.
    audience = await recipe_audience(db, recipe_id)
    await delete_recipe(db, rec)
    await emit_recipe_deleted(
        audience, recipe_id, actor_id=user.id, client_id=client_id
    )
    return ok({"message": "Deleted"})


@router.post("/{recipe_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def post_duplicate(
    recipe_id: int,
    payload: RecipeDuplicate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    # Open to recipients (any access) — the dup is created in their own
    # account and the source isn't mutated.
    src = await recipe_with_any_access(db, recipe_id, user.id)
    new = await duplicate_recipe(db, src, user.id, payload.title)
    # Duplicate lands in the duplicator's account — audience is just
    # them (no shares yet), so this fires a recipe.created so any
    # other device of the same user updates.
    await emit_recipe_event(
        db, new.id, "recipe.created", actor_id=user.id, client_id=client_id
    )
    return ok(_full(new))


# ---------- Ingredients ----------

@router.post("/{recipe_id}/ingredients", status_code=status.HTTP_201_CREATED)
async def post_ingredient(
    recipe_id: int,
    payload: IngredientCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await require_recipe_edit(db, recipe_id, user.id)
    ing = await add_ingredient(db, recipe_id, **payload.model_dump())
    # Sub-resource mutation → emit recipe.updated so the open detail
    # page on other devices re-fetches and shows the new ingredient.
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok(IngredientOut.model_validate(ing).model_dump(mode="json"))


@router.patch("/{recipe_id}/ingredients/reorder")
async def patch_ingredients_reorder(
    recipe_id: int,
    payload: ReorderRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await require_recipe_edit(db, recipe_id, user.id)
    await reorder_ingredients(db, recipe_id, [(i.id, i.position) for i in payload.items])
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok({"message": "Reordered"})


@router.patch("/{recipe_id}/ingredients/{ing_id}")
async def patch_ingredient(
    recipe_id: int,
    ing_id: int,
    payload: IngredientUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await require_recipe_edit(db, recipe_id, user.id)
    ing = await get_ingredient(db, recipe_id, ing_id)
    if not ing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingredient not found")
    ing = await update_ingredient(db, ing, **payload.model_dump(exclude_unset=True))
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok(IngredientOut.model_validate(ing).model_dump(mode="json"))


@router.delete("/{recipe_id}/ingredients/{ing_id}")
async def del_ingredient(
    recipe_id: int,
    ing_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    # Spec: deleting an individual ingredient counts as "modifying content"
    # — EDIT recipients allowed.
    await require_recipe_edit(db, recipe_id, user.id)
    ing = await get_ingredient(db, recipe_id, ing_id)
    if not ing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingredient not found")
    await delete_ingredient(db, ing)
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok({"message": "Deleted"})


# ---------- Steps ----------

@router.post("/{recipe_id}/steps", status_code=status.HTTP_201_CREATED)
async def post_step(
    recipe_id: int,
    payload: StepCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await require_recipe_edit(db, recipe_id, user.id)
    step = await add_step(db, recipe_id, payload.description)
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok(StepOut.model_validate(step).model_dump(mode="json"))


@router.patch("/{recipe_id}/steps/reorder")
async def patch_steps_reorder(
    recipe_id: int,
    payload: ReorderRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await require_recipe_edit(db, recipe_id, user.id)
    await reorder_steps(db, recipe_id, [(i.id, i.position) for i in payload.items])
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok({"message": "Reordered"})


@router.patch("/{recipe_id}/steps/{step_id}")
async def patch_step(
    recipe_id: int,
    step_id: int,
    payload: StepUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await require_recipe_edit(db, recipe_id, user.id)
    step = await get_step(db, recipe_id, step_id)
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    step = await update_step(db, step, **payload.model_dump(exclude_unset=True))
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok(StepOut.model_validate(step).model_dump(mode="json"))


@router.delete("/{recipe_id}/steps/{step_id}")
async def del_step(
    recipe_id: int,
    step_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await require_recipe_edit(db, recipe_id, user.id)
    step = await get_step(db, recipe_id, step_id)
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    await delete_step(db, step)
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok({"message": "Deleted"})


# ---------- Recipe image upload (manual, owner-supplied) ----------
#
# Distinct from `/import-photo` (which OCRs a recipe from a photo). This
# endpoint just stores a hero image for the recipe card and detail page.
# Files land in /app/uploads/recipes/{id}/<uuid>.<ext> and are served
# back via the StaticFiles mount at /static/.

import pathlib
import uuid as _uuid

ALLOWED_IMAGE_EXTS = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
UPLOADS_BASE = pathlib.Path("/app/uploads")


def _delete_owned_image(image_url: str | None) -> None:
    """Best-effort delete of a previously-uploaded image. No-ops for external
    URLs (the URL importer stores remote URLs that we don't manage)."""
    if not image_url or not image_url.startswith("/static/"):
        return
    rel = image_url[len("/static/") :]
    path = UPLOADS_BASE / rel
    try:
        # Resolve and confine to UPLOADS_BASE — guards against any path
        # tampering that survived a manual DB edit.
        resolved = path.resolve()
        if UPLOADS_BASE.resolve() in resolved.parents:
            resolved.unlink(missing_ok=True)
    except OSError:
        pass


@router.post("/{recipe_id}/image", status_code=status.HTTP_200_OK)
async def post_recipe_image(
    recipe_id: int,
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    rec = await require_recipe_edit(db, recipe_id, user.id)

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
    target_dir = UPLOADS_BASE / "recipes" / str(recipe_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / fname
    target_path.write_bytes(data)

    # Drop the previous file if we owned it. Done after the new write
    # succeeds so a failed upload never leaves the recipe with no image.
    _delete_owned_image(rec.image_url)

    rec.image_url = f"/static/recipes/{recipe_id}/{fname}"
    await db.commit()
    await db.refresh(rec)
    full, share_source, perm = await get_accessible_recipe(db, recipe_id, user.id)
    owner_name = None
    if share_source is not None:
        owner = await db.execute(select(User.name).where(User.id == full.owner_id))
        owner_name = owner.scalar_one_or_none()
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok(
        _full(full, share_source=share_source, owner_name=owner_name, share_permission=perm)
    )


@router.delete("/{recipe_id}/image", status_code=status.HTTP_200_OK)
async def del_recipe_image(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    rec = await require_recipe_edit(db, recipe_id, user.id)
    _delete_owned_image(rec.image_url)
    rec.image_url = None
    await db.commit()
    await db.refresh(rec)
    full, share_source, perm = await get_accessible_recipe(db, recipe_id, user.id)
    owner_name = None
    if share_source is not None:
        owner = await db.execute(select(User.name).where(User.id == full.owner_id))
        owner_name = owner.scalar_one_or_none()
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok(
        _full(full, share_source=share_source, owner_name=owner_name, share_permission=perm)
    )


# =============================================================================
#  Sharing — single recipe + recipe-book
# =============================================================================
#
# Same shape as ListsApi share endpoints. Only the owner can flip a recipe's
# share state; the public GET routes live below `share.py`'s router.

from app.schemas.share import ShareEnableResponse
from app.services.recipe_service import (
    disable_book_share as _disable_book_share,
    disable_recipe_share as _disable_recipe_share,
    enable_book_share as _enable_book_share,
    enable_recipe_share as _enable_recipe_share,
)


@router.post("/{recipe_id}/share/enable")
async def post_recipe_share_enable(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    token, url, qr = await _enable_recipe_share(db, rec)
    return ok(
        ShareEnableResponse(share_token=token, share_url=url, qr_code_png_base64=qr).model_dump()
    )


@router.post("/{recipe_id}/share/disable")
async def post_recipe_share_disable(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await _disable_recipe_share(db, rec)
    return ok({"message": "Share disabled"})


@router.post("/share-book/enable")
async def post_book_share_enable(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    token, url, qr = await _enable_book_share(db, user)
    return ok(
        ShareEnableResponse(share_token=token, share_url=url, qr_code_png_base64=qr).model_dump()
    )


@router.post("/share-book/disable")
async def post_book_share_disable(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _disable_book_share(db, user)
    return ok({"message": "Book share disabled"})


# =============================================================================
#  Internal sharing — alembic 0012 (per-recipe + per-book)
# =============================================================================
#
# PRIVACY: the email-lookup is done EXCLUSIVELY here, only on POST submit,
# and only as an exact (case-insensitive) match. There is no autocomplete
# endpoint, no partial-match, no "is this email registered?" probe. The
# response always returns either "internal" + the recipient's name (when
# the email matched a Lyst user) or "external" (when the link was emailed
# to a non-user). External emails are sent via the existing Resend
# integration; if Resend is not configured the link is logged.

from app.email.sender import send_email
from app.email.templates import recipe_book_share_email, recipe_share_email
from app.schemas.recipe import (
    InternalShareOut,
    ShareByEmailRequest,
    ShareByEmailResponse,
    ShareUpdateRequest,
)
from app.services.recipe_service import (
    leave_book_internal_share,
    leave_recipe_internal_share,
    update_book_internal_share_permission,
    update_recipe_internal_share_permission,
)


# ---------- Single recipe ----------

@router.post("/{recipe_id}/share/email")
async def post_share_recipe_by_email(
    recipe_id: int,
    payload: ShareByEmailRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    try:
        kind, name, recipient_id = await share_recipe_with_email(
            db, rec, user, payload.email, payload.permission
        )
    except ValueError as e:
        if str(e) == "self-share":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Das ist deine eigene Adresse.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if kind == "external":
        # Send the public link via Resend. share_token is now guaranteed
        # to exist because the service ensures it.
        url = f"{settings.FRONTEND_URL}/share/recipe/{rec.share_token}"
        subject, html = recipe_share_email(user.name, rec.title, url)
        await send_email(payload.email, subject, html)
    elif kind == "internal" and recipient_id is not None:
        # Fan out share.created → the new recipient's user-WS channel.
        # Their recipes overview re-fetches and the just-shared recipe
        # appears; the dispatcher also fires a toast.
        await emit_share_event(
            recipient_id=recipient_id,
            actor_id=user.id,
            resource_type="recipe",
            resource_id=rec.id,
            event="share.created",
            client_id=client_id,
            payload={"actor_name": user.name, "title": rec.title},
        )
        # Persist a notification row so the recipient still sees the
        # share in their bell after a refresh / next session.
        await notify_share_created(
            db,
            recipient_id=recipient_id,
            actor_id=user.id,
            actor_name=user.name,
            resource_type="recipe",
            resource_id=rec.id,
            title=rec.title,
        )

    return ok(ShareByEmailResponse(type=kind, user_name=name).model_dump())


@router.get("/{recipe_id}/shares")
async def get_recipe_shares(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    rows = await list_recipe_internal_shares(db, recipe_id)
    return ok(
        [
            InternalShareOut(
                user_id=u.id,
                name=u.name,
                email=u.email,
                permission=s.permission,
                created_at=s.created_at,
            ).model_dump(mode="json")
            for s, u in rows
        ]
    )


@router.delete("/{recipe_id}/shares/{user_id}")
async def del_recipe_share(
    recipe_id: int,
    user_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await revoke_recipe_internal_share(db, recipe_id, user_id)
    return ok({"message": "Share revoked"})


# ---------- Whole recipe book ----------

@router.post("/share-book/email")
async def post_share_book_by_email(
    payload: ShareByEmailRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    try:
        kind, name, recipient_id = await share_book_with_email(
            db, user, payload.email, payload.permission
        )
    except ValueError as e:
        if str(e) == "self-share":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Das ist deine eigene Adresse.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if kind == "external":
        url = f"{settings.FRONTEND_URL}/share/recipe-book/{user.recipe_book_share_token}"
        subject, html = recipe_book_share_email(user.name, url)
        await send_email(payload.email, subject, html)
    elif kind == "internal" and recipient_id is not None:
        # Share-book recipient gets a share.created targeting the
        # owner's user_id (resource_id) — the dispatcher's "share"
        # branch already invalidates recipes for the recipient.
        await emit_share_event(
            recipient_id=recipient_id,
            actor_id=user.id,
            resource_type="recipe",
            resource_id=user.id,  # whole-book share — owner id stands in
            event="share.created",
            client_id=client_id,
            payload={"actor_name": user.name, "title": "Rezeptbuch"},
        )
        await notify_share_created(
            db,
            recipient_id=recipient_id,
            actor_id=user.id,
            actor_name=user.name,
            resource_type="recipe",
            resource_id=user.id,
            title="Rezeptbuch",
        )

    return ok(ShareByEmailResponse(type=kind, user_name=name).model_dump())


@router.get("/share-book/shares")
async def get_book_shares(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_book_internal_shares(db, user.id)
    return ok(
        [
            InternalShareOut(
                user_id=u.id,
                name=u.name,
                email=u.email,
                permission=s.permission,
                created_at=s.created_at,
            ).model_dump(mode="json")
            for s, u in rows
        ]
    )


@router.delete("/share-book/shares/{user_id}")
async def del_book_share(
    user_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await revoke_book_internal_share(db, user.id, user_id)
    return ok({"message": "Share revoked"})


# =============================================================================
#  Permission updates + recipient-initiated leave (alembic 0014)
# =============================================================================
#
# Path-order note: FastAPI returns 422 (not "try the next route") when an
# int path converter fails, so any literal-path route ("/shares/me") MUST
# be registered BEFORE "/shares/{user_id:int}". Same goes for the book
# variant.

@router.delete("/{recipe_id}/shares/me")
async def leave_recipe_share(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Recipient-initiated removal of their own RecipeShare row. Idempotent."""
    await leave_recipe_internal_share(db, recipe_id, user.id)
    return ok({"message": "Left share"})


@router.patch("/{recipe_id}/shares/{user_id}")
async def patch_recipe_share(
    recipe_id: int,
    user_id: int,
    payload: ShareUpdateRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    # Owner-only — recipients can't change anyone's permission, including
    # their own.
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    updated = await update_recipe_internal_share_permission(
        db, recipe_id, user_id, payload.permission
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Share not found"
        )
    return ok({"message": "Permission updated"})


@router.delete("/share-book/shares/me/{owner_id}")
async def leave_book_share(
    owner_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Recipient leaves a book share. Path includes the owner_id so the
    recipient identifies which sender's book to drop — RecipeBookShare's
    natural key is (owner_id, shared_with_user_id). Registered before the
    /shares/{user_id} route to avoid the int-converter-422 trap."""
    await leave_book_internal_share(db, owner_id, user.id)
    return ok({"message": "Left share"})


@router.patch("/share-book/shares/{user_id}")
async def patch_book_share(
    user_id: int,
    payload: ShareUpdateRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    updated = await update_book_internal_share_permission(
        db, user.id, user_id, payload.permission
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Share not found"
        )
