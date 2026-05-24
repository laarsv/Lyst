"""Nutrition endpoints — extracted from recipes.py to keep the main
router focused on Recipe CRUD.

Mounted under the same /recipes prefix so the public URLs are unchanged:

  GET  /recipes/ingredients/nutrition-search?q=…
  POST /recipes/ingredients/nutrition-estimate
  POST /recipes/{recipe_id}/ingredients/nutrition-fill-all

The recipe_id is typed `int` on the bulk endpoint, so the literal
"ingredients" segment in the first two cannot collide.

Permission gate (`require_recipe_edit`) is imported back from the
parent recipes router — there's only one access policy and we don't
want it duplicated.
"""
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_client_id, require_user
from app.core.responses import ok
from app.models.recipe import NutritionSource
from app.models.user import User
from app.routers.recipes_access import require_recipe_edit
from app.schemas.recipe import (
    NutritionEstimateRequest,
    NutritionEstimateResponse,
    NutritionFillAllItem,
    NutritionFillAllRequest,
    NutritionFillAllResponse,
    NutritionSearchResponse,
)
from app.services.nutrition_lookup_service import (
    estimate_with_ollama,
    off_budget_remaining,
    search_combined,
    search_for_each,
)
from app.services.realtime_events import emit_recipe_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recipes", tags=["recipes"])


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


# ---------- Bulk nutrition fill (v1.5.1) ----------
#
# POST /recipes/{id}/ingredients/nutrition-fill-all
#
# Fills nutrition for every ingredient (or only the empty ones) in one
# trip. USDA-first via the existing search_for_each helper (already
# rate-aware), OFF as fallback for misses, optional Ollama estimate
# for whatever's still missing — opt-in via use_ai_fallback so AI is
# never silent. Returns a per-row summary the UI uses to render
# "filled 8/10 · 2 not found" + an offer to AI-fill the misses.

