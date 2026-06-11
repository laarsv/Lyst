"""Consolidate several recipes into one aisle-sorted shopping list.

Groups ingredients across recipes by normalised name (reusing
`ingredient_translations.normalize` — case-insensitive, plural/hyphen-tolerant),
sums quantities that share a unit, keeps mismatched units as separate sub-lines,
and tags each item with a supermarket aisle from `aisle_map`. The created
`ListItem`s carry `category=<aisle>` so the existing CategoryGroupedList renders
the sections instantly (no Ollama call).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.aisle_map import AISLE_ORDER, aisle_for
from app.data.ingredient_translations import normalize
from app.models.list import CategorizationMode, List as ListModel, ListType
from app.models.list_item import ListItem
from app.models.recipe import Recipe


@dataclass
class SubQuantity:
    quantity: float | None
    unit: str | None


@dataclass
class ConsolidatedItem:
    name: str  # first-seen display name
    aisle: str
    lines: list[SubQuantity]
    recipes: list[str]  # contributing recipe titles (provenance, first-seen order)


# Canonicalise unit spellings so "Stück"/"Stk"/"stk." sum together, while
# genuinely different units (g vs kg vs Stk) stay on separate lines — matching
# the spec's "sum when units match, otherwise keep both".
_UNIT_ALIASES = {
    "g": "g", "gr": "g", "gramm": "g",
    "kg": "kg", "kilo": "kg", "kilogramm": "kg",
    "mg": "mg",
    "ml": "ml", "milliliter": "ml",
    "l": "l", "liter": "l",
    "el": "el", "esslöffel": "el", "essloeffel": "el",
    "tl": "tl", "teelöffel": "tl", "teeloeffel": "tl",
    "stk": "stk", "st": "stk", "stück": "stk", "stueck": "stk",
    "prise": "prise", "prisen": "prise",
    "dose": "dose", "dosen": "dose",
    "packung": "packung", "päckchen": "packung", "paeckchen": "packung", "pkg": "packung",
    "bund": "bund",
    "zehe": "zehe", "zehen": "zehe",
    "scheibe": "scheibe", "scheiben": "scheibe",
    "becher": "becher", "tasse": "tasse", "tassen": "tasse",
}


def _unit_key(unit: str | None) -> str:
    if not unit:
        return ""
    u = unit.strip().lower().rstrip(".")
    return _UNIT_ALIASES.get(u, u)


# Plural folding for the GROUPING key — `normalize()` keeps plurals ("zwiebeln"),
# so without this "Zwiebeln" and "Zwiebel" would land in separate groups.
# NB: no "nen" — it over-strips "-ne" nouns ("Bananen" -> "bana") so they'd no
# longer match their singular ("Banane" -> "banan"); "en" folds both to "banan".
_PLURAL_ENDINGS = ("en", "er", "n", "e", "s")


def _singular(word: str) -> str:
    for suf in _PLURAL_ENDINGS:
        if word.endswith(suf) and len(word) - len(suf) >= 3:
            return word[: -len(suf)]
    return word


def _merge_key(name: str) -> str:
    """Normalised, plural-folded grouping key. Singularises the core (last)
    token so "Zwiebeln" / "Zwiebel" / "frische Zwiebeln" collapse together."""
    norm = normalize(name)
    if not norm:
        return name.strip().lower()
    tokens = norm.split(" ")
    tokens[-1] = _singular(tokens[-1])
    return " ".join(tokens)


# Mirror of recipe_service._scale_quantity — kept local (not imported) so this
# service doesn't pull recipe_service's config/qrcode dependency chain for a
# trivial helper. Keep the rounding rule in sync if it ever changes there.
def _scale(qty: float | None, factor: float) -> float | None:
    if qty is None:
        return None
    return round(qty * factor, 2)


@dataclass
class _Group:
    name: str
    aisle: str
    recipes: list[str] = field(default_factory=list)
    # unit_key -> [summed_qty_or_None, display_unit, any_qty_seen]
    units: dict[str, list] = field(default_factory=dict)
    unit_order: list[str] = field(default_factory=list)


def consolidate(recipe_servings: list[tuple[Recipe, int]]) -> list[ConsolidatedItem]:
    """Build the merged item list, sorted by aisle (supermarket walk) then name.
    Each recipe's quantities are first scaled by `servings / recipe.servings`."""
    groups: dict[str, _Group] = {}
    order: list[str] = []

    for rec, servings in recipe_servings:
        factor = servings / rec.servings if rec.servings else 1.0
        for ing in rec.ingredients:
            key = _merge_key(ing.name)
            g = groups.get(key)
            if g is None:
                g = _Group(name=ing.name.strip(), aisle=aisle_for(ing.name))
                groups[key] = g
                order.append(key)
            if rec.title not in g.recipes:
                g.recipes.append(rec.title)

            ukey = _unit_key(ing.unit)
            qty = _scale(ing.quantity, factor)
            slot = g.units.get(ukey)
            if slot is None:
                slot = [None, ing.unit, False]  # [qty_sum, display_unit, any_qty]
                g.units[ukey] = slot
                g.unit_order.append(ukey)
            if qty is not None:
                slot[0] = (slot[0] or 0.0) + qty
                slot[2] = True

    items: list[ConsolidatedItem] = []
    for key in order:
        g = groups[key]
        lines = [
            SubQuantity(
                quantity=round(slot[0], 2) if slot[0] is not None else None,
                unit=slot[1],
            )
            for slot in (g.units[uk] for uk in g.unit_order)
        ]
        items.append(ConsolidatedItem(name=g.name, aisle=g.aisle, lines=lines, recipes=g.recipes))

    aisle_rank = {a: i for i, a in enumerate(AISLE_ORDER)}
    items.sort(key=lambda it: (aisle_rank.get(it.aisle, len(AISLE_ORDER)), it.name.lower()))
    return items


async def merge_to_list(
    db: AsyncSession,
    owner_id: int,
    items: list[ConsolidatedItem],
    *,
    list_id: int | None,
    new_list_title: str | None,
) -> tuple[ListModel, int]:
    """Create the consolidated items on a target shopping list (existing or new).
    Each sub-line (distinct unit) becomes its own `ListItem`, tagged with its
    aisle in `category`. Returns (list, items_added)."""
    if not items:
        raise ValueError("No ingredients to merge")

    if list_id is None:
        title = (new_list_title or "").strip() or "Einkaufsliste"
        target = ListModel(
            owner_id=owner_id,
            title=title,
            type=ListType.SHOPPING,
            icon="🛒",
            color="#10b981",
            # MANUAL (not OFF) so the existing grouped view renders the aisle
            # sections from persisted state — no item-content sniffing needed.
            categorization_mode=CategorizationMode.MANUAL,
        )
        db.add(target)
        await db.flush()
    else:
        result = await db.execute(
            select(ListModel).where(ListModel.id == list_id, ListModel.owner_id == owner_id)
        )
        target = result.scalar_one_or_none()
        if not target:
            raise ValueError("Target list not found")

    pos = (
        await db.execute(
            select(func.coalesce(func.max(ListItem.position), -1) + 1).where(
                ListItem.list_id == target.id
            )
        )
    ).scalar_one()

    added = 0
    for it in items:
        for line in it.lines:
            db.add(ListItem(
                list_id=target.id,
                text=it.name,
                quantity=line.quantity,
                unit=line.unit,
                category=it.aisle,
                position=pos,
                is_checked=False,
            ))
            pos += 1
            added += 1

    await db.commit()
    await db.refresh(target)
    return target, added
