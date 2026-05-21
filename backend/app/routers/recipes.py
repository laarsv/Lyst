from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_client_id, require_user
from app.core.responses import ok
from app.models.collaborator import CollaboratorPermission
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.recipe import (
    CopyToListRequest,
    CopyToListResponse,
    ImportUrlRequest,
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    NutritionEstimateRequest,
    NutritionEstimateResponse,
    NutritionSearchResponse,
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
    SuggestRequest,
    SuggestResponse,
)
from app.services.import_service import (
    RecipeImportError,
    import_recipe_from_html_bytes,
    import_recipe_from_image,
    import_recipe_from_pdf_bytes,
    import_recipe_from_text,
    import_recipe_from_url,
    suggest_recipes_from_ingredients,
)
from app.services.nutrition_lookup_service import (
    estimate_with_ollama,
    search_combined,
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
    copy_to_list,
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

async def _require_recipe_edit(
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


async def _recipe_with_any_access(
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
    rec = await _require_recipe_edit(db, recipe_id, user.id)
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
    src = await _recipe_with_any_access(db, recipe_id, user.id)
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
    await _require_recipe_edit(db, recipe_id, user.id)
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
    await _require_recipe_edit(db, recipe_id, user.id)
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
    await _require_recipe_edit(db, recipe_id, user.id)
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
    await _require_recipe_edit(db, recipe_id, user.id)
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
    await _require_recipe_edit(db, recipe_id, user.id)
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
    await _require_recipe_edit(db, recipe_id, user.id)
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
    await _require_recipe_edit(db, recipe_id, user.id)
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
    await _require_recipe_edit(db, recipe_id, user.id)
    step = await get_step(db, recipe_id, step_id)
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    await delete_step(db, step)
    await emit_recipe_event(
        db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id
    )
    return ok({"message": "Deleted"})


# ---------- Nutrition lookup ----------
#
# Two endpoints power the "Nährwerte" sheet on each ingredient row:
#   GET  /recipes/ingredients/nutrition-search?q=…  — OFF candidates
#   POST /recipes/ingredients/nutrition-estimate    — Ollama fallback
#
# `recipe_id` is typed as int on every /{recipe_id} route below, so the
# literal "ingredients" segment can't collide with those paths.

@router.get("/ingredients/nutrition-search")
async def get_nutrition_search(
    q: str = Query(..., min_length=1, max_length=255),
    user: User = Depends(require_user),
):
    """Grouped USDA + Open Food Facts candidates for the query.

    Two groups in the response when both upstreams have hits: USDA
    raw ingredients first ("Lebensmittel"), OFF branded products
    second ("Markenprodukte"). Empty groups are omitted entirely.

    Returns `unavailable=True` (with empty `groups`) when the lookup
    is disabled by config OR every configured upstream failed — the
    frontend shows the "Aktuell nicht erreichbar" hint and offers
    the KI / manuell paths instead."""
    groups, unavailable = await search_combined(q)
    return ok(
        NutritionSearchResponse(groups=groups, unavailable=unavailable).model_dump(
            mode="json"
        )
    )


@router.post("/ingredients/nutrition-estimate")
async def post_nutrition_estimate(
    payload: NutritionEstimateRequest,
    user: User = Depends(require_user),
):
    """Local Ollama estimate for ingredients OFF doesn't know about.
    Always returns a payload (the model surfaces a German note when it
    can't make a confident guess), so the sheet can show *something*
    instead of a hard error."""
    resp: NutritionEstimateResponse = await estimate_with_ollama(
        payload.name, payload.hint
    )
    return ok(resp.model_dump(mode="json"))


# ---------- Import from URL via Ollama ----------

@router.post("/import-url")
async def post_import_url(
    payload: ImportUrlRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await import_recipe_from_url(payload.url, db)
    except RecipeImportError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(result.model_dump(mode="json"))


# ---------- Import from photo via Ollama vision ----------

MAX_PHOTO_BYTES = 10 * 1024 * 1024
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


@router.post("/import-photo")
async def post_import_photo(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
):
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nur JPG, PNG und WebP werden unterstützt",
        )
    data = await file.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Maximale Bildgröße: 10 MB",
        )
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leere Datei")
    try:
        result = await import_recipe_from_image(data)
    except RecipeImportError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(result.model_dump(mode="json"))


# ---------- Unified import (file OR free text) ----------
#
# POST /recipes/import accepts EITHER a multipart upload (image / HTML /
# PDF) OR a JSON body {"text": "..."}. Detection is by Content-Type:
# multipart/form-data → file path; application/json → text path. Each
# input is routed to the matching import_recipe_from_* helper and the
# result is the same ImportedRecipe shape as the legacy /import-url
# and /import-photo endpoints — frontend keeps one preview screen for
# all paths.
#
# /import-url and /import-photo stay as-is for backward compat.

_IMPORT_IMAGE_TYPES = ALLOWED_PHOTO_TYPES
_IMPORT_HTML_TYPES = {"text/html", "application/xhtml+xml"}
_IMPORT_PDF_TYPES = {"application/pdf"}
_IMPORT_MAX_BYTES = MAX_PHOTO_BYTES  # same 10 MB ceiling across types


@router.post("/import")
async def post_import(
    request: Request,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Single endpoint, four flavours. The Content-Type tells us
    which path to take:
      - application/json    → {"text": "..."} free-text path
      - multipart/form-data → file field, dispatched by its own
                              Content-Type (image / HTML / PDF)
    """
    ct = (request.headers.get("content-type") or "").lower()

    # --- JSON: free-text path --------------------------------------------
    if ct.startswith("application/json"):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ungültiger JSON-Body",
            )
        text = (body or {}).get("text") if isinstance(body, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Kein Text eingegeben",
            )
        try:
            result = await import_recipe_from_text(text, db)
        except RecipeImportError as e:
            raise HTTPException(status_code=e.status, detail=e.message)
        return ok(result.model_dump(mode="json"))

    # --- Multipart: file path --------------------------------------------
    if not ct.startswith("multipart/form-data"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bitte JSON oder eine Datei senden",
        )
    form = await request.form()
    upload = form.get("file")
    if not isinstance(upload, UploadFile):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Datei fehlt (Feldname 'file')",
        )

    # Stream-read so a 50 MB upload doesn't get buffered before we
    # reject it on size.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > _IMPORT_MAX_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Maximale Dateigröße: 10 MB",
            )
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Leere Datei",
        )

    file_ct = (upload.content_type or "").lower()
    # Fallback: when the client doesn't send a content-type (drag/drop
    # of a .html file in some browsers), sniff by filename extension.
    if not file_ct or file_ct == "application/octet-stream":
        name = (upload.filename or "").lower()
        if name.endswith(".pdf"):
            file_ct = "application/pdf"
        elif name.endswith((".html", ".htm")):
            file_ct = "text/html"
        elif name.endswith(".jpg") or name.endswith(".jpeg"):
            file_ct = "image/jpeg"
        elif name.endswith(".png"):
            file_ct = "image/png"
        elif name.endswith(".webp"):
            file_ct = "image/webp"

    try:
        if file_ct in _IMPORT_IMAGE_TYPES:
            result = await import_recipe_from_image(data)
        elif file_ct in _IMPORT_HTML_TYPES:
            result = await import_recipe_from_html_bytes(data, db)
        elif file_ct in _IMPORT_PDF_TYPES:
            result = await import_recipe_from_pdf_bytes(data, db)
        else:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Unterstützt: JPG, PNG, WebP, HTML, PDF",
            )
    except RecipeImportError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(result.model_dump(mode="json"))


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
    rec = await _require_recipe_edit(db, recipe_id, user.id)

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
    rec = await _require_recipe_edit(db, recipe_id, user.id)
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


# ---------- "Was kann ich kochen?" ----------

@router.post("/suggest")
async def post_suggest(
    payload: SuggestRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    # Build a compact catalog of the user's recipes (id, title, ingredient names).
    result = await db.execute(
        select(Recipe)
        .options(selectinload(Recipe.ingredients))
        .where(Recipe.owner_id == user.id)
    )
    catalog = []
    for r in result.scalars().all():
        names = [i.name for i in r.ingredients]
        if not names:
            continue
        catalog.append({"id": r.id, "title": r.title, "ingredients": names})
    if not catalog:
        return ok(SuggestResponse(suggestions=[]).model_dump())
    try:
        suggestions = await suggest_recipes_from_ingredients(
            db, payload.available_ingredients, catalog
        )
    except RecipeImportError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(
        SuggestResponse(
            suggestions=[
                {"recipe_id": s.recipe_id, "title": s.title, "reason": s.reason}
                for s in suggestions
            ]
        ).model_dump()
    )


# ---------- Copy to shopping list (the killer feature) ----------

@router.post("/{recipe_id}/copy-to-list", status_code=status.HTTP_201_CREATED)
async def post_copy_to_list(
    recipe_id: int,
    payload: CopyToListRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    # Recipients (any access) can copy ingredients to their own shopping list.
    rec = await _recipe_with_any_access(db, recipe_id, user.id)
    try:
        target, added = await copy_to_list(
            db,
            rec,
            user.id,
            list_id=payload.list_id,
            new_list_title=payload.new_list_title,
            servings=payload.servings,
            ingredient_ids=payload.ingredient_ids,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok(
        CopyToListResponse(
            list_id=target.id, list_title=target.title, items_added=added
        ).model_dump()
    )


# =============================================================================
#  AI assist endpoints (Features 1 & 3)
# =============================================================================
#  All AI calls go through the centralised app/services/ollama.py so model,
#  keep_alive, and timeout stay consistent with the rest of the app.

from pydantic import ValidationError as _ValidationError

from app.schemas.recipe import (
    AiAssistRequest,
    AiSuggestedIngredient,
    AiSuggestedStep,
    AiVariationRequest,
)
from app.services.ollama import OllamaError, call_text_json


def _ingredient_lines(rec: Recipe) -> str:
    """Compact one-line-per-ingredient catalog for AI prompts."""
    parts: list[str] = []
    for ing in rec.ingredients:
        qty = ""
        if ing.quantity is not None:
            qty = f" ({ing.quantity} {ing.unit or ''})".rstrip()
        parts.append(f"- {ing.name}{qty}")
    return "\n".join(parts) if parts else "(noch keine)"


def _step_lines(rec: Recipe) -> str:
    if not rec.steps:
        return "(noch keine)"
    return "\n".join(f"{i + 1}. {s.description}" for i, s in enumerate(rec.steps))


_AI_INGREDIENTS_SYSTEM = (
    "Du erweiterst ein vorhandenes Rezept um zusätzliche Zutaten basierend auf "
    "dem Wunsch der Nutzerin. Antworte AUSSCHLIESSLICH mit einem JSON-Array — "
    "kein Markdown, kein Codeblock, kein einleitender Text. Schema pro Eintrag: "
    '{"name": "string (auf Deutsch)", "quantity": Zahl oder null, "unit": "string oder null"}. '
    "Schlage nur Zutaten vor, die noch nicht in der Liste sind."
)

_AI_STEPS_SYSTEM = (
    "Du erweiterst ein vorhandenes Rezept um zusätzliche Zubereitungsschritte. "
    "Antworte AUSSCHLIESSLICH mit einem JSON-Array — kein Markdown, kein Codeblock, "
    "kein einleitender Text. Schema pro Eintrag: "
    '{"description": "string (auf Deutsch)", "suggested_position": Zahl ab 1 (Position innerhalb der bestehenden Schritte) oder null}. '
    "Wenn ein neuer Schritt nach Schritt 2 stehen soll, dann suggested_position=3. "
    "Vor allen anderen → 1. Am Ende → null oder höher als Anzahl bestehender Schritte."
)


@router.post("/{recipe_id}/ai/suggest-ingredients")
async def post_ai_suggest_ingredients(
    recipe_id: int,
    payload: AiAssistRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rec = await _require_recipe_edit(db, recipe_id, user.id)

    user_prompt = (
        f"Rezept: {rec.title}\n"
        f"Aktuelle Zutaten:\n{_ingredient_lines(rec)}\n\n"
        f"Wunsch: {payload.request}\n\n"
        f"Welche Zutaten würdest du dazu vorschlagen? Maximal 8 Vorschläge."
    )
    try:
        parsed = await call_text_json(
            user_prompt, system=_AI_INGREDIENTS_SYSTEM, temperature=0.3,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="KI-Antwort hat unerwartetes Format",
        )

    out: list[dict] = []
    for entry in parsed[:8]:
        try:
            sug = AiSuggestedIngredient.model_validate(entry)
        except _ValidationError:
            continue
        out.append(sug.model_dump())
    return ok(out)


@router.post("/{recipe_id}/ai/suggest-steps")
async def post_ai_suggest_steps(
    recipe_id: int,
    payload: AiAssistRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rec = await _require_recipe_edit(db, recipe_id, user.id)

    user_prompt = (
        f"Rezept: {rec.title}\n"
        f"Zutaten:\n{_ingredient_lines(rec)}\n\n"
        f"Aktuelle Schritte:\n{_step_lines(rec)}\n\n"
        f"Wunsch: {payload.request}\n\n"
        f"Welche zusätzlichen Schritte würdest du vorschlagen? Maximal 6 Vorschläge."
    )
    try:
        parsed = await call_text_json(
            user_prompt, system=_AI_STEPS_SYSTEM, temperature=0.3,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="KI-Antwort hat unerwartetes Format",
        )

    out: list[dict] = []
    for entry in parsed[:6]:
        try:
            sug = AiSuggestedStep.model_validate(entry)
        except _ValidationError:
            continue
        out.append(sug.model_dump())
    return ok(out)


# ---------- Feature 3: Recipe variations ----------

from app.services.import_service import ImportedRecipe as _ImportedRecipe

_AI_VARIATION_SYSTEM = (
    "Du erstellst eine Variante eines bestehenden Rezepts gemäß Wunsch der "
    "Nutzerin. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt im folgenden "
    "Schema — kein Markdown, kein Codeblock, kein einleitender Text:\n"
    "{\n"
    '  "title": "Titel der Variante (auf Deutsch)",\n'
    '  "description": "kurze Beschreibung oder null",\n'
    '  "servings": Zahl oder null,\n'
    '  "prep_time_minutes": Zahl oder null,\n'
    '  "cook_time_minutes": Zahl oder null,\n'
    '  "tags": ["string", ...] (passende deutsche Tags wie "vegetarisch", "schnell", "frühstück", ...),\n'
    '  "ingredients": [{"name": "...", "quantity": Zahl oder null, "unit": "string oder null"}],\n'
    '  "steps": [{"description": "...", "position": 1-basierte Zahl}]\n'
    "}"
)


@router.post("/{recipe_id}/ai/variation")
async def post_ai_variation(
    recipe_id: int,
    payload: AiVariationRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    # Variation generates a new payload but is essentially read+inference;
    # the caller decides whether to persist it as a duplicate.
    rec = await _recipe_with_any_access(db, recipe_id, user.id)

    user_prompt = (
        f"Original-Rezept:\n"
        f"Titel: {rec.title}\n"
        f"Portionen: {rec.servings}\n"
        f"Beschreibung: {rec.description or '(keine)'}\n"
        f"Zutaten:\n{_ingredient_lines(rec)}\n"
        f"Schritte:\n{_step_lines(rec)}\n\n"
        f"Wunsch: {payload.variation}\n\n"
        f"Erstelle ein angepasstes Rezept."
    )
    try:
        parsed = await call_text_json(
            user_prompt, system=_AI_VARIATION_SYSTEM, temperature=0.4,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="KI-Antwort hat unerwartetes Format",
        )

    # Renumber steps so client doesn't have to.
    if isinstance(parsed.get("steps"), list):
        for i, st in enumerate(parsed["steps"], start=1):
            if isinstance(st, dict):
                st["position"] = i

    # Reuse the URL-importer's Pydantic validator — same JSON contract.
    try:
        validated = _ImportedRecipe.model_validate(parsed)
    except _ValidationError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Variante hat unerwartetes Format",
        )
    return ok(validated.model_dump(mode="json"))


# ---------- Feature 8: Auto-tag (recipes) ----------

_AI_RECIPE_TAGS_SYSTEM = (
    "Du schlägst 2 bis 5 Tags für ein Rezept vor — z.B. Küchenstil, "
    "Anlass, Diät-Eigenschaft. Antworte AUSSCHLIESSLICH mit einem JSON-"
    "Array aus kurzen, kleingeschriebenen Wörtern (ohne #), auf Deutsch, "
    "ohne Markdown. Beispiel: [\"italienisch\", \"vegetarisch\", \"schnell\"]."
)


@router.post("/{recipe_id}/ai/tags")
async def post_ai_recipe_tags(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rec = await _require_recipe_edit(db, recipe_id, user.id)

    user_prompt = (
        f"Titel: {rec.title}\n"
        f"Beschreibung: {rec.description or '(keine)'}\n"
        f"Zutaten:\n{_ingredient_lines(rec)}\n\n"
        f"Aktuelle Tags: {', '.join(rec.tags or []) or '(keine)'}"
    )
    try:
        parsed = await call_text_json(
            user_prompt, system=_AI_RECIPE_TAGS_SYSTEM, temperature=0.3,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="KI-Antwort hat unerwartetes Format",
        )
    existing = {t.lower() for t in (rec.tags or [])}
    out: list[str] = []
    seen: set[str] = set()
    for entry in parsed:
        if not isinstance(entry, str):
            continue
        clean = entry.strip().lstrip('#').lower()
        if not clean or clean in existing or clean in seen:
            continue
        if len(clean) > 32:
            clean = clean[:32]
        seen.add(clean)
        out.append(clean)
        if len(out) >= 5:
            break
    return ok({"tags": out})


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
