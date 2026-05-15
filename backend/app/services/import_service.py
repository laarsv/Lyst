"""Recipe URL/photo import & "was kann ich kochen?" suggestions.

Pipeline (URL): fetch URL → strip boilerplate → send text to LLM → parse
JSON → return a Pydantic-validated `ImportedRecipe`. The endpoint never
persists — the frontend prefills its edit form and the user saves
explicitly.

All Ollama traffic goes through `app.services.ollama`. Direct httpx calls
to `/api/generate` are not allowed in this file (or anywhere else) — that
keeps keep_alive consistent so models stay warm.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any

import anthropic
import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.ollama import (
    OllamaError,
    call_text_json,
    call_vision_json,
    list_installed_models,
)
from app.services.settings_service import (
    get_anthropic_model,
    get_llm_provider,
    get_ollama_model,
)

logger = logging.getLogger(__name__)

# Cap for HTML/URL/PDF derived text — the LLM context is the bottleneck.
# Free-text input gets a higher ceiling (the user already cleaned it).
MAX_TEXT_CHARS = 4000
MAX_FREETEXT_CHARS = 10_000
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

SYSTEM_PROMPT = """You are a recipe extraction assistant. The user will give you the raw text of a recipe webpage. Extract the recipe and return ONLY a valid JSON object with this exact structure — no explanation, no markdown, no code fences:
{
  "title": "string",
  "description": "string or null",
  "servings": integer or null,
  "prep_time_minutes": integer or null,
  "cook_time_minutes": integer or null,
  "tags": ["short German tag", ...] (e.g. "frühstück", "vegetarisch", "schnell"; empty array if unsure),
  "ingredients": [
    { "name": "string", "quantity": number or null, "unit": "string or null" }
  ],
  "steps": [
    { "description": "string", "position": integer }
  ]
}
If a field cannot be determined, use null (or [] for tags). Always return raw JSON only."""


# ---------- Pydantic response model ----------

class ImportedIngredient(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    quantity: float | None = None
    unit: str | None = Field(default=None, max_length=32)


class ImportedStep(BaseModel):
    description: str = Field(min_length=1)
    position: int | None = None


class ImportedRecipe(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    servings: int | None = Field(default=None, ge=1, le=999)
    prep_time_minutes: int | None = Field(default=None, ge=0)
    cook_time_minutes: int | None = Field(default=None, ge=0)
    # Categorisation moved from a fixed enum to free-form tags in
    # alembic 0011 — the URL importer asks the LLM for short German tag
    # words; the user can edit them before saving.
    tags: list[str] = Field(default_factory=list)
    source_url: str | None = None
    ingredients: list[ImportedIngredient] = Field(default_factory=list)
    steps: list[ImportedStep] = Field(default_factory=list)

    @field_validator("tags", mode="before")
    @classmethod
    def _coerce_tags(cls, v: Any) -> Any:
        """LLMs occasionally return a single string, null, or a comma-
        separated value where we expect a list. Be forgiving."""
        if v is None or v == "":
            return []
        if isinstance(v, str):
            return [t.strip().lstrip("#") for t in v.split(",") if t.strip()]
        if isinstance(v, list):
            return [str(t).strip().lstrip("#") for t in v if str(t).strip()]
        return []


# ---------- Pipeline ----------

class RecipeImportError(Exception):
    """Marker for callers to translate into a clean HTTP error."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _from_ollama_error(e: OllamaError) -> RecipeImportError:
    return RecipeImportError(e.status, e.message)


async def _fetch_html(url: str) -> str:
    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "de,en;q=0.8"},
        ) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.text
    except (httpx.HTTPError, httpx.InvalidURL) as e:
        logger.warning("URL fetch failed: %s — %s", url, e)
        raise RecipeImportError(400, "URL konnte nicht geladen werden") from e


def _clean_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    # Remove obvious noise
    for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                     "noscript", "iframe", "svg", "form", "button"]):
        tag.decompose()

    # Prefer <article>, then <main>, then largest text block, else body
    candidate = soup.find("article") or soup.find("main")
    if candidate is None:
        # pick the element with the most plain-text characters from common containers
        candidates = soup.find_all(["section", "div"])
        if candidates:
            candidate = max(candidates, key=lambda el: len(el.get_text(strip=True)), default=None)
    if candidate is None:
        candidate = soup.body or soup

    text = candidate.get_text(separator="\n", strip=True)
    # Collapse runs of blank lines
    text = re.sub(r"\n{2,}", "\n\n", text)
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
    return text


