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
    call_text,
    call_vision,
    list_installed_models,
)
from app.services.settings_service import (
    get_anthropic_model,
    get_llm_provider,
    get_ollama_model,
)

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 4000
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


def _extract_json(raw: str) -> dict[str, Any]:
    """Strip markdown fences / prose around the JSON body, then parse."""
    s = raw.strip()
    # Strip ``` or ```json fences if present
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    # If the model wrapped the JSON in prose, try to find the first {...} block
    if not s.lstrip().startswith("{"):
        match = re.search(r"\{[\s\S]*\}", s)
        if match:
            s = match.group(0)
    try:
        return json.loads(s)
    except json.JSONDecodeError as e:
        logger.error("LLM returned non-JSON response: %s", raw[:500])
        raise RecipeImportError(500, "Rezept konnte nicht extrahiert werden") from e


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

    # Concatenate any text blocks the model returned
    parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return _extract_json("".join(parts))


# ---------- Provider dispatch ----------

async def import_recipe_from_url(url: str, db: AsyncSession) -> ImportedRecipe:
    html = await _fetch_html(url)
    text = _clean_text(html)
    if not text:
        raise RecipeImportError(400, "Keine lesbaren Inhalte auf der Seite gefunden")

    provider = await get_llm_provider(db)
    if provider == "anthropic":
        model = await get_anthropic_model(db)
        parsed = await _call_anthropic(text, model)
    else:
        model = await get_ollama_model(db)
        try:
            raw = await call_text(
                text,
                system=SYSTEM_PROMPT,
                model=model,
                json_mode=True,
                temperature=0.1,
            )
        except OllamaError as e:
            raise _from_ollama_error(e) from e
        parsed = _extract_json(raw)
    parsed["source_url"] = url

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


# ---------- Photo import via Ollama vision model ----------

PHOTO_SYSTEM_PROMPT = SYSTEM_PROMPT  # same JSON contract


async def import_recipe_from_image(image_bytes: bytes) -> ImportedRecipe:
    """Send the uploaded image to a vision-capable Ollama model and parse
    the same recipe JSON shape as the URL importer."""
    b64 = base64.b64encode(image_bytes).decode("ascii")
    try:
        raw = await call_vision(
            (
                "Lies dieses Rezept-Bild und extrahiere es als strukturiertes Rezept. "
                "Antworte ausschließlich im vorgegebenen JSON-Format."
            ),
            b64,
            system=PHOTO_SYSTEM_PROMPT,
            json_mode=True,
            temperature=0.1,
        )
    except OllamaError as e:
        raise _from_ollama_error(e) from e

    parsed = _extract_json(raw)
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
    else:
        ollama_model = await get_ollama_model(db)
        try:
            raw = await call_text(
                user_text,
                system=SUGGEST_SYSTEM_PROMPT,
                model=ollama_model,
                json_mode=True,
                temperature=0.2,
            )
        except OllamaError as e:
            raise _from_ollama_error(e) from e

    # The model may return either a JSON array directly or a wrapped object.
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        parsed = json.loads(s)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", s)
        if not match:
            raise RecipeImportError(500, "Vorschläge konnten nicht extrahiert werden")
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as e:
            raise RecipeImportError(500, "Vorschläge konnten nicht extrahiert werden") from e
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
