"""Nutrition lookup — Open Food Facts (primary) + Ollama (fallback).

Two entry points:

  search_off(query)
    Hits the OFF search endpoint and returns up to 5 candidates as
    NutritionSearchHit. Respects NUTRITION_LOOKUP_ENABLED, an in-process
    7-day cache, a server-side ~1 req/sec rate gate, and a 4 second
    timeout. On any failure (timeout, HTTP error, JSON parse) returns
    `([], unavailable=True)` — the frontend renders "Aktuell nicht
    erreichbar, KI oder manuell verwenden" instead of an empty state.

  estimate_with_ollama(name, hint=None)
    Local Ollama call via the existing call_text_json helper. System
    prompt clamps the response to the seven per-100g fields, allows
    nulls for "uncertain", and returns a short German note for the
    sheet to surface as italic helper text.

OFF fair-use guidance: send a real User-Agent identifying the app,
cache aggressively, avoid hammering. We honor that with the UA header
below and the cache + rate-gate combo.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.core.config import settings
from app.schemas.recipe import (
    NutritionEstimateResponse,
    NutritionSearchHit,
    NutritionValues,
)
from app.services.ollama import OllamaError, call_text_json

logger = logging.getLogger(__name__)


OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
OFF_USER_AGENT = "Lyst/1.3 (https://github.com/laarsv/Lyst)"
OFF_TIMEOUT_SECONDS = 4.0
OFF_PAGE_SIZE = 5
OFF_FIELDS = (
    "product_name,brands,nutriments,code,image_small_url"
)

# ---------------------------------------------------------------------------
# Cache + rate limit
# ---------------------------------------------------------------------------
#
# In-process only. The home-server deployment is single-process so a
# dict-with-timestamps is sufficient; if we ever scale to multiple
# workers, a Redis-backed cache is the upgrade path (same shape as the
# /ws/* fan-out story in ws_manager).
_CACHE_TTL_SECONDS = 7 * 24 * 3600
_cache: dict[str, tuple[float, list[NutritionSearchHit]]] = {}

# 1 req/sec is what OFF asks for. The lock + last-call timestamp pair
# serializes outgoing requests across concurrent FastAPI handlers.
_MIN_INTERVAL_SECONDS = 1.0
_rate_lock = asyncio.Lock()
_last_call_at: float = 0.0


def _cache_key(query: str) -> str:
    return " ".join(query.lower().split())


def _cache_get(query: str) -> list[NutritionSearchHit] | None:
    key = _cache_key(query)
    entry = _cache.get(key)
    if not entry:
        return None
    expires_at, hits = entry
    if time.monotonic() > expires_at:
        _cache.pop(key, None)
        return None
    return hits


def _cache_put(query: str, hits: list[NutritionSearchHit]) -> None:
    _cache[_cache_key(query)] = (
        time.monotonic() + _CACHE_TTL_SECONDS,
        hits,
    )


async def _rate_gate() -> None:
    """Block until at least _MIN_INTERVAL_SECONDS have passed since
    the last outgoing OFF request, then mark this moment as 'now'."""
    global _last_call_at
    async with _rate_lock:
        delta = time.monotonic() - _last_call_at
        if delta < _MIN_INTERVAL_SECONDS:
            await asyncio.sleep(_MIN_INTERVAL_SECONDS - delta)
        _last_call_at = time.monotonic()


# ---------------------------------------------------------------------------
# OFF parsing
# ---------------------------------------------------------------------------

def _coerce_float(value: Any) -> float | None:
    """OFF returns numeric nutriments as either numbers or strings.
    Strings sometimes carry a trailing ',' (locale) — be lenient."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, str):
            value = value.replace(",", ".").strip()
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f < 0:
        return None
    return f