# `_extract_json` lives in app.services.ollama now (see `extract_json`),
# along with `call_text_json` / `call_vision_json` that handle the parse +
# one-shot retry for free. This module just maps OllamaError into the
# local RecipeImportError shape.


async def list_ollama_models() -> list[dict[str, Any]]:
    """Back-compat shim — admin router calls this. Forwards to the central
    Ollama service and converts errors into the local exception type."""
    try:
        return await list_installed_models()
    except OllamaError as e:
        raise _from_ollama_error(e) from e


# ---------- Anthropic provider ----------

# Curated list — extending it just means picking a current model id from
# https://docs.claude.com/en/docs/about-claude/models. Hardcoded over the
# /v1/models endpoint so admins don't accidentally pick a deprecated id.
ANTHROPIC_MODELS: list[dict[str, str]] = [
    {
        "id": "claude-haiku-4-5",
        "name": "Claude Haiku 4.5",
        "description": "Schnell & günstig — für den Rezept-Importer mehr als ausreichend.",
    },
    {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6",
        "description": "Ausgewogene Qualität, etwa 5× teurer als Haiku.",
    },
    {
        "id": "claude-opus-4-7",
        "name": "Claude Opus 4.7",
        "description": "Höchste Qualität, deutlich teurer und langsamer.",
    },
]


async def _call_anthropic(text: str, model: str) -> dict[str, Any]:
    if not settings.ANTHROPIC_API_KEY:
        raise RecipeImportError(503, "ANTHROPIC_API_KEY ist nicht gesetzt")
    client = anthropic.AsyncAnthropic(
        api_key=settings.ANTHROPIC_API_KEY,
        timeout=float(settings.ANTHROPIC_TIMEOUT_SECONDS),
    )
    try:
        response = await client.messages.create(
            model=model,
            max_tokens=2048,
            temperature=0.1,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": text}],
        )
    except anthropic.APITimeoutError as e:
        logger.error("Anthropic timeout: %s", e)
        raise RecipeImportError(504, "KI-Service hat zu lange gebraucht") from e
    except anthropic.AuthenticationError as e:
        logger.error("Anthropic auth failed: %s", e)
        raise RecipeImportError(401, "ANTHROPIC_API_KEY ungültig") from e
    except anthropic.RateLimitError as e:
        logger.error("Anthropic rate limit: %s", e)
        raise RecipeImportError(429, "Anthropic Rate-Limit erreicht") from e
    except anthropic.NotFoundError as e:
        logger.error("Anthropic model unknown: %s", e)
        raise RecipeImportError(400, f"Unbekanntes Anthropic-Modell: {model}") from e
    except anthropic.APIError as e:
        logger.error("Anthropic error: %s", e)
        raise RecipeImportError(502, "KI-Anbieter-Fehler") from e

    # Concatenate any text blocks the model returned and parse via the
    # shared forgiving extractor.
    from app.services.ollama import extract_json as _extract
    parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    try:
        return _extract("".join(parts))
    except json.JSONDecodeError as e:
        raise RecipeImportError(500, "Rezept konnte nicht extrahiert werden") from e


# ---------- Provider dispatch ----------

async def _extract_recipe_from_text(
    text: str, db: AsyncSession, *, source_url: str | None = None
) -> ImportedRecipe:
    """Shared backend for URL/HTML/PDF/free-text imports — the only
    differences between those paths are how the text gets prepared
    upstream. Sends the (already-cleaned) text to the configured
    provider (Ollama or Anthropic), parses JSON, validates against
    ImportedRecipe."""
    if not text or not text.strip():
        raise RecipeImportError(400, "Keine lesbaren Inhalte gefunden")

    provider = await get_llm_provider(db)
    if provider == "anthropic":
        model = await get_anthropic_model(db)
        parsed = await _call_anthropic(text, model)
    else:
        model = await get_ollama_model(db)
        try:
            parsed = await call_text_json(
                text,
                system=SYSTEM_PROMPT,
                model=model,
                temperature=0.1,
            )
        except OllamaError as e:
            raise _from_ollama_error(e) from e
        if not isinstance(parsed, dict):
            raise RecipeImportError(500, "Rezept konnte nicht extrahiert werden")
    if source_url is not None:
        parsed["source_url"] = source_url

    # Renumber step positions deterministically (LLM may skip or repeat)
    if isinstance(parsed.get("steps"), list):
        for i, step in enumerate(parsed["steps"], start=1):
            if isinstance(step, dict):
                step["position"] = i

    try:
        return ImportedRecipe.model_validate(parsed)
    except ValidationError as e:
        logger.error("LLM JSON failed validation (provider=%s): %s — payload: %s", provider, e, parsed)
        raise RecipeImportError(500, "Extrahierte Daten haben unerwartetes Format") from e


