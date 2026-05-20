"""Nutrition lookup — USDA FoodData Central + Open Food Facts + Ollama.

Three entry points:

  search_combined(query)
    The grouped search the Nährwerte sheet calls. Fans out concurrently
    to USDA (raw cooking ingredients, English-only — fed via the static
    German→English translation table in app.data.ingredient_translations)
    and to OFF (branded packaged products, German-native). Returns two
    groups, USDA first ("Lebensmittel") then OFF ("Markenprodukte"),
    with each group re-ranked so shorter / closer name matches beat
    long marketing titles ("Avocado" beats "100% Pure Avocado Oil Spray").

  search_for_each(queries)
    Batch helper used by the AI recipe importer. Per ingredient, tries
    USDA first; falls back to OFF on a miss. Returns one
    NutritionSearchHit (or None) per name with `source` flagged so the
    importer can stamp the right enum on the ingredient row.

  estimate_with_ollama(name, hint=None)
    Local Ollama estimate — unchanged from v1.3.

Fair-use:
  - OFF asks for a real User-Agent and ~1 req/sec — we honor both.
  - USDA asks for an API key (free) but has no public req/sec gate
    other than the daily quota; we still serialise through our own
    per-second gate to stay polite and avoid bursting during recipe
    import.
Each upstream has its own rate gate + the search-level cache covers
the merged result, so a re-search inside 7d hits memory regardless.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.core.config import settings
from app.data.ingredient_translations import normalize, translate
from app.schemas.recipe import (
    NutritionEstimateResponse,
    NutritionSearchGroup,
    NutritionSearchHit,
    NutritionValues,
)
from app.services.ollama import OllamaError, call_text_json

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Open Food Facts
# ---------------------------------------------------------------------------
OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
OFF_USER_AGENT = "Lyst/1.4 (https://github.com/laarsv/Lyst)"
OFF_TIMEOUT_SECONDS = 4.0
OFF_PAGE_SIZE = 5
OFF_FIELDS = "product_name,brands,nutriments,code,image_small_url"


# ---------------------------------------------------------------------------
# USDA FoodData Central
# ---------------------------------------------------------------------------
USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
USDA_TIMEOUT_SECONDS = 4.0
USDA_PAGE_SIZE = 5
# Foundation = the curated, lab-analyzed dataset; SR Legacy = the older
# USDA Standard Reference set. Both are raw-ingredient focused and
# nutrient-complete. Excluded on purpose:
#   - "Branded": USDA's own barcode set — duplicates OFF, noisier.
#   - "Survey (FNDDS)": mixed dishes ("chicken stir-fry, with rice"),
#     not what cookbook authors mean by "Chicken breast".
USDA_DATA_TYPES = "Foundation,SR Legacy"


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
#
# Caches the merged (USDA + OFF) result. Single-process so a dict is
# enough; if we ever multi-process, Redis is the next step.
_CACHE_TTL_SECONDS = 7 * 24 * 3600
_cache: dict[str, tuple[float, list[NutritionSearchGroup], bool]] = {}


def _cache_key(query: str) -> str:
    return " ".join(query.lower().split())


def _cache_get(query: str) -> tuple[list[NutritionSearchGroup], bool] | None:
    key = _cache_key(query)
    entry = _cache.get(key)
    if not entry:
        return None
    expires_at, groups, unavailable = entry
    if time.monotonic() > expires_at:
        _cache.pop(key, None)
        return None
    return groups, unavailable


def _cache_put(
    query: str, groups: list[NutritionSearchGroup], unavailable: bool
) -> None:
    _cache[_cache_key(query)] = (
        time.monotonic() + _CACHE_TTL_SECONDS,
        groups,
        unavailable,
    )


# ---------------------------------------------------------------------------
# Per-upstream rate gates
# ---------------------------------------------------------------------------
#
# Separate gates so an OFF call doesn't starve USDA (and vice versa).
# 1 req/sec each. The lock + last-call timestamp pair serialises
# outgoing requests across concurrent FastAPI handlers per service.
_MIN_INTERVAL_SECONDS = 1.0


class _RateGate:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._last = 0.0

    async def wait(self) -> None:
        async with self._lock:
            delta = time.monotonic() - self._last
            if delta < _MIN_INTERVAL_SECONDS:
                await asyncio.sleep(_MIN_INTERVAL_SECONDS - delta)
            self._last = time.monotonic()


_off_gate = _RateGate()
_usda_gate = _RateGate()


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _coerce_float(value: Any) -> float | None:
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


def _has_any_nutrition(values: NutritionValues) -> bool:
    return any(getattr(values, f) is not None for f in values.model_fields)


def _rerank(hits: list[NutritionSearchHit], query: str) -> list[NutritionSearchHit]:
    """Re-rank a group so short / close name matches bubble up.

    OFF's default sort surfaces verbose marketing titles ("100% Pure
    Avocado Oil Spray" before plain "Avocado"). USDA tends to do the
    right thing already but a re-rank costs nothing and keeps both
    groups consistent. Sort key:
      1. exact normalised match of the query first
      2. then by whether the query is a whole-word prefix
      3. then by ascending length of the product name
    Within ties we preserve upstream order (Python's sort is stable).
    """
    q = " ".join(query.lower().split())
    if not q:
        return hits

    def score(hit: NutritionSearchHit) -> tuple[int, int, int]:
        name = hit.name.lower()
        if name == q:
            return (0, 0, len(name))
        if name.startswith(q + " ") or f" {q} " in f" {name} ":
            return (1, 0, len(name))
        if q in name:
            return (2, 0, len(name))
        return (3, 0, len(name))

    return sorted(hits, key=score)


# ---------------------------------------------------------------------------
# OFF parsing
# ---------------------------------------------------------------------------

def _hit_from_off_product(product: dict[str, Any]) -> NutritionSearchHit | None:
    name = (product.get("product_name") or "").strip()
    code = (product.get("code") or "").strip()
    if not name or not code:
        return None

    nutriments = product.get("nutriments") or {}
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
    if not _has_any_nutrition(values):
        return None

    brand = (product.get("brands") or "").split(",")[0].strip() or None
    image_url = product.get("image_small_url") or None

    return NutritionSearchHit(
        name=name,
        brand=brand,
        code=code,
        image_url=image_url,
        nutrition=values,
        fdc_id=None,
    )


# ---------------------------------------------------------------------------
# USDA parsing
# ---------------------------------------------------------------------------
#
# USDA's foodNutrients array carries nutrients by both `nutrientId`
# (integer, stable across releases) and `nutrientName` (string, more
# human-readable but capitalisation drifts). We key on nutrientId
# primarily, with a name-based fallback for older entries.
#
# IDs:
#   1008 — Energy (kcal)            → calories_per_100g
#   1003 — Protein                  → protein_per_100g
#   1004 — Total lipid (fat)        → fat_per_100g
#   1005 — Carbohydrate, by diff    → carbs_per_100g
#   1079 — Fiber, total dietary     → fiber_per_100g
#   2000 — Sugars, total            → sugar_per_100g
#   1093 — Sodium                   → salt_per_100g (after conversion)
#
# The legacy (Foundation pre-2019) "number" attribute also matches:
#   208 / 203 / 204 / 205 / 291 / 269 / 307 respectively. Handled in
# the fallback table below.

_USDA_NUTRIENT_FIELDS = {
    1008: "calories_per_100g",  # Energy (kcal)
    1003: "protein_per_100g",
    1004: "fat_per_100g",
    1005: "carbs_per_100g",
    1079: "fiber_per_100g",
    2000: "sugar_per_100g",
    1093: "sodium_mg",            # converted to salt below
    # Legacy "number"-style IDs used by some SR Legacy rows.
    208: "calories_per_100g",
    203: "protein_per_100g",
    204: "fat_per_100g",
    205: "carbs_per_100g",
    291: "fiber_per_100g",
    269: "sugar_per_100g",
    307: "sodium_mg",
}


def _hit_from_usda_food(food: dict[str, Any]) -> NutritionSearchHit | None:
    """Parse one USDA /foods/search result row.

    Foundation + SR Legacy rows are nutrient-dense per 100 g of the food
    "as packed" — no per-serving adjustment needed. We verify that by
    sticking to those two dataTypes in the request.
    """
    name = (food.get("description") or "").strip()
    fdc_id = food.get("fdcId")
    if not name or fdc_id is None:
        return None

    collected: dict[str, float | None] = {
        "calories_per_100g": None,
        "protein_per_100g": None,
        "carbs_per_100g": None,
        "fat_per_100g": None,
        "fiber_per_100g": None,
        "sugar_per_100g": None,
        "sodium_mg": None,
    }
    for nut in food.get("foodNutrients") or []:
        # USDA's search response uses two shapes:
        #   - {"nutrientId": int, "value": float, ...}  (modern)
        #   - {"nutrient": {"id": int, "number": "208"}, "amount": float}
        #     (Foundation v2)
        nid = nut.get("nutrientId")
        value = nut.get("value")
        if nid is None:
            nested = nut.get("nutrient") or {}
            nid = nested.get("id")
            if value is None:
                value = nut.get("amount")
            if nid is None:
                num = nested.get("number")
                if isinstance(num, str) and num.isdigit():
                    nid = int(num)
        if nid is None:
            continue
        field = _USDA_NUTRIENT_FIELDS.get(int(nid))
        if field is None:
            continue
        v = _coerce_float(value)
        if v is None:
            continue
        # First non-null wins — duplicates exist for some Foundation rows
        # (one canonical, one calculated). The first usually IS the
        # canonical one in USDA's ordering.
        if collected[field] is None:
            collected[field] = v

    # Sodium → salt. USDA sodium is in mg per 100 g; salt (NaCl) in g
    # is sodium(mg) * 2.5 / 1000. The 2.5 factor is the molar-mass
    # ratio of NaCl to Na (58.44 / 22.99 ≈ 2.542); rounded to 2.5 is
    # the standard food-labelling convention used by EU regulation
    # 1169/2011 and by Open Food Facts itself.
    sodium_mg = collected.pop("sodium_mg")
    salt_g: float | None = None
    if sodium_mg is not None:
        salt_g = round(sodium_mg * 2.5 / 1000.0, 3)

    values = NutritionValues(
        calories_per_100g=collected["calories_per_100g"],
        protein_per_100g=collected["protein_per_100g"],
        carbs_per_100g=collected["carbs_per_100g"],
        fat_per_100g=collected["fat_per_100g"],
        fiber_per_100g=collected["fiber_per_100g"],
        sugar_per_100g=collected["sugar_per_100g"],
        salt_per_100g=salt_g,
    )
    if not _has_any_nutrition(values):
        return None

    return NutritionSearchHit(
        name=name,
        brand=None,
        code="",  # USDA rows aren't barcoded; persisted to usda_fdc_id below
        image_url=None,
        nutrition=values,
        fdc_id=str(fdc_id),
    )


# ---------------------------------------------------------------------------
# Upstream fetchers
# ---------------------------------------------------------------------------

async def _fetch_off(query: str) -> tuple[list[NutritionSearchHit], bool]:
    """Returns (hits, unavailable). unavailable=True means the call
    failed; an empty list with unavailable=False is "OFF said no
    products matched"."""
    await _off_gate.wait()
    # sort_by=popularity_key puts widely-scanned (and therefore well-
    # known) products at the top. The legacy default mixes obscure
    # niche items in early which is exactly what we want to push DOWN.
    params = {
        "search_terms": query,
        "search_simple": "1",
        "action": "process",
        "json": "1",
        "page_size": str(OFF_PAGE_SIZE),
        "fields": OFF_FIELDS,
        "lc": "de",
        "sort_by": "popularity_key",
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

    hits: list[NutritionSearchHit] = []
    for p in data.get("products") or []:
        hit = _hit_from_off_product(p)
        if hit is not None:
            hits.append(hit)
        if len(hits) >= OFF_PAGE_SIZE:
            break
    return hits, False


async def _fetch_usda(query: str) -> tuple[list[NutritionSearchHit], bool]:
    """Returns (hits, unavailable). Without an API key USDA is skipped
    silently — empty list, unavailable=False — so the rest of the
    lookup pipeline keeps working in a key-less dev setup."""
    if not settings.FDC_API_KEY:
        return [], False
    await _usda_gate.wait()
    params = {
        "query": query,
        "dataType": USDA_DATA_TYPES,
        "pageSize": str(USDA_PAGE_SIZE),
        "api_key": settings.FDC_API_KEY,
    }
    try:
        async with httpx.AsyncClient(
            timeout=USDA_TIMEOUT_SECONDS,
            headers={"Accept": "application/json"},
        ) as client:
            r = await client.get(USDA_SEARCH_URL, params=params)
            r.raise_for_status()
            data = r.json()
    except httpx.TimeoutException:
        logger.info("USDA search timed out for %r", query)
        return [], True
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("USDA search failed for %r: %s", query, e)
        return [], True

    hits: list[NutritionSearchHit] = []
    for f in data.get("foods") or []:
        hit = _hit_from_usda_food(f)
        if hit is not None:
            hits.append(hit)
        if len(hits) >= USDA_PAGE_SIZE:
            break
    return hits, False


# ---------------------------------------------------------------------------
# Optional Ollama translation fallback
# ---------------------------------------------------------------------------

_TRANSLATE_SYSTEM = (
    "Translate the given German cooking ingredient name to a short, "
    "USDA-friendly English term (raw ingredient form, lowercase, no "
    "brands). Answer ONLY with a JSON object: "
    '{"english": "string"}. Examples: "Hähnchenbrust" → "chicken '
    'breast"; "Magerquark" → "quark low fat"; "Räucherlachs" → '
    '"smoked salmon".'
)


async def _translate_via_ollama(german_term: str) -> str | None:
    """One-shot LLM translation of a German ingredient name. Returns
    None on any error — caller should fall back to the normalised
    German term or skip USDA entirely."""
    try:
        raw = await call_text_json(
            f"Zutat: {german_term}",
            system=_TRANSLATE_SYSTEM,
            temperature=0.0,
        )
    except OllamaError as e:
        logger.debug("Ollama translation failed for %r: %s", german_term, e)
        return None
    if not isinstance(raw, dict):
        return None
    val = raw.get("english")
    if not isinstance(val, str):
        return None
    val = val.strip()
    return val or None


# ---------------------------------------------------------------------------
# Public API — grouped search
# ---------------------------------------------------------------------------

async def search_combined(
    query: str,
) -> tuple[list[NutritionSearchGroup], bool]:
    """Search both USDA and OFF concurrently and return (groups, unavailable).

    groups: USDA first (label 'Lebensmittel'), OFF second
    ('Markenprodukte'). Empty groups are omitted entirely so the
    frontend can iterate without length checks.

    unavailable: True iff NUTRITION_LOOKUP_ENABLED is False OR every
    *configured* upstream failed. "No key for USDA" doesn't count as
    a failure — it counts as "USDA not configured". If at least one
    upstream came back with an empty result list (no error), this is
    False — meaning "the search ran, nothing matched" which gets a
    different empty-state message in the sheet.
    """
    query = query.strip()
    if not query:
        return [], False
    if not settings.NUTRITION_LOOKUP_ENABLED:
        return [], True

    cached = _cache_get(query)
    if cached is not None:
        return cached

    # USDA needs the English term; OFF gets the user's German term
    # untouched (OFF handles German labels fine via lc=de).
    english, mapped = translate(query)

    async def usda_task() -> tuple[list[NutritionSearchHit], bool]:
        if not english:
            return [], False
        hits, unavailable = await _fetch_usda(english)
        # Optional Ollama translation fallback: only when the static
        # table missed AND USDA returned 0 hits (not when it errored —
        # an error is unrelated to the translation).
        if (
            not mapped
            and not hits
            and not unavailable
            and settings.NUTRITION_TRANSLATE_FALLBACK
        ):
            translated = await _translate_via_ollama(query)
            if translated and translated.lower() != english.lower():
                hits, unavailable = await _fetch_usda(translated)
        return hits, unavailable

    usda_hits, usda_unavail = [], False
    off_hits, off_unavail = [], False
    usda_res, off_res = await asyncio.gather(
        usda_task(),
        _fetch_off(query),
        return_exceptions=True,
    )
    if isinstance(usda_res, Exception):
        logger.warning("USDA task crashed: %s", usda_res)
        usda_unavail = True
    else:
        usda_hits, usda_unavail = usda_res
    if isinstance(off_res, Exception):
        logger.warning("OFF task crashed: %s", off_res)
        off_unavail = True
    else:
        off_hits, off_unavail = off_res

    usda_hits = _rerank(usda_hits, english or query)
    off_hits = _rerank(off_hits, query)

    groups: list[NutritionSearchGroup] = []
    if usda_hits:
        groups.append(NutritionSearchGroup(
            source="usda", label="Lebensmittel", results=usda_hits,
        ))
    if off_hits:
        groups.append(NutritionSearchGroup(
            source="off", label="Markenprodukte", results=off_hits,
        ))

    # "Unavailable" iff every CONFIGURED upstream failed. USDA without
    # a key counts as "not configured" — OFF carrying the result alone
    # is still a healthy state.
    usda_configured = bool(settings.FDC_API_KEY)
    sources_failed: list[bool] = []
    if usda_configured:
        sources_failed.append(usda_unavail and not usda_hits)
    sources_failed.append(off_unavail and not off_hits)
    unavailable = bool(sources_failed) and all(sources_failed) and not groups

    _cache_put(query, groups, unavailable)
    return groups, unavailable


# ---------------------------------------------------------------------------
# Public API — per-ingredient batch helper for the importer
# ---------------------------------------------------------------------------


class _ImporterHit:
    """Small carrier for `search_for_each`. Not a Pydantic model —
    purely internal."""
    __slots__ = ("hit", "source")

    def __init__(self, hit: NutritionSearchHit, source: str) -> None:
        self.hit = hit  # NutritionSearchHit
        self.source = source  # "usda" | "off"


async def search_for_each(
    queries: list[str], *, concurrency: int = 3
) -> dict[str, _ImporterHit | None]:
    """Per-ingredient top-hit lookup used by the AI recipe importer.

    For each query: USDA first (via the translation table), OFF as
    fallback. The returned value carries the source so the importer
    can stamp the right nutrition_source enum. Misses are None.

    Bounded concurrency keeps total throughput under the combined
    rate-gate ceiling without blocking the entire import behind serial
    calls."""
    sem = asyncio.Semaphore(concurrency)

    async def one(q: str) -> tuple[str, _ImporterHit | None]:
        async with sem:
            if not settings.NUTRITION_LOOKUP_ENABLED or not q.strip():
                return q, None
            # USDA first
            usda_hit: NutritionSearchHit | None = None
            if settings.FDC_API_KEY:
                english, mapped = translate(q)
                if english:
                    hits, unavail = await _fetch_usda(english)
                    if not hits and not unavail and not mapped \
                            and settings.NUTRITION_TRANSLATE_FALLBACK:
                        translated = await _translate_via_ollama(q)
                        if translated and translated.lower() != english.lower():
                            hits, _ = await _fetch_usda(translated)
                    if hits:
                        usda_hit = _rerank(hits, english)[0]
            if usda_hit is not None:
                return q, _ImporterHit(usda_hit, "usda")
            # OFF fallback
            off_hits, _ = await _fetch_off(q)
            if off_hits:
                top = _rerank(off_hits, q)[0]
                return q, _ImporterHit(top, "off")
            return q, None

    results = await asyncio.gather(*(one(q) for q in queries))
    return dict(results)


# ---------------------------------------------------------------------------
# Backwards-compat shim
# ---------------------------------------------------------------------------
#
# v1.3 callers used `search_off(query)` directly. We keep a thin shim
# returning the same shape so any external integrations still work.
# New code should use `search_combined`.

async def search_off(query: str) -> tuple[list[NutritionSearchHit], bool]:
    if not query.strip():
        return [], False
    if not settings.NUTRITION_LOOKUP_ENABLED:
        return [], True
    hits, unavailable = await _fetch_off(query.strip())
    return _rerank(hits, query.strip()), unavailable


# ---------------------------------------------------------------------------
# Ollama fallback — unchanged from v1.3
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


# ---------------------------------------------------------------------------
# Cache reset for tests / admin tools
# ---------------------------------------------------------------------------

def clear_cache() -> None:
    _cache.clear()


# Public re-export name used by `recipes.py` so existing imports keep
# working. The function does identical work under both names.
__all__ = [
    "search_combined",
    "search_for_each",
    "search_off",
    "estimate_with_ollama",
    "clear_cache",
]
