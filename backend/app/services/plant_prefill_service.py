"""AI prefill for the Plant create form — name → structured suggestions.

Ollama-only (local, no external API): goes through the shared
`call_text_json` helper with plain `format:"json"`. We DO NOT trust the
model — everything it returns is re-validated and normalised here
(location synonym map, int clamping, unknown keys dropped). Any failure
mode (timeout, unreachable, garbage JSON, wrong shape) collapses to a
clean `ok=False` response so the form never breaks and never 500s.

Edibility is deliberately advisory-only: it lives in
`edible_suggestion`/`edible_note` and is NEVER written to the plant's
real `edible` field.
"""
from __future__ import annotations

import logging
import re

from app.core.config import settings
from app.models.plant import PlantLocation
from app.schemas.plant import PlantPrefillResponse
from app.services.ollama import call_text_json

logger = logging.getLogger(__name__)

# JSON schema handed to Ollama's structured-output `format`. Constrains the
# shape (and pins `location` to the three enum values); it does NOT guarantee
# semantic correctness, so the server-side coercion below stays as a backstop.
# Edibility is isolated in edible_suggestion/edible_note — there is no key here
# that maps to the plant's real `edible` field.
_PREFILL_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "species": {"type": ["string", "null"]},
        "suggested_name": {"type": ["string", "null"]},
        "location": {"type": "string", "enum": ["SONNIG", "HALBSCHATTEN", "SCHATTEN"]},
        "watering_interval_days": {"type": ["integer", "null"]},
        "fertilize": {"type": "boolean"},
        "fertilize_interval_days": {"type": ["integer", "null"]},
        "winterhardy": {"type": "boolean"},
        "height_cm": {"type": ["integer", "null"]},
        "width_cm": {"type": ["integer", "null"]},
        "edible_suggestion": {"type": ["boolean", "null"]},
        "edible_note": {"type": ["string", "null"]},
        "note": {"type": ["string", "null"]},
    },
    "required": [
        "species", "suggested_name", "location", "watering_interval_days",
        "fertilize", "fertilize_interval_days", "winterhardy", "height_cm",
        "width_cm", "edible_suggestion", "edible_note", "note",
    ],
}

# CPU inference is slow but a name-prefill shouldn't hold the form hostage:
# cap well below the global 300s default. On timeout → ok=False path.
_PREFILL_TIMEOUT_S = 45.0

_FALLBACK_NOTE = "Konnte nicht ermitteln, bitte manuell ausfüllen."

_SYSTEM = (
    "Du bist ein Experte für Zimmer- und Gartenpflanzen. Der Nutzer nennt dir "
    "den Namen einer Pflanze. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt "
    "(kein Markdown, kein Text drumherum) mit genau diesen Schlüsseln:\n"
    '  "species": lateinischer/botanischer Name (String) oder null,\n'
    '  "suggested_name": kurzer deutscher Anzeigename (String) oder null,\n'
    '  "location": GENAU einer von "SONNIG", "HALBSCHATTEN", "SCHATTEN",\n'
    '  "watering_interval_days": typischer Gieß-Abstand in Tagen (ganze Zahl),\n'
    '  "fertilize": true/false ob Düngen sinnvoll ist,\n'
    '  "fertilize_interval_days": Dünge-Abstand in Tagen (ganze Zahl) oder null,\n'
    '  "winterhardy": true/false ob winterhart,\n'
    '  "height_cm": typische Höhe in cm (ganze Zahl) oder null,\n'
    '  "width_cm": typische Breite in cm (ganze Zahl) oder null,\n'
    '  "edible_suggestion": true/false/null ob essbar,\n'
    '  "edible_note": kurzer Hinweis zur Essbarkeit (String) oder null,\n'
    '  "note": kurzer Hinweis bei Unsicherheit (String) oder null.\n'
    "Alle Texte auf Deutsch. Gib nur das JSON zurück."
)

# Map case-folded / synonym light descriptions onto the three enum values.
_LOCATION_SYNONYMS: dict[str, set[str]] = {
    "SONNIG": {
        "sonnig", "sonne", "vollsonne", "vollsonnig", "sonnenstandort",
        "viel sonne", "volle sonne", "full sun", "sunny",
    },
    "HALBSCHATTEN": {
        "halbschatten", "halbschattig", "halbsonnig", "absonnig", "indirekt",
        "indirektes licht", "heller standort", "partial shade", "part shade",
    },
    "SCHATTEN": {
        "schatten", "schattig", "dunkel", "wenig licht", "shade", "full shade",
    },
}


