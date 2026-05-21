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
    Batch helper used by the AI recipe importer. USDA-first for every
    ingredient (USDA's quota is generous — 1000/h with a key); OFF
    only fills the USDA misses, and only as long as the 10/min OFF
    budget hasn't been blown. Returns one NutritionSearchHit (or None)
    per name with `source` flagged.

  estimate_with_ollama(name, hint=None)
    Local Ollama estimate — unchanged from v1.3.

OFF migration (v1.4.2)
  The legacy /cgi/search.pl endpoint is being decommissioned (global
  503s as of 2026-05). Lyst now hits Search-a-licious at
  search.openfoodfacts.org. Per-hit shape:
    - `brands` changed from comma-separated string to array of strings
    - `nutriments.*_100g` field names stayed the same
    - `product_name` may be null on entries that only have
      per-language fields populated
  We respect OFF's published per-IP search limit of 10/min via a
  rolling-window token bucket, and identify ourselves with a contact-
  bearing User-Agent per OFF policy.
"""
from __future__ import annotations

import asyncio
import collections
import logging
import time
from typing import Any

import httpx

from app.core.config import settings
from app.data.ingredient_translations import (
    normalize,
    search_variants,
    translate,
)
from app.schemas.recipe import (
    NutritionEstimateResponse,
    NutritionSearchGroup,
    NutritionSearchHit,
    NutritionValues,
)
from app.services.ollama import OllamaError, call_text_json

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Open Food Facts — Search-a-licious
# ---------------------------------------------------------------------------
OFF_SEARCH_URL = "https://search.openfoodfacts.org/search"
# Per OFF policy: AppName/Version (contact). Lyst is self-hosted so the
# contact is the project URL — that's still actionable for OFF ops if
# they need to reach us about traffic.
OFF_USER_AGENT = "Lyst/1.4 (https://github.com/laarsv/Lyst)"
OFF_TIMEOUT_SECONDS = 4.0
OFF_PAGE_SIZE = 5
# Field allowlist. Cheap traffic-wise and saves us downstream guards
# against unexpected fields. `nutriments` returns the whole sub-object;
# we pluck the seven we care about in _hit_from_off_product.
OFF_FIELDS = "product_name,brands,code,image_small_url,nutriments"
# `langs=de,en`: bias to German per-language product_name fields while
# falling back to English. Search-a-licious uses Elasticsearch under
# the hood and ranks language-matched hits higher.
OFF_LANGS = "de,en"


# ---------------------------------------------------------------------------
# USDA FoodData Central
# ---------------------------------------------------------------------------
USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
USDA_TIMEOUT_SECONDS = 4.0
USDA_PAGE_SIZE = 5
USDA_DATA_TYPES = "Foundation,SR Legacy"


# ---------------------------------------------------------------------------
# Cache (groups + unavailable flag, keyed on normalised query)
# ---------------------------------------------------------------------------
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
# Rate gates — per upstream, with the right shape for each.
# ---------------------------------------------------------------------------
#
# OFF: 10 req/min/IP (OFF's documented policy for any /search endpoint).
# We implement this as a rolling-window token bucket — keep timestamps
# of the last 10 outgoing requests; when we'd issue an 11th, wait until
# the oldest falls outside the 60s window.
#
# USDA: published quota is 1000/h with an API key. ~1/sec is well
# inside that and matches the polite serialisation we already had.
class _RollingWindowGate:
    """Allow at most `limit` requests per `window_seconds` per process.

    Designed for OFF's 10/min cap. The deque holds monotonic timestamps
    of *granted* requests; on each request we evict any older than the
    window, then either pass through (if room) or sleep until the oldest
    entry expires. Single-process so a deque is enough — Redis is the
    upgrade if we ever fan out to multiple workers."""

    def __init__(self, *, limit: int, window_seconds: float) -> None:
        self._limit = limit
        self._window = window_seconds
        self._lock = asyncio.Lock()
        self._stamps: collections.deque[float] = collections.deque(maxlen=limit)

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            # Drop entries outside the window
            while self._stamps and (now - self._stamps[0]) >= self._window:
                self._stamps.popleft()
            if len(self._stamps) >= self._limit:
                sleep_for = self._window - (now - self._stamps[0])
                if sleep_for > 0:
                    await asyncio.sleep(sleep_for)
                now = time.monotonic()
                while self._stamps and (now - self._stamps[0]) >= self._window:
                    self._stamps.popleft()
            self._stamps.append(now)

    def available(self) -> int:
        """Best-effort, lock-free read of remaining budget in the
        current window. Used by the importer batch path to decide
        whether to even try OFF for a USDA-miss."""
        now = time.monotonic()
        # Count entries still inside the window.
        recent = sum(1 for t in self._stamps if (now - t) < self._window)
        return max(0, self._limit - recent)


class _IntervalGate:
    """Serialised "no more than 1 call per `interval` seconds" gate.
    Used for USDA — we don't need a rolling window there, just polite
    pacing."""

    def __init__(self, *, interval: float) -> None:
        self._interval = interval
        self._lock = asyncio.Lock()
        self._last = 0.0

    async def wait(self) -> None:
        async with self._lock:
            delta = time.monotonic() - self._last
            if delta < self._interval:
                await asyncio.sleep(self._interval - delta)
            self._last = time.monotonic()


# OFF: 10 / 60s, with a tiny safety margin (use 58s window so we never
# accidentally race the upstream's reset boundary).
_off_gate = _RollingWindowGate(limit=10, window_seconds=58.0)
_usda_gate = _IntervalGate(interval=1.0)


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
    """Re-rank a group so short / close name matches bubble up. Stable
    sort preserves upstream order within score ties."""
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


def _dedup_by_code(hits: list[NutritionSearchHit]) -> list[NutritionSearchHit]:
    """Drop duplicate hits when we ran two query variants. Dedup key:
    OFF barcode for OFF rows, fdc_id for USDA rows. Both can't collide
    because they only ever appear in their own group."""
    seen: set[str] = set()
    out: list[NutritionSearchHit] = []
    for h in hits:
        key = h.code or h.fdc_id or ""
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(h)
    return out


# ---------------------------------------------------------------------------
# OFF parsing — Search-a-licious response shape
# ---------------------------------------------------------------------------

def _hit_from_off_product(product: dict[str, Any]) -> NutritionSearchHit | None:
    """Parse one Search-a-licious hit.

    Differences from the legacy /cgi/search.pl shape:
      - `brands` is now an array of strings (was comma-separated str)
      - `product_name` may be null when only per-language fields are
        populated; we skip such rows since the UI needs a name.
    """
    name = product.get("product_name")
    if not isinstance(name, str):
        name = ""
    name = name.strip()
    code = (product.get("code") or "").strip()
    if not name or not code:
        return None

    nutriments = product.get("nutriments") or {}
    # `energy-kcal_100g` is the canonical kcal field. `energy_100g` /
    # `energy-kj_100g` carry kJ; fall back if kcal is missing.
    calories = _coerce_float(nutriments.get("energy-kcal_100g"))
    if calories is None:
        kj = _coerce_float(nutriments.get("energy-kj_100g"))
        if kj is None:
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

    brands_raw = product.get("brands")
    brand: str | None = None
    if isinstance(brands_raw, list) and brands_raw:
        first = brands_raw[0]
        if isinstance(first, str):
            brand = first.strip() or None
    elif isinstance(brands_raw, str) and brands_raw.strip():
        # Defensive: in case a future schema flips back to a string.
        brand = brands_raw.split(",")[0].strip() or None

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
# USDA parsing (unchanged from v1.4.0)
# ---------------------------------------------------------------------------

_USDA_NUTRIENT_FIELDS = {
    1008: "calories_per_100g",
    1003: "protein_per_100g",
    1004: "fat_per_100g",
    1005: "carbs_per_100g",
    1079: "fiber_per_100g",
    2000: "sugar_per_100g",
    1093: "sodium_mg",
    208: "calories_per_100g",
    203: "protein_per_100g",
    204: "fat_per_100g",
    205: "carbs_per_100g",
    291: "fiber_per_100g",
    269: "sugar_per_100g",
    307: "sodium_mg",
}


def _hit_from_usda_food(food: dict[str, Any]) -> NutritionSearchHit | None:
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
        if collected[field] is None:
            collected[field] = v

    sodium_mg = collected.pop("sodium_mg")
    salt_g: float | None = None
    if sodium_mg is not None:
        # NaCl/Na molar-mass ratio rounded to 2.5 — EU 1169/2011 + OFF.
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
        code="",
        image_url=None,
        nutrition=values,
        fdc_id=str(fdc_id),
    )


# ---------------------------------------------------------------------------
# Upstream fetchers
# ---------------------------------------------------------------------------

async def _fetch_off_one(query: str) -> tuple[list[NutritionSearchHit], bool]:
    """Single Search-a-licious call. Returns (hits, error).
    `error=True` means transport / HTTP failure — zero hits with
    `error=False` is a genuine 'no products matched'."""
    await _off_gate.wait()
    params = {
        "q": query,
        "page_size": str(OFF_PAGE_SIZE),
        "fields": OFF_FIELDS,
        "langs": OFF_LANGS,
        # `-` prefix = descending order. popularity_key surfaces
        # widely-scanned products before niche ones, which is what we
        # want as a default for a cooking-app picker.
        "sort_by": "-popularity_key",
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
    for h in data.get("hits") or []:
        hit = _hit_from_off_product(h)
        if hit is not None:
            hits.append(hit)
        if len(hits) >= OFF_PAGE_SIZE:
            break
    return hits, False


async def _fetch_off_with_variants(
    variants: list[str],
) -> tuple[list[NutritionSearchHit], bool]:
    """Run OFF against up to two query variants (normalised core +
    original) and merge. Returns (hits, error). error=True iff EVERY
    variant errored. Skips additional variants once the OFF budget is
    exhausted — better to return one variant's hits than burn the
    remaining 10/min budget on duplicates."""
    if not variants:
        return [], False
    merged: list[NutritionSearchHit] = []
    any_success = False
    any_error = False
    for i, v in enumerate(variants):
        if i > 0 and _off_gate.available() <= 1:
            # Reserve the last slot in the window for an unrelated
            # follow-up search. Single-variant results are still good.
            break
        hits, err = await _fetch_off_one(v)
        if err:
            any_error = True
            continue
        any_success = True
        merged.extend(hits)
    if not any_success and any_error:
        return [], True
    return _dedup_by_code(merged), False


async def _fetch_usda(query: str) -> tuple[list[NutritionSearchHit], bool]:
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
# Optional Ollama translation fallback (unchanged from v1.4.0)
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
    ('Markenprodukte'). Empty groups are omitted.

    unavailable: True ONLY when every *configured* upstream actually
    errored (network/timeout/HTTP). A successful call with zero hits
    leaves this False — that's a "no match" message in the UI, not a
    "service down" message. USDA without an API key counts as "not
    configured" rather than "failed".
    """
    query = query.strip()
    if not query:
        return [], False
    if not settings.NUTRITION_LOOKUP_ENABLED:
        return [], True

    cached = _cache_get(query)
    if cached is not None:
        return cached

    # German→English for USDA; original + normalised variants for OFF.
    english, mapped = translate(query)
    off_variants = search_variants(query)

    async def usda_task() -> tuple[list[NutritionSearchHit], bool]:
        if not english:
            return [], False
        hits, error = await _fetch_usda(english)
        if (
            not mapped
            and not hits
            and not error
            and settings.NUTRITION_TRANSLATE_FALLBACK
        ):
            translated = await _translate_via_ollama(query)
            if translated and translated.lower() != english.lower():
                hits, error = await _fetch_usda(translated)
        return hits, error

    async def off_task() -> tuple[list[NutritionSearchHit], bool]:
        return await _fetch_off_with_variants(off_variants)

    usda_hits, usda_error = [], False
    off_hits, off_error = [], False
    usda_res, off_res = await asyncio.gather(
        usda_task(), off_task(), return_exceptions=True
    )
    if isinstance(usda_res, Exception):
        logger.warning("USDA task crashed: %s", usda_res)
        usda_error = True
    else:
        usda_hits, usda_error = usda_res
    if isinstance(off_res, Exception):
        logger.warning("OFF task crashed: %s", off_res)
        off_error = True
    else:
        off_hits, off_error = off_res

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

    # "Unavailable" semantics: at least one upstream is configured AND
    # every configured upstream erred AND nothing made it into the
    # groups. A 0-hit response on a healthy connection is NOT
    # unavailable — that's "we looked, the term has no match", which
    # the UI surfaces with a different empty-state message.
    usda_configured = bool(settings.FDC_API_KEY)
    errors: list[bool] = []
    if usda_configured:
        errors.append(usda_error)
    errors.append(off_error)
    unavailable = bool(errors) and all(errors) and not groups

    _cache_put(query, groups, unavailable)
    return groups, unavailable


# ---------------------------------------------------------------------------
# Public API — per-ingredient batch helper for the importer
# ---------------------------------------------------------------------------

class _ImporterHit:
    __slots__ = ("hit", "source")

    def __init__(self, hit: NutritionSearchHit, source: str) -> None:
        self.hit = hit
        self.source = source


async def search_for_each(
    queries: list[str], *, usda_concurrency: int = 3
) -> dict[str, _ImporterHit | None]:
    """USDA-first batch lookup for the recipe importer.

    Strategy designed around OFF's 10/min cap:
      1. Fan out a USDA lookup for every ingredient in parallel
         (bounded by `usda_concurrency` so we don't overshoot USDA's
         polite 1/sec pacing). USDA's 1000/h quota easily covers a
         15-ingredient recipe.
      2. For ingredients USDA missed, fall back to OFF *serially*
         and only while the OFF rate-gate has slots free. The gate
         itself blocks when we approach 10/min; here we additionally
         short-circuit to avoid pinning the gate's lock for ages.
      3. Anything still unmatched after that returns None — the user
         can KI/manual-enter from the row's sheet.

    Returns one entry per input query keyed on the raw query string.
    """
    sem = asyncio.Semaphore(usda_concurrency)

    async def usda_one(q: str) -> tuple[str, _ImporterHit | None]:
        async with sem:
            if not settings.NUTRITION_LOOKUP_ENABLED or not q.strip():
                return q, None
            if not settings.FDC_API_KEY:
                return q, None
            english, mapped = translate(q)
            if not english:
                return q, None
            hits, error = await _fetch_usda(english)
            if (
                not hits
                and not error
                and not mapped
                and settings.NUTRITION_TRANSLATE_FALLBACK
            ):
                translated = await _translate_via_ollama(q)
                if translated and translated.lower() != english.lower():
                    hits, _ = await _fetch_usda(translated)
            if not hits:
                return q, None
            return q, _ImporterHit(_rerank(hits, english)[0], "usda")

    # Phase 1: USDA fan-out
    results: dict[str, _ImporterHit | None] = dict(
        await asyncio.gather(*(usda_one(q) for q in queries))
    )

    # Phase 2: OFF fallback for misses, budget-aware and serial. We
    # also bail early if NUTRITION_LOOKUP_ENABLED is off (covered above
    # via the per-query early return). Note: each OFF call still goes
    # through the rate gate — `available()` is a *hint* to avoid even
    # entering the gate when we already know we'd be parked.
    for q in queries:
        if results.get(q) is not None:
            continue
        if not settings.NUTRITION_LOOKUP_ENABLED or not q.strip():
            continue
        variants = search_variants(q)
        if not variants:
            continue
        if _off_gate.available() <= 0:
            # OFF budget already empty — don't pin the gate's lock for
            # a full minute on a best-effort batch path. The user can
            # still pull values via the manual sheet later.
            logger.info("OFF budget empty in importer; skipping %r", q)
            continue
        hits, _ = await _fetch_off_with_variants(variants[:1])
        if hits:
            results[q] = _ImporterHit(_rerank(hits, q)[0], "off")

    return results


# ---------------------------------------------------------------------------
# Backwards-compat shim
# ---------------------------------------------------------------------------

async def search_off(query: str) -> tuple[list[NutritionSearchHit], bool]:
    """Returns OFF-only hits for the query. Kept so any external
    integrations from v1.3 keep working — internally everything now
    goes through `search_combined`."""
    if not query.strip():
        return [], False
    if not settings.NUTRITION_LOOKUP_ENABLED:
        return [], True
    hits, error = await _fetch_off_with_variants(search_variants(query.strip()))
    return _rerank(hits, query.strip()), error


# ---------------------------------------------------------------------------
# Ollama estimate fallback — unchanged from v1.3
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


# Hook for tests / admin tools.
def clear_cache() -> None:
    _cache.clear()


def off_budget_remaining() -> int:
    """How many OFF requests we could still make in the current
    10/min window. Used by the bulk-fill endpoint to mark rows as
    'deferred' rather than burning the whole budget on one recipe."""
    return _off_gate.available()


__all__ = [
    "search_combined",
    "search_for_each",
    "search_off",
    "estimate_with_ollama",
    "off_budget_remaining",
    "clear_cache",
]


# Suppress an unused-import warning — `normalize` is re-exported via
# the translations module but we also touch it indirectly above. Tag
# it here so static analysers see the dependency.
_ = normalize
