from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.recipe import (
    CopyToListRequest,
    CopyToListResponse,
    ImportUrlRequest,
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    NutritionTotals,
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
    import_recipe_from_image,
    import_recipe_from_url,
    suggest_recipes_from_ingredients,
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


def _summary(
    rec,
    ingredient_count: int,
    *,
    share_source: str | None = None,
    owner_name: str | None = None,
) -> dict:
    return RecipeSummary.model_validate(rec).model_copy(
        update={
            "ingredient_count": ingredient_count,
            "share_source": share_source,
            "owner_name": owner_name,
        }
    ).model_dump(mode="json")


def _nutrition_per_serving(rec) -> NutritionTotals:
    """Sum each macro = (qty_in_grams / 100) * per100g, then divide by servings.
    Only ingredients with both `quantity` and a unit that resolves to grams
    (g, gr, gramm, kg) contribute. ml/EL/Stk are ignored — we'd need a density
    table to convert them."""
    GRAM_FACTOR = {"g": 1.0, "gr": 1.0, "gramm": 1.0, "kg": 1000.0}
    totals = {"calories": None, "protein": None, "carbs": None, "fat": None}
    fields = (
        ("calories", "calories_per_100g"),
        ("protein", "protein_per_100g"),
        ("carbs", "carbs_per_100g"),
        ("fat", "fat_per_100g"),
    )
    for ing in rec.ingredients:
        if ing.quantity is None:
            continue
        unit_key = (ing.unit or "").strip().lower()
        factor = GRAM_FACTOR.get(unit_key)
        if factor is None:
            continue
        grams = ing.quantity * factor
        for key, attr in fields:
            v = getattr(ing, attr)
            if v is None:
                continue
            contrib = grams / 100.0 * v
            totals[key] = (totals[key] or 0.0) + contrib
    servings = max(rec.servings, 1)
    return NutritionTotals(
        **{k: round(v / servings, 1) if v is not None else None for k, v in totals.items()}
    )


def _full(
    rec,
    *,
    share_source: str | None = None,
    owner_name: str | None = None,
) -> dict:
    return RecipeOut.model_validate(rec).model_copy(
        update={
            "nutrition_per_serving": _nutrition_per_serving(rec),
            "share_source": share_source,
            "owner_name": owner_name,
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
    return ok([_summary(r, c, share_source=src, owner_name=name) for r, c, src, name in rows])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_recipe(
    payload: RecipeCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump()
    ingredients = data.pop("ingredients", [])
    steps = data.pop("steps", [])
    rec = await create_recipe(db, user.id, ingredients=ingredients, steps=steps, **data)
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
        rec, share_source = await get_accessible_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    owner_name = None
    if share_source is not None:
        # One small lookup — the listing endpoint batches these but here
        # it's a single user.
        owner = await db.execute(select(User.name).where(User.id == rec.owner_id))
        owner_name = owner.scalar_one_or_none()
    return ok(_full(rec, share_source=share_source, owner_name=owner_name))


@router.patch("/{recipe_id}")
async def patch_recipe(
    recipe_id: int,
    payload: RecipeUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    rec = await update_recipe(db, rec, **payload.model_dump(exclude_unset=True))
    rec = await get_recipe(db, recipe_id, user.id)
    return ok(_full(rec))


@router.delete("/{recipe_id}")
async def del_recipe(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await delete_recipe(db, rec)
    return ok({"message": "Deleted"})


@router.post("/{recipe_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def post_duplicate(
    recipe_id: int,
    payload: RecipeDuplicate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        src = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    new = await duplicate_recipe(db, src, user.id, payload.title)
    return ok(_full(new))


# ---------- Ingredients ----------

@router.post("/{recipe_id}/ingredients", status_code=status.HTTP_201_CREATED)
async def post_ingredient(
    recipe_id: int,
    payload: IngredientCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    ing = await add_ingredient(db, recipe_id, **payload.model_dump())
    return ok(IngredientOut.model_validate(ing).model_dump(mode="json"))


@router.patch("/{recipe_id}/ingredients/reorder")
async def patch_ingredients_reorder(
    recipe_id: int,
    payload: ReorderRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await reorder_ingredients(db, recipe_id, [(i.id, i.position) for i in payload.items])
    return ok({"message": "Reordered"})


@router.patch("/{recipe_id}/ingredients/{ing_id}")
async def patch_ingredient(
    recipe_id: int,
    ing_id: int,
    payload: IngredientUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    ing = await get_ingredient(db, recipe_id, ing_id)
    if not ing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingredient not found")
    ing = await update_ingredient(db, ing, **payload.model_dump(exclude_unset=True))
    return ok(IngredientOut.model_validate(ing).model_dump(mode="json"))


@router.delete("/{recipe_id}/ingredients/{ing_id}")
async def del_ingredient(
    recipe_id: int,
    ing_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    ing = await get_ingredient(db, recipe_id, ing_id)
    if not ing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingredient not found")
    await delete_ingredient(db, ing)
    return ok({"message": "Deleted"})


# ---------- Steps ----------

@router.post("/{recipe_id}/steps", status_code=status.HTTP_201_CREATED)
async def post_step(
    recipe_id: int,
    payload: StepCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    step = await add_step(db, recipe_id, payload.description)
    return ok(StepOut.model_validate(step).model_dump(mode="json"))


@router.patch("/{recipe_id}/steps/reorder")
async def patch_steps_reorder(
    recipe_id: int,
    payload: ReorderRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await reorder_steps(db, recipe_id, [(i.id, i.position) for i in payload.items])
    return ok({"message": "Reordered"})


@router.patch("/{recipe_id}/steps/{step_id}")
async def patch_step(
    recipe_id: int,
    step_id: int,
    payload: StepUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    step = await get_step(db, recipe_id, step_id)
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    step = await update_step(db, step, **payload.model_dump(exclude_unset=True))
    return ok(StepOut.model_validate(step).model_dump(mode="json"))


@router.delete("/{recipe_id}/steps/{step_id}")
async def del_step(
    recipe_id: int,
    step_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    step = await get_step(db, recipe_id, step_id)
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    await delete_step(db, step)
    return ok({"message": "Deleted"})


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
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
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
    # Ingredients/steps for the full recipe response — matches the patch
    # endpoint's load pattern.
    full = await get_recipe(db, recipe_id, user.id)
    return ok(_full(full))


@router.delete("/{recipe_id}/image", status_code=status.HTTP_200_OK)
async def del_recipe_image(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    _delete_owned_image(rec.image_url)
    rec.image_url = None
    await db.commit()
    await db.refresh(rec)
    full = await get_recipe(db, recipe_id, user.id)
    return ok(_full(full))


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
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
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
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

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
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

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
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

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
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

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
)


# ---------- Single recipe ----------

@router.post("/{recipe_id}/share/email")
async def post_share_recipe_by_email(
    recipe_id: int,
    payload: ShareByEmailRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    try:
        kind, name = await share_recipe_with_email(db, rec, user, payload.email)
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
                user_id=u.id, name=u.name, email=u.email, created_at=s.created_at
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
):
    try:
        kind, name = await share_book_with_email(db, user, payload.email)
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
                user_id=u.id, name=u.name, email=u.email, created_at=s.created_at
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