def _coerce_location(raw) -> PlantLocation | None:
    if not isinstance(raw, str):
        return None
    s = raw.strip().lower()
    if not s:
        return None
    up = s.upper()
    if up in ("SONNIG", "HALBSCHATTEN", "SCHATTEN"):
        return PlantLocation(up)
    for enum_val, syns in _LOCATION_SYNONYMS.items():
        if s in syns:
            return PlantLocation(enum_val)
    # Containment fallback — ORDER MATTERS: "halbschatt" before "schatt".
    if "halbschatt" in s or "halbsonn" in s:
        return PlantLocation.HALBSCHATTEN
    if "schatt" in s or "shade" in s or "dunkel" in s:
        return PlantLocation.SCHATTEN
    if "sonn" in s or "sun" in s:
        return PlantLocation.SONNIG
    return None


def _coerce_int(raw, lo: int, hi: int) -> int | None:
    # bool is an int subclass — exclude so True/False don't become 1/0.
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        n = int(raw)
    elif isinstance(raw, str):
        m = re.search(r"-?\d+", raw)
        if not m:
            return None
        n = int(m.group())
    else:
        return None
    return max(lo, min(hi, n))


_TRUE = {"true", "ja", "yes", "1", "wahr"}
_FALSE = {"false", "nein", "no", "0", "falsch"}


def _coerce_bool(raw, default: bool = False) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        t = raw.strip().lower()
        if t in _TRUE:
            return True
        if t in _FALSE:
            return False
    return default


def _coerce_tristate(raw) -> bool | None:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        t = raw.strip().lower()
        if t in _TRUE:
            return True
        if t in _FALSE:
            return False
    return None


def _coerce_str(raw, maxlen: int) -> str | None:
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    return s[:maxlen] if s else None


async def prefill_plant(name: str) -> PlantPrefillResponse:
    """Ask Ollama for care suggestions and return a fully-normalised,
    advisory response. Never raises — failures become ok=False."""
    prompt = f"Pflanze: {name.strip()}\nGib die Pflegedaten als JSON zurück."
    try:
        data = await call_text_json(
            prompt,
            system=_SYSTEM,
            # Empty OLLAMA_PLANT_MODEL → None → call_text falls back to the text model.
            model=settings.OLLAMA_PLANT_MODEL or None,
            temperature=0.1,
            timeout=_PREFILL_TIMEOUT_S,
            format_schema=_PREFILL_SCHEMA,
            think=False,  # silence qwen3 reasoning for this call only
        )
    except Exception as e:  # noqa: BLE001 — OllamaError, timeouts, anything: stay graceful
        logger.info("Plant prefill failed for %r: %s", name, e)
        return PlantPrefillResponse(ok=False, note=_FALLBACK_NOTE)

    if not isinstance(data, dict):
        logger.info("Plant prefill returned non-object for %r: %r", name, type(data))
        return PlantPrefillResponse(ok=False, note=_FALLBACK_NOTE)

    fertilize = _coerce_bool(data.get("fertilize"))
    return PlantPrefillResponse(
        ok=True,
        note=_coerce_str(data.get("note"), 500),
        species=_coerce_str(data.get("species"), 255),
        suggested_name=_coerce_str(data.get("suggested_name"), 255),
        location=_coerce_location(data.get("location")),
        watering_interval_days=_coerce_int(data.get("watering_interval_days"), 1, 365),
        fertilize=fertilize,
        # Only meaningful when fertilizing is suggested.
        fertilize_interval_days=(
            _coerce_int(data.get("fertilize_interval_days"), 1, 365) if fertilize else None
        ),
        winterhardy=_coerce_bool(data.get("winterhardy")),
        height_cm=_coerce_int(data.get("height_cm"), 0, 10000),
        width_cm=_coerce_int(data.get("width_cm"), 0, 10000),
        edible_suggestion=_coerce_tristate(data.get("edible_suggestion")),
        edible_note=_coerce_str(data.get("edible_note"), 500),
    )
