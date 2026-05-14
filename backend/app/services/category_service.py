"""Ollama-powered shopping-item categorizer.

Used asynchronously after item creation on SHOPPING-type lists. The
returned category is one of CATEGORIES (or "Sonstiges" as the fallback);
unrecognised replies are silently coerced. If Ollama is unreachable the
caller should leave the item's category null — the UI handles that
("Wird kategorisiert…").

Output contract: the model returns `{"category": "<one of CATEGORIES>"}`.
Going through `format: "json"` (constraint at sampling time) is way more
reliable than "respond with one word" prose prompts on small models.
The `_normalize` fallback still runs against the parsed string — handles
the rare case where the model invents a near-but-not-quite category name.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ollama import OllamaError, call_text_json
from app.services.settings_service import get_ollama_model

logger = logging.getLogger(__name__)

CATEGORIES: list[str] = [
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
CATEGORIES_SET = set(CATEGORIES)
DEFAULT_CATEGORY = "Sonstiges"

SYSTEM_PROMPT = (
    "Du ordnest ein Einkaufs-Item einer von 10 festen Kategorien zu. "
    "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt: "
    '{"category": "<eine Kategorie>"}. '
    "Erlaubte Kategorien (genau so geschrieben): "
    + ", ".join(CATEGORIES)
)


async def categorize_item(db: AsyncSession, text: str) -> str | None:
    """Return one of CATEGORIES, or None if Ollama is unreachable.

    Parse failures (after the one retry baked into call_text_json) also
    return None — the UI shows "Wird kategorisiert…" until the next
    successful run."""
    cleaned = (text or "").strip()
    if not cleaned:
        return DEFAULT_CATEGORY
    model = await get_ollama_model(db)
    try:
        # Short timeout — we don't want a slow Ollama to block the worker
        # for minutes per item; 30 s is plenty for a one-word response on
        # an already-loaded model (which it is, thanks to keep_alive=-1).
        parsed = await call_text_json(
            cleaned,
            system=SYSTEM_PROMPT,
            model=model,
            temperature=0.0,
            max_tokens=64,
            timeout=30.0,
        )
    except OllamaError as e:
        logger.info("Ollama categorization failed for %r: %s", cleaned, e.message)
        return None

    raw_value = ""
    if isinstance(parsed, dict):
        raw_value = str(parsed.get("category") or "").strip()
    elif isinstance(parsed, str):
        raw_value = parsed.strip()
    return _normalize(raw_value)


def _normalize(raw: str) -> str:
    """Coerce the model's reply into one of the known categories."""
    if not raw:
        return DEFAULT_CATEGORY
    # Try exact match first
    for line in raw.splitlines():
        line = line.strip().strip("`'\"-• ")
        if line in CATEGORIES_SET:
            return line
    # Then case-insensitive contains
    lower = raw.lower()
    for cat in CATEGORIES:
        if cat.lower() in lower:
            return cat
    return DEFAULT_CATEGORY
