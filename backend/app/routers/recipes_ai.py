"""AI-assist endpoints — extracted from recipes.py.

All endpoints mount under /recipes so URLs stay unchanged:

  POST /recipes/suggest                          — "Was kann ich kochen?"
  POST /recipes/{id}/copy-to-list                — copy ingredients to a list
  POST /recipes/merge-preview                    — consolidate recipes (no save)
  POST /recipes/merge-to-list                    — merge recipes → shopping list
  POST /recipes/{id}/ai/suggest-ingredients      — extend ingredients
  POST /recipes/{id}/ai/suggest-steps            — extend steps
  POST /recipes/{id}/ai/tags                     — auto-tag
  POST /recipes/{id}/ingredients/{iid}/substitutions — ingredient alternatives
  POST /recipes/{id}/variants                    — generate + save linked variant
  GET  /recipes/{id}/variants                    — list child variants

All Ollama calls go through `app.services.ollama` so model/keep_alive/
timeouts stay consistent. Permission gates (require_recipe_edit /
recipe_with_any_access) are imported back from the parent recipes
router — single source of truth.

`/suggest` and `/copy-to-list` live here too, even though only the
copy endpoint touches a Recipe, because both are end-of-pipeline
features that lean on the same suggestion machinery.
"""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_client_id, require_user
from app.core.responses import ok
from app.models.recipe import Recipe
from app.models.user import User
from app.routers.recipes_access import recipe_with_any_access, require_recipe_edit
from app.schemas.recipe import (
    AiAssistRequest,
    AiSuggestedIngredient,
    AiSuggestedStep,
    CopyToListRequest,
    CopyToListResponse,
    MergePreviewItem,
    MergePreviewRequest,
    MergePreviewResponse,
    MergePreviewSection,
    MergeSubQuantity,
    MergeToListRequest,
    SubstitutionItem,
    SubstitutionRequest,
    SubstitutionResponse,
    SuggestRequest,
    SuggestResponse,
    VariantOut,
    VariantRequest,
)
from app.services.import_service import (
    ImportedRecipe,
    RecipeImportError,
    suggest_recipes_from_ingredients,
)
from app.services.ollama import OllamaError, call_text_json
from app.services.realtime_events import emit_recipe_event
from app.services.recipe_service import copy_to_list, create_recipe
from app.services.shopping_merge_service import consolidate, merge_to_list

router = APIRouter(prefix="/recipes", tags=["recipes"])

logger = logging.getLogger(__name__)


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
    rec = await recipe_with_any_access(db, recipe_id, user.id)
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


# ---------- Multi-recipe shopping merge ----------

async def _load_selected_recipes(db, user_id, selections):
    """Access-check + load each selected recipe (ingredients eager-loaded by
    recipe_with_any_access). Surfaces the helper's 404/403 as-is."""
    pairs = []
    for sel in selections:
        rec = await recipe_with_any_access(db, sel.recipe_id, user_id)
        pairs.append((rec, sel.servings))
    return pairs


def _to_sections(items) -> list[MergePreviewSection]:
    """Group the (already aisle-sorted) consolidated items into preview
    sections, preserving the aisle order consolidate() produced."""
    by_aisle: dict[str, list[MergePreviewItem]] = {}
    order: list[str] = []
    for it in items:
        if it.aisle not in by_aisle:
            by_aisle[it.aisle] = []
            order.append(it.aisle)
        by_aisle[it.aisle].append(
            MergePreviewItem(
                name=it.name,
                aisle=it.aisle,
                lines=[MergeSubQuantity(quantity=ln.quantity, unit=ln.unit) for ln in it.lines],
                recipes=it.recipes,
            )
        )
    return [MergePreviewSection(aisle=a, items=by_aisle[a]) for a in order]