async def import_recipe_from_url(url: str, db: AsyncSession) -> ImportedRecipe:
    html = await _fetch_html(url)
    text = _clean_text(html)
    if not text:
        raise RecipeImportError(400, "Keine lesbaren Inhalte auf der Seite gefunden")
    return await _extract_recipe_from_text(text, db, source_url=url)


async def import_recipe_from_html_bytes(
    html_bytes: bytes, db: AsyncSession
) -> ImportedRecipe:
    """For uploaded HTML files (e.g. a saved Picnic recipe email).
    Reuses the same boilerplate-stripper as the URL importer."""
    try:
        # Most emails ship as UTF-8 these days; fall back to a tolerant
        # decode so a stray latin-1 byte doesn't abort the whole import.
        html = html_bytes.decode("utf-8", errors="replace")
    except Exception as e:  # pragma: no cover
        raise RecipeImportError(400, "Datei konnte nicht gelesen werden") from e
    text = _clean_text(html)
    if not text:
        raise RecipeImportError(400, "Datei enthält keinen lesbaren Inhalt")
    return await _extract_recipe_from_text(text, db, source_url=None)


async def import_recipe_from_pdf_bytes(
    pdf_bytes: bytes, db: AsyncSession
) -> ImportedRecipe:
    """Extract every page's text via pypdf, concatenate, send through
    the same shared LLM path. pypdf is pure-Python and the import is
    local so a missing native dependency can't break the whole
    backend container."""
    try:
        from pypdf import PdfReader
    except ImportError as e:  # pragma: no cover
        raise RecipeImportError(500, "PDF-Unterstützung nicht installiert") from e
    import io

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as e:
        logger.warning("PDF parse failed: %s", e)
        raise RecipeImportError(400, "PDF konnte nicht gelesen werden") from e
    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception as e:  # pragma: no cover — pypdf throws on rare cases
            logger.debug("PDF page extract failed: %s", e)
            continue
    raw = "\n\n".join(pages).strip()
    # Collapse runs of blank lines; cap at the HTML budget so the
    # prompt stays compact.
    raw = re.sub(r"\n{2,}", "\n\n", raw)
    if len(raw) > MAX_TEXT_CHARS:
        raw = raw[:MAX_TEXT_CHARS]
    if not raw:
        raise RecipeImportError(
            400,
            "Aus der PDF konnte kein Text extrahiert werden — vermutlich nur Bilder.",
        )
    return await _extract_recipe_from_text(raw, db, source_url=None)


async def import_recipe_from_text(
    text: str, db: AsyncSession
) -> ImportedRecipe:
    """User-pasted free-text recipe. We trust the user has already
    given us something coherent — minimal cleaning, just trim and a
    higher length cap. The system prompt is the standard one; the
    LLM does the heavy lifting of structuring messy input."""
    raw = (text or "").strip()
    if not raw:
        raise RecipeImportError(400, "Kein Text eingegeben")
    if len(raw) > MAX_FREETEXT_CHARS:
        raw = raw[:MAX_FREETEXT_CHARS]
    return await _extract_recipe_from_text(raw, db, source_url=None)


# ---------- Photo import via Ollama vision model ----------

PHOTO_SYSTEM_PROMPT = SYSTEM_PROMPT  # same JSON contract