def _hit_from_off_product(product: dict[str, Any]) -> NutritionSearchHit | None:
    """Turn a raw OFF product dict into a NutritionSearchHit, skipping
    rows that don't have a name or any usable nutriment."""
    name = (product.get("product_name") or "").strip()
    code = (product.get("code") or "").strip()
    if not name or not code:
        return None

    nutriments = product.get("nutriments") or {}
    # OFF uses energy-kcal_100g for kcal; energy_100g is kJ. Prefer kcal.
    calories = _coerce_float(nutriments.get("energy-kcal_100g"))
    if calories is None:
        kj = _coerce_float(nutriments.get("energy_100g"))
        if kj is not None:
            calories = round(kj / 4.184, 1)

    values = NutritionValues(
        calories_per_100g=calories,
        protein_per_100g=_coerce_float(nutriments.get("proteins_100g")),
        carbs_per_100g=_coerce_float(nutriments.get("carbohydrates_100g")),
        fat_per_100g=_coerce_float(nutriments.get("fat_100g")),
        fiber_per_100g=_coerce_float(nutriments.get("fiber_100g")),
        sugar_per_100g=_coerce_float(nutriments.get("sugars_100g")),
        salt_per_100g=_coerce_float(nutriments.get("salt_100g")),
    )
    # Drop products that carry no usable nutriment at all — they'd
    # just clutter the candidate list with picks that fill nothing.
    if all(getattr(values, f) is None for f in values.model_fields):
        return None

    brand = (product.get("brands") or "").split(",")[0].strip() or None
    image_url = product.get("image_small_url") or None

    return NutritionSearchHit(
        name=name,
        brand=brand,
        code=code,
        image_url=image_url,
        nutrition=values,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def search_off(query: str) -> tuple[list[NutritionSearchHit], bool]:
    """Returns (hits, unavailable). `unavailable` is True iff the
    lookup is disabled by config OR the OFF call failed/timed out —
    distinct from "search succeeded but matched nothing" which yields
    ([], False)."""
    query = query.strip()
    if not query:
        return [], False
    if not settings.NUTRITION_LOOKUP_ENABLED:
        return [], True

    cached = _cache_get(query)
    if cached is not None:
        return cached, False

    await _rate_gate()
    params = {
        "search_terms": query,
        "search_simple": "1",
        "action": "process",
        "json": "1",
        "page_size": str(OFF_PAGE_SIZE),
        "fields": OFF_FIELDS,
        "lc": "de",
    }
    try:
        async with httpx.AsyncClient(
            timeout=OFF_TIMEOUT_SECONDS,
            headers={"User-Agent": OFF_USER_AGENT, "Accept": "application/json"},
        ) as client:
            r = await client.get(OFF_SEARCH_URL, params=params)
            r.raise_for_status()
            data = r.json()
    except httpx.TimeoutException:
        logger.info("OFF search timed out for %r", query)
        return [], True
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("OFF search failed for %r: %s", query, e)
        return [], True

    products = data.get("products") or []
    hits: list[NutritionSearchHit] = []
    for p in products:
        hit = _hit_from_off_product(p)
        if hit is not None:
            hits.append(hit)
        if len(hits) >= OFF_PAGE_SIZE:
            break
    _cache_put(query, hits)
    return hits, False


async def search_off_for_each(
    queries: list[str], *, concurrency: int = 3
) -> dict[str, NutritionSearchHit | None]:
    """Batch helper used by the AI recipe importer: returns the top hit
    (or None) per ingredient name. Bounded concurrency keeps us within
    the rate gate's effective ceiling without blocking the whole import
    behind serial calls."""
    sem = asyncio.Semaphore(concurrency)

    async def one(q: str) -> tuple[str, NutritionSearchHit | None]:
        async with sem:
            hits, _ = await search_off(q)
            return q, (hits[0] if hits else None)

    results = await asyncio.gather(*(one(q) for q in queries))
    return dict(results)


# ---------------------------------------------------------------------------
# Ollama fallback
# ---------------------------------------------------------------------------

_ESTIMATE_SYSTEM = """Du bist eine Nährwert-Datenbank. Der Nutzer nennt eine Zutat. Schätze plausibel die Nährwerte pro 100 g.

Antworte ausschließlich mit einem JSON-Objekt mit genau diesen Feldern:
{
  "calories_per_100g": number | null,
  "protein_per_100g":  number | null,
  "carbs_per_100g":    number | null,
  "fat_per_100g":      number | null,
  "fiber_per_100g":    number | null,
  "sugar_per_100g":    number | null,
  "salt_per_100g":     number | null,
  "note":              string | null
}

Regeln:
- Werte plausibel und realistisch (z. B. Brot ≈ 250 kcal, nicht 9000).
- Bei Unsicherheit lieber null als einen unplausiblen Wert.
- `note` darf kurz erläutern (z. B. "auf Basis von durchschnittlichem Vollkornbrot").
- Kein Fließtext, keine Markdown-Codefences, nur das JSON."""


async def estimate_with_ollama(
    name: str, hint: str | None = None
) -> NutritionEstimateResponse:
    """Ask the local model for a per-100g estimate. Always returns a
    response — even on parse failure we surface an empty
    NutritionValues + a note rather than 500'ing, so the user can
    still fall back to manual entry from the same sheet."""
    prompt_parts = [f"Zutat: {name.strip()}"]
    if hint:
        prompt_parts.append(f"Kontext: {hint.strip()}")
    prompt = "\n".join(prompt_parts)

    try:
        raw = await call_text_json(prompt, system=_ESTIMATE_SYSTEM, temperature=0.2)
    except OllamaError as e:
        logger.warning("Ollama nutrition estimate failed: %s", e.message)
        return NutritionEstimateResponse(
            nutrition=NutritionValues(),
            note="KI-Schätzung gerade nicht erreichbar.",
        )

    if not isinstance(raw, dict):
        return NutritionEstimateResponse(
            nutrition=NutritionValues(),
            note="KI-Antwort hatte ein unerwartetes Format.",
        )

    values = NutritionValues(
        calories_per_100g=_coerce_float(raw.get("calories_per_100g")),
        protein_per_100g=_coerce_float(raw.get("protein_per_100g")),
        carbs_per_100g=_coerce_float(raw.get("carbs_per_100g")),
        fat_per_100g=_coerce_float(raw.get("fat_per_100g")),
        fiber_per_100g=_coerce_float(raw.get("fiber_per_100g")),
        sugar_per_100g=_coerce_float(raw.get("sugar_per_100g")),
        salt_per_100g=_coerce_float(raw.get("salt_per_100g")),
    )
    note = raw.get("note")
    if note is not None and not isinstance(note, str):
        note = None
    return NutritionEstimateResponse(nutrition=values, note=note)