@router.post("/merge-preview")
async def post_merge_preview(
    payload: MergePreviewRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Consolidate the selected recipes (no save) so the picker can show the
    deduped, aisle-grouped list with per-item provenance before confirming."""
    pairs = await _load_selected_recipes(db, user.id, payload.recipes)
    items = consolidate(pairs)
    sections = _to_sections(items)
    count = sum(len(it.lines) for it in items)
    return ok(MergePreviewResponse(sections=sections, item_count=count).model_dump())


@router.post("/merge-to-list", status_code=status.HTTP_201_CREATED)
async def post_merge_to_list(
    payload: MergeToListRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    pairs = await _load_selected_recipes(db, user.id, payload.recipes)
    items = consolidate(pairs)
    default_title = " + ".join(rec.title for rec, _ in pairs)[:255]
    try:
        target, added = await merge_to_list(
            db,
            user.id,
            items,
            list_id=payload.list_id,
            new_list_title=payload.new_list_title or default_title,
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
    rec = await require_recipe_edit(db, recipe_id, user.id)

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
        except ValidationError:
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
    rec = await require_recipe_edit(db, recipe_id, user.id)

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
        except ValidationError:
            continue
        out.append(sug.model_dump())
    return ok(out)


# ---------- Feature 3: Recipe variations ----------

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
    rec = await require_recipe_edit(db, recipe_id, user.id)

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


# ---------- AI ingredient substitutions ----------

_SUBSTITUTION_SYSTEM = (
    "Du schlägst realistische, im deutschen Supermarkt übliche Alternativen für "
    "EINE Zutat vor — keine exotischen Vorschläge (kein \"Yak-Milch\"). Antworte "
    "AUSSCHLIESSLICH mit einem JSON-Objekt, kein Markdown, kein Fließtext:\n"
    "{\n"
    '  "substitutions": [\n'
    '    {"name": "Alternative", "quantity": Zahl oder null, "unit": "Einheit oder null", "rationale": "kurz, max ~20 Wörter, Deutsch"}\n'
    "  ],\n"
    '  "note": "kurzer Hinweis oder null"\n'
    "}\n"
    "Gib 2 bis 4 sinnvolle Alternativen und passe die Menge an die Ersatzzutat "
    "an. Gibt es keine sinnvolle Alternative (z. B. Wasser, Salz), liefere eine "
    "leere Liste und eine freundliche Erklärung in note."
)

_SUBSTITUTION_CONTEXT_HINT = {
    "vegan": "Alle Alternativen müssen vegan sein.",
    "glutenfrei": "Alle Alternativen müssen glutenfrei sein.",
    "laktosefrei": "Alle Alternativen müssen laktosefrei sein.",
    "nussfrei": "Alle Alternativen müssen nussfrei sein.",
    "milder": "Die Alternativen sollen milder im Geschmack sein.",
    "günstiger": "Die Alternativen sollen günstiger sein.",
}


def _coerce_float(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace(",", "."))
        except ValueError:
            return None
    return None


@router.post("/{recipe_id}/ingredients/{ingredient_id}/substitutions")
async def post_substitutions(
    recipe_id: int,
    ingredient_id: int,
    payload: SubstitutionRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Suggest 2-4 realistic German substitutes for one ingredient. Read-only
    inference (any access); the caller decides whether to apply one."""
    rec = await recipe_with_any_access(db, recipe_id, user.id)
    ing = next((i for i in rec.ingredients if i.id == ingredient_id), None)
    if ing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zutat nicht gefunden")

    if ing.quantity is not None:
        qty_line = f"{ing.quantity:g} {ing.unit or ''}".strip()
    else:
        qty_line = ing.unit or "nicht angegeben"
    lines = [
        f"Zutat: {ing.name}",
        f"Menge: {qty_line}",
        f"Im Rezept: {rec.title}",
    ]
    if payload.context:
        lines.append(_SUBSTITUTION_CONTEXT_HINT[payload.context])
    lines.append("Schlage passende Alternativen vor.")

    try:
        parsed = await call_text_json(
            "\n".join(lines), system=_SUBSTITUTION_SYSTEM, temperature=0.3,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)

    # Be forgiving — skip malformed entries instead of failing the whole call.
    subs: list[SubstitutionItem] = []
    raw = parsed.get("substitutions") if isinstance(parsed, dict) else None
    if isinstance(raw, list):
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").strip()
            if not name:
                continue
            unit = entry.get("unit")
            try:
                subs.append(SubstitutionItem(
                    name=name[:255],
                    quantity=_coerce_float(entry.get("quantity")),
                    unit=(str(unit).strip()[:32] if unit else None),
                    rationale=str(entry.get("rationale") or "").strip()[:300],
                ))
            except Exception:
                continue
            if len(subs) >= 4:
                break

    note = None
    if isinstance(parsed, dict) and parsed.get("note"):
        note = str(parsed["note"]).strip()[:500]
    if not subs and not note:
        note = "Für diese Zutat gibt es keine sinnvolle Alternative."
    return ok(SubstitutionResponse(substitutions=subs, note=note).model_dump())


# ---------- AI recipe variants (saved + linked) ----------

_VARIANT_LABELS = {
    "vegan": "vegan",
    "glutenfrei": "glutenfrei",
    "laktosefrei": "laktosefrei",
    "nussfrei": "nussfrei",
    "light": "kalorienreduziert (Light)",
    "schnell": "schnell, unter 30 Minuten",
}
_VARIANT_TAGS = {
    "vegan": "vegan",
    "glutenfrei": "glutenfrei",
    "laktosefrei": "laktosefrei",
    "nussfrei": "nussfrei",
    "light": "light",
    "schnell": "schnell",
}
_VARIANT_BAD = (
    "KI konnte keine sinnvolle Variante erzeugen — bitte erneut versuchen "
    "oder manuell erstellen"
)


async def _fill_variant_nutrition(recipe_id: int, owner_id: int) -> None:
    """Background: run the existing nutrition fill-all on the freshly-saved
    variant so its new ingredients pick up values. Uses its own session — the
    request's session is already closed by the time this runs."""
    from app.core.database import AsyncSessionLocal
    from app.routers.recipes_nutrition import post_nutrition_fill_all
    from app.schemas.recipe import NutritionFillAllRequest

    async with AsyncSessionLocal() as session:
        owner = await session.get(User, owner_id)
        if owner is None:
            return
        try:
            await post_nutrition_fill_all(
                recipe_id=recipe_id,
                payload=NutritionFillAllRequest(mode="fill_empty", use_ai_fallback=False),
                user=owner,
                db=session,
                client_id=None,
            )
        except Exception:
            logger.exception("Background nutrition fill failed for variant %s", recipe_id)


@router.post("/{recipe_id}/variants", status_code=status.HTTP_201_CREATED)
async def post_variant(
    recipe_id: int,
    payload: VariantRequest,
    background: BackgroundTasks,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    """Generate AND save an AI variant linked to the original. Returns the new
    recipe id; the frontend navigates there for review."""
    rec = await recipe_with_any_access(db, recipe_id, user.id)

    if payload.targets:
        wish = (
            "Erstelle eine Variante, die "
            + " und ".join(_VARIANT_LABELS[t] for t in payload.targets)
            + " ist."
        )
    else:
        wish = "Erstelle eine angepasste Variante dieses Rezepts."
    if payload.adjustment and payload.adjustment.strip():
        wish += f" Zusätzlich: {payload.adjustment.strip()}"

    user_prompt = (
        f"Original-Rezept:\n"
        f"Titel: {rec.title}\n"
        f"Portionen: {rec.servings}\n"
        f"Beschreibung: {rec.description or '(keine)'}\n"
        f"Zutaten:\n{_ingredient_lines(rec)}\n"
        f"Schritte:\n{_step_lines(rec)}\n\n"
        f"{wish}\n\n"
        "Behalte Charakter und Stil des Originals bei und ändere nur so viel "
        "wie für das Ziel nötig. Antworte auf Deutsch."
    )
    try:
        parsed = await call_text_json(
            user_prompt, system=_AI_VARIATION_SYSTEM, temperature=0.4,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)

    if isinstance(parsed, dict) and isinstance(parsed.get("steps"), list):
        for i, st in enumerate(parsed["steps"], start=1):
            if isinstance(st, dict):
                st["position"] = i
    try:
        validated = ImportedRecipe.model_validate(parsed)
    except ValidationError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_VARIANT_BAD)
    if not validated.ingredients or not validated.steps:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_VARIANT_BAD)

    target_tags = [_VARIANT_TAGS[t] for t in payload.targets]
    tag_suffix = ", ".join(target_tags) or "Variante"
    title = f"{rec.title} ({tag_suffix})"[:255]
    merged_tags = list(dict.fromkeys([
        *(rec.tags or []),
        *(validated.tags or []),
        *(target_tags or ["variante"]),
    ]))
    ingredients = [
        {"name": i.name, "quantity": i.quantity, "unit": i.unit} for i in validated.ingredients
    ]
    steps = [{"description": s.description} for s in validated.steps]

    new = await create_recipe(
        db,
        user.id,
        title=title,
        ingredients=ingredients,
        steps=steps,
        description=validated.description,
        servings=validated.servings or rec.servings,
        prep_time_minutes=validated.prep_time_minutes,
        cook_time_minutes=validated.cook_time_minutes,
        image_url=rec.image_url,  # inherit the original's image; user can replace
        source_url=None,
        tags=merged_tags,
        parent_recipe_id=rec.id,
        source="ai_variant",
    )
    await emit_recipe_event(db, new.id, "recipe.created", actor_id=user.id, client_id=client_id)
    # Auto-fill nutrition for the new ingredients once the response is sent.
    background.add_task(_fill_variant_nutrition, new.id, user.id)
    return ok({"id": new.id, "title": new.title})


@router.get("/{recipe_id}/variants")
async def get_variants(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """The current user's own variants generated from this recipe."""
    await recipe_with_any_access(db, recipe_id, user.id)
    res = await db.execute(
        select(Recipe)
        .where(Recipe.parent_recipe_id == recipe_id, Recipe.owner_id == user.id)
        .order_by(Recipe.created_at.desc())
    )
    variants = res.scalars().all()
    return ok([VariantOut.model_validate(v).model_dump(mode="json") for v in variants])
