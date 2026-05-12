"""Ollama-powered shopping-item categorizer.

Used asynchronously after item creation on SHOPPING-type lists. The
returned category is one of CATEGORIES (or "Sonstiges" as the fallback);
unrecognised replies are silently coerced. If Ollama is unreachable the
caller should leave the item's category null — the UI handles that
("Wird kategorisiert…").
"""
from __future__ import annotations

import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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
    "Ordne dieses Einkaufs-Item einer Kategorie zu. Antworte NUR mit einer "
    "dieser Kategorien (genau so geschrieben): "
    + ", ".join(CATEGORIES)
)


async def categorize_item(db: AsyncSession, text: str) -> str | None:
    """Return one of CATEGORIES, or None if Ollama is unreachable."""
    cleaned = (text or "").strip()
    if not cleaned:
        return DEFAULT_CATEGORY
    model = await get_ollama_model(db)
    body = {
        "model": model,
        "system": SYSTEM_PROMPT,
        "prompt": cleaned,
        "stream": False,
        "options": {"temperature": 0.0, "num_predict": 24},
    }
    try:
        # Short timeout — we don't want a slow Ollama to block the worker
        # for minutes per item; 30 s is plenty for a one-word response.
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(f"{settings.OLLAMA_BASE_URL}/api/generate", json=body)
            r.raise_for_status()
            raw = (r.json().get("response") or "").strip()
    except httpx.HTTPError as e:
        logger.info("Ollama categorization failed for %r: %s", cleaned, e)
        return None
    return _normalize(raw)


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