@router.post("/{recipe_id}/ingredients/nutrition-fill-all")
async def post_nutrition_fill_all(
    recipe_id: int,
    payload: NutritionFillAllRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    """Bulk-fill nutrition values for the recipe's ingredients.

    `mode='fill_empty'` (default) skips rows that already carry any
    per-100g value. `mode='refill_all'` overwrites everything.

    `ingredient_ids` (optional) restricts the operation to a subset —
    the UI passes this for the post-result "KI für die fehlenden"
    button so AI only runs on the rows the user opted into.

    Rate-budget awareness: USDA is fanned out with bounded
    concurrency; OFF only fills the USDA-misses sequentially and
    stops once the 10/min budget is exhausted. Rows that would have
    hit OFF but didn't get a slot come back with status='deferred'
    so the UI can offer "in einer Minute nochmal versuchen".
    """
    rec = await require_recipe_edit(db, recipe_id, user.id)
    fields = (
        "calories_per_100g",
        "protein_per_100g",
        "carbs_per_100g",
        "fat_per_100g",
        "fiber_per_100g",
        "sugar_per_100g",
        "salt_per_100g",
    )

    # Select target rows. fill_empty: skip rows that already carry any
    # value. refill_all: every row. Subset: also intersect.
    targets: list = []
    skipped_count = 0
    id_filter = set(payload.ingredient_ids or []) or None
    for ing in rec.ingredients:
        if id_filter is not None and ing.id not in id_filter:
            continue
        if payload.mode == "fill_empty":
            already = any(getattr(ing, f) is not None for f in fields)
            if already:
                skipped_count += 1
                continue
        targets.append(ing)

    # Phase 1+2 — USDA fan-out then OFF for misses, all rate-aware.
    # search_for_each runs USDA in parallel (bounded), then OFF
    # serially while the 10/min gate has slots. Any row still
    # uncovered after that is either AI-fallback territory or stays
    # not_found.
    queries = [ing.name for ing in targets]
    hit_map: dict[str, object] = await search_for_each(queries) if queries else {}

    # OFF-budget snapshot AFTER the fan-out — if it's empty AND there
    # are still unmatched rows that we didn't reach with OFF, we'll
    # surface those as 'deferred' rather than 'not_found' so the user
    # knows to retry.
    off_remaining_after = off_budget_remaining()

    results: list[NutritionFillAllItem] = []
    filled = 0
    not_found = 0
    deferred = 0

    for ing in targets:
        entry = hit_map.get(ing.name) if isinstance(hit_map, dict) else None
        if entry is not None:
            # entry is a _ImporterHit from search_for_each
            hit = entry.hit  # type: ignore[attr-defined]
            src = entry.source  # type: ignore[attr-defined]
            ing.calories_per_100g = hit.nutrition.calories_per_100g
            ing.protein_per_100g = hit.nutrition.protein_per_100g
            ing.carbs_per_100g = hit.nutrition.carbs_per_100g
            ing.fat_per_100g = hit.nutrition.fat_per_100g
            ing.fiber_per_100g = hit.nutrition.fiber_per_100g
            ing.sugar_per_100g = hit.nutrition.sugar_per_100g
            ing.salt_per_100g = hit.nutrition.salt_per_100g
            ing.nutrition_source = NutritionSource(src)
            if src == "usda":
                ing.usda_fdc_id = hit.fdc_id
                ing.off_product_code = None
            else:
                ing.off_product_code = hit.code
                ing.usda_fdc_id = None
            filled += 1
            results.append(NutritionFillAllItem(
                ingredient_id=ing.id, name=ing.name, status="filled", source=src,
            ))
            continue

        # USDA + OFF both missed. Try AI if the caller opted in.
        if payload.use_ai_fallback:
            try:
                est = await estimate_with_ollama(ing.name)
            except Exception:  # pragma: no cover — defensive
                logger.warning("AI nutrition estimate failed for %r", ing.name, exc_info=True)
                est = None
            if est and any(
                getattr(est.nutrition, f) is not None for f in fields
            ):
                ing.calories_per_100g = est.nutrition.calories_per_100g
                ing.protein_per_100g = est.nutrition.protein_per_100g
                ing.carbs_per_100g = est.nutrition.carbs_per_100g
                ing.fat_per_100g = est.nutrition.fat_per_100g
                ing.fiber_per_100g = est.nutrition.fiber_per_100g
                ing.sugar_per_100g = est.nutrition.sugar_per_100g
                ing.salt_per_100g = est.nutrition.salt_per_100g
                ing.nutrition_source = NutritionSource.AI
                ing.off_product_code = None
                ing.usda_fdc_id = None
                filled += 1
                results.append(NutritionFillAllItem(
                    ingredient_id=ing.id, name=ing.name, status="filled", source="ai",
                ))
                continue

        # No fill happened. If OFF was the only remaining path and we
        # ran out of budget, mark as deferred so the UI says
        # "try again shortly" rather than "permanently not found".
        if off_remaining_after <= 0 and not settings.FDC_API_KEY:
            deferred += 1
            results.append(NutritionFillAllItem(
                ingredient_id=ing.id, name=ing.name, status="deferred",
            ))
        else:
            not_found += 1
            results.append(NutritionFillAllItem(
                ingredient_id=ing.id, name=ing.name, status="not_found",
            ))

    # Persist every change in one transaction.
    if filled > 0:
        await db.commit()

    # Add skipped rows to the response so the UI can render an
    # accurate total. skipped rows are NOT in `targets` so we
    # synthesize their summary entries here.
    if payload.mode == "fill_empty" and id_filter is None:
        for ing in rec.ingredients:
            if any(getattr(ing, f) is not None for f in fields):
                # Was it already-filled before this call? Yes if it
                # wasn't in targets (we filtered already-filled there).
                if not any(r.ingredient_id == ing.id for r in results):
                    results.append(NutritionFillAllItem(
                        ingredient_id=ing.id, name=ing.name, status="skipped",
                        source=ing.nutrition_source.value if ing.nutrition_source else None,
                    ))

    # Fan out a recipe.updated WS event so other devices refresh.
    if filled > 0:
        await emit_recipe_event(
            db, recipe_id, "recipe.updated", actor_id=user.id, client_id=client_id,
        )

    resp = NutritionFillAllResponse(
        results=results,
        filled=filled,
        not_found=not_found,
        skipped=skipped_count,
        deferred=deferred,
        total=len(rec.ingredients),
    )
    return ok(resp.model_dump(mode="json"))
