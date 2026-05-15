"""Ollama-powered list-item categorizer.

The category set and prompt branch on the list's `ListType`. SHOPPING and
PACKING each carry their own fixed taxonomy + system prompt; CHECKLIST
and CUSTOM lists deliberately return None — the AI list generator
pre-fills CHECKLIST categories at creation time and CUSTOM lists have
no categorization by spec.

Output contract: the model returns `{"category": "<one of CATEGORIES>"}`.
Going through `format: "json"` (constraint at sampling time) is way more
reliable than "respond with one word" prose prompts on small models.
The `_normalize` fallback still runs against the parsed string — handles
the rare case where the model invents a near-but-not-quite category name.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.list import ListType
from app.services.ollama import OllamaError, call_text_json
from app.services.settings_service import get_ollama_model

logger = logging.getLogger(__name__)


# Shopping: groceries, drugstore goods, household basics. Order is the
# display order in the grouped view.
CATEGORIES_SHOPPING: list[str] = [
    "Obst & Gemüse",
    "Milchprodukte",
    "Tiefkühl",
    "Backwaren",
    "Fleisch & Fisch",
    "Getränke",
    "Trockenwaren",
    "Süßes",
    "Hygiene",
    "Sonstiges",
]

# Packing: travel + outdoor staples. Granularity tuned so a typical pack
# list (hiking trip, weekend away) yields multiple non-empty buckets
# instead of dumping everything into "Sonstiges".
CATEGORIES_PACKING: list[str] = [
    "Kleidung",
    "Schuhe",
    "Hygiene & Pflege",
    "Elektronik",
    "Dokumente",
    "Medikamente",
    "Sport & Freizeit",
    "Reiseausstattung",
    "Sonstiges",
]

DEFAULT_CATEGORY = "Sonstiges"


# Legacy export: some call sites still import the bare `CATEGORIES`. Keep
# it pointing at the shopping set so old code keeps working — it's now
# an alias rather than the source of truth.
CATEGORIES = CATEGORIES_SHOPPING


def categories_for_type(list_type: ListType | None) -> list[str] | None:
    """Return the fixed category set for the given list type, or None if
    the type has no categorization (CHECKLIST: dynamic via AI generator;
    CUSTOM: no categories at all)."""
    if list_type == ListType.SHOPPING:
        return CATEGORIES_SHOPPING
    if list_type == ListType.PACKING:
        return CATEGORIES_PACKING
    return None


def _system_prompt(list_type: ListType, categories: list[str]) -> str:
    if list_type == ListType.PACKING:
        return (
            "Du ordnest einen Eintrag auf einer Pack- oder Reiseliste einer "
            "von festen Kategorien zu. Antworte AUSSCHLIESSLICH mit einem "
            'JSON-Objekt: {"category": "<eine Kategorie>"}. '
            "Erlaubte Kategorien (genau so geschrieben): "
            + ", ".join(categories)
            + ". Hinweise: Kleidungsstücke (T-Shirt, Pulli, Hose) gehören "
            "in 'Kleidung'; Sneaker/Wanderschuhe in 'Schuhe'; Zahnbürste, "
            "Shampoo, Sonnencreme in 'Hygiene & Pflege'; Ladekabel, "
            "Handy, Powerbank in 'Elektronik'; Pass, Tickets, Versicherung "
            "in 'Dokumente'; Tabletten in 'Medikamente'; Wanderstöcke, "
            "Badeanzug, Buch in 'Sport & Freizeit'; Rucksack, Adapter, "
            "Schlafsack in 'Reiseausstattung'."
        )
    # Default: shopping copy (unchanged wording).
    return (
        "Du ordnest ein Einkaufs-Item einer von 10 festen Kategorien zu. "
        "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt: "
        '{"category": "<eine Kategorie>"}. '
        "Erlaubte Kategorien (genau so geschrieben): "
        + ", ".join(categories)
    )


async def categorize_item(
    db: AsyncSession,
    text: str,
    list_type: ListType | None = None,
) -> str | None:
    """Return one of the type-appropriate categories, or None if:
       - Ollama is unreachable
       - the list type has no fixed category set (CHECKLIST, CUSTOM)
       - the model's reply couldn't be parsed after one retry

    The caller leaves item.category as null when None is returned; the UI
    renders that as "Wird kategorisiert…".

    `list_type` defaults to SHOPPING for backwards compatibility with any
    older call sites that haven't been updated yet — but new code should
    pass it explicitly.
    """
    effective_type = list_type if list_type is not None else ListType.SHOPPING
    categories = categories_for_type(effective_type)
    if categories is None:
        # CHECKLIST / CUSTOM: no fixed taxonomy. Skip the round-trip
        # entirely so the item stays uncategorized until the user picks
        # one manually (CHECKLIST) or never (CUSTOM).
        return None

    cleaned = (text or "").strip()
    if not cleaned:
        return DEFAULT_CATEGORY

    model = await get_ollama_model(db)
    system_prompt = _system_prompt(effective_type, categories)
    try:
        # Short timeout — we don't want a slow Ollama to block the worker
        # for minutes per item; 30 s is plenty for a one-word response on
        # an already-loaded model (which it is, thanks to keep_alive=-1).
        parsed = await call_text_json(
            cleaned,
            system=system_prompt,
            model=model,
            temperature=0.0,
            max_tokens=64,
            timeout=30.0,
        )
    except OllamaError as e:
        logger.info(
            "Ollama categorization failed for %r (type=%s): %s",
            cleaned,
            effective_type.value,
            e.message,
        )
        return None

    raw_value = ""
    if isinstance(parsed, dict):
        raw_value = str(parsed.get("category") or "").strip()
    elif isinstance(parsed, str):
        raw_value = parsed.strip()
    return _normalize(raw_value, categories)


def _normalize(raw: str, categories: list[str]) -> str:
    """Coerce the model's reply into one of the known categories for this
    list type. Falls back to 'Sonstiges' (always present in both fixed
    sets) when the reply can't be matched."""
    if not raw:
        return DEFAULT_CATEGORY
    category_set = set(categories)
    # Try exact match first
    for line in raw.splitlines():
        line = line.strip().strip("`'\"-• ")
        if line in category_set:
            return line
    # Then case-insensitive contains
    lower = raw.lower()
    for cat in categories:
        if cat.lower() in lower:
            return cat
    return DEFAULT_CATEGORY