async def import_recipe_from_image(image_bytes: bytes) -> ImportedRecipe:
    """Send the uploaded image to a vision-capable Ollama model and parse
    the same recipe JSON shape as the URL importer."""
    b64 = base64.b64encode(image_bytes).decode("ascii")
    try:
        parsed = await call_vision_json(
            (
                "Lies dieses Rezept-Bild und extrahiere es als strukturiertes Rezept. "
                "Antworte ausschließlich im vorgegebenen JSON-Format."
            ),
            b64,
            system=PHOTO_SYSTEM_PROMPT,
            temperature=0.1,
        )
    except OllamaError as e:
        raise _from_ollama_error(e) from e
    if not isinstance(parsed, dict):
        raise RecipeImportError(500, "Rezept konnte nicht extrahiert werden")
    if isinstance(parsed.get("steps"), list):
        for i, step in enumerate(parsed["steps"], start=1):
            if isinstance(step, dict):
                step["position"] = i
    try:
        return ImportedRecipe.model_validate(parsed)
    except ValidationError as e:
        logger.error("Vision JSON failed validation: %s — payload: %s", e, parsed)
        raise RecipeImportError(500, "Extrahierte Daten haben unerwartetes Format") from e


# ---------- "Was kann ich kochen?" suggestions ----------

SUGGEST_SYSTEM_PROMPT = """You are a recipe suggestion assistant. Given the user's available ingredients and a list of recipes (each with id, title, and ingredients), suggest the top 3 recipes that fit best with what the user has on hand.

Return ONLY a valid JSON array — no markdown, no prose, no code fences:
[{"recipe_id": <number>, "title": "string", "reason": "one short sentence in German"}]

Pick recipes whose ingredients overlap most with the user's available ingredients. The reason should explain in German why this recipe fits, in one sentence."""


class SuggestedRecipe(BaseModel):
    recipe_id: int
    title: str
    reason: str


async def suggest_recipes_from_ingredients(
    db: AsyncSession,
    available_ingredients: list[str],
    user_recipes: list[dict[str, Any]],
) -> list[SuggestedRecipe]:
    """Ask the configured provider to pick top-3 matching recipes.
    `user_recipes` is a list of {id, title, ingredients: [name, ...]}."""
    if not user_recipes:
        return []
    catalog_text = "\n".join(
        f'- id={r["id"]} title="{r["title"]}" ingredients=[{", ".join(r["ingredients"])}]'
        for r in user_recipes
    )
    user_text = (
        f"Ich habe zuhause: {', '.join(available_ingredients)}.\n\n"
        f"Verfügbare Rezepte:\n{catalog_text}\n\n"
        f"Schlage die 3 passendsten vor."
    )

    provider = await get_llm_provider(db)
    if provider == "anthropic":
        model = await get_anthropic_model(db)
        if not settings.ANTHROPIC_API_KEY:
            raise RecipeImportError(503, "ANTHROPIC_API_KEY ist nicht gesetzt")
        client = anthropic.AsyncAnthropic(
            api_key=settings.ANTHROPIC_API_KEY,
            timeout=float(settings.ANTHROPIC_TIMEOUT_SECONDS),
        )
        try:
            response = await client.messages.create(
                model=model,
                max_tokens=1024,
                temperature=0.2,
                system=SUGGEST_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_text}],
            )
        except anthropic.APITimeoutError as e:
            raise RecipeImportError(504, "KI-Service hat zu lange gebraucht") from e
        except anthropic.APIError as e:
            raise RecipeImportError(502, f"KI-Anbieter-Fehler: {e}") from e
        raw = "".join(b.text for b in response.content if getattr(b, "type", None) == "text")
        # Anthropic path: parse via the same forgiving extractor we use for
        # Ollama. No retry available here — Anthropic obeys system prompts
        # well enough that we don't loop.
        from app.services.ollama import extract_json as _extract
        try:
            parsed = _extract(raw)
        except json.JSONDecodeError as e:
            raise RecipeImportError(500, "Vorschläge konnten nicht extrahiert werden") from e
    else:
        ollama_model = await get_ollama_model(db)
        try:
            parsed = await call_text_json(
                user_text,
                system=SUGGEST_SYSTEM_PROMPT,
                model=ollama_model,
                temperature=0.2,
            )
        except OllamaError as e:
            raise _from_ollama_error(e) from e

    if isinstance(parsed, dict):
        # Some models wrap the array in {"suggestions":[...]} despite the prompt
        for v in parsed.values():
            if isinstance(v, list):
                parsed = v
                break
    if not isinstance(parsed, list):
        raise RecipeImportError(500, "Antwortformat unerwartet (kein Array)")

    valid_ids = {r["id"] for r in user_recipes}
    out: list[SuggestedRecipe] = []
    for entry in parsed[:3]:
        try:
            sug = SuggestedRecipe.model_validate(entry)
        except ValidationError:
            continue
        if sug.recipe_id in valid_ids:
            out.append(sug)
    return out
