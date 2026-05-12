"""Single entry point for every Ollama HTTP call in the codebase.

All categorization, recipe-import, suggestion, and vision calls go through
`call_text` or `call_vision` here. Two reasons:

  1. **keep_alive** — every request carries the configured keep_alive so
     the model stays resident in (V)RAM and the next call is instant.
     The text model is pinned forever (OLLAMA_TEXT_KEEP_ALIVE=-1), the
     vision model stays for an hour by default. Without this, Ollama
     would unload after 5 minutes of idle and the next call eats a
     30–180s reload.
  2. **No direct httpx** — having one place to set timeouts, options,
     headers, and error mapping means we can change Ollama-side behavior
     once instead of in five files.

`prewarm_text` is fired from the FastAPI lifespan to load the text model
before the first user request arrives.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class OllamaError(Exception):
    """Wraps every failure mode (network, HTTP 4xx/5xx, model missing, timeout).
    `status` is a sensible HTTP code callers can re-raise as HTTPException."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _coerce_keep_alive(raw: str) -> Any:
    """Ollama accepts either a duration string ("1h", "30m") or an int seconds
    value. "-1" and "0" must be sent as integers, not strings, otherwise the
    server treats them as 0 seconds and unloads immediately."""
    raw = (raw or "").strip()
    if raw in ("-1", "0"):
        return int(raw)
    try:
        return int(raw)
    except ValueError:
        return raw  # e.g. "1h", "30m", "10s"


def _build_options(temperature: float, max_tokens: int | None) -> dict[str, Any]:
    opts: dict[str, Any] = {"temperature": temperature}
    if max_tokens is not None:
        opts["num_predict"] = max_tokens
    return opts


async def _generate(
    *,
    model: str,
    prompt: str,
    system: str | None,
    keep_alive: Any,
    json_mode: bool,
    temperature: float,
    max_tokens: int | None,
    images: list[str] | None,
    timeout: float,
) -> str:
    body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "keep_alive": keep_alive,
        "options": _build_options(temperature, max_tokens),
    }
    if system:
        body["system"] = system
    if json_mode:
        body["format"] = "json"
    if images:
        body["images"] = images

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{settings.OLLAMA_BASE_URL}/api/generate", json=body)
            r.raise_for_status()
            data = r.json()
    except httpx.TimeoutException as e:
        logger.error("Ollama timeout (model=%s) after %ss", model, timeout)
        raise OllamaError(504, "KI-Service hat zu lange gebraucht") from e
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise OllamaError(
                503,
                f"Modell '{model}' ist nicht installiert. Per `ollama pull {model}` nachziehen.",
            ) from e
        logger.error("Ollama HTTP %s for model %s", e.response.status_code, model)
        raise OllamaError(502, "KI-Service-Fehler") from e
    except httpx.HTTPError as e:
        logger.error("Ollama unreachable at %s: %s", settings.OLLAMA_BASE_URL, e)
        raise OllamaError(503, "KI-Service nicht erreichbar") from e

    return data.get("response", "") or ""


async def call_text(
    prompt: str,
    *,
    system: str | None = None,
    model: str | None = None,
    json_mode: bool = False,
    temperature: float = 0.1,
    max_tokens: int | None = None,
    timeout: float | None = None,
) -> str:
    """Call the configured text model. Pass `model=` to override (admin DB
    selection is resolved by the caller, kept out of this module to stay
    DB-free)."""
    return await _generate(
        model=model or settings.OLLAMA_TEXT_MODEL,
        prompt=prompt,
        system=system,
        keep_alive=_coerce_keep_alive(settings.OLLAMA_TEXT_KEEP_ALIVE),
        json_mode=json_mode,
        temperature=temperature,
        max_tokens=max_tokens,
        images=None,
        timeout=timeout if timeout is not None else float(settings.OLLAMA_TIMEOUT_SECONDS),
    )


async def call_vision(
    prompt: str,
    image_base64: str,
    *,
    system: str | None = None,
    model: str | None = None,
    json_mode: bool = False,
    temperature: float = 0.1,
    max_tokens: int | None = None,
    timeout: float | None = None,
) -> str:
    """Call the configured vision model with a single base64-encoded image."""
    target = model or settings.OLLAMA_VISION_MODEL
    if not target:
        raise OllamaError(503, "Kein Vision-Modell konfiguriert (OLLAMA_VISION_MODEL)")
    return await _generate(
        model=target,
        prompt=prompt,
        system=system,
        keep_alive=_coerce_keep_alive(settings.OLLAMA_VISION_KEEP_ALIVE),
        json_mode=json_mode,
        temperature=temperature,
        max_tokens=max_tokens,
        images=[image_base64],
        timeout=timeout if timeout is not None else float(settings.OLLAMA_TIMEOUT_SECONDS),
    )


# ---------- Introspection: /api/tags and /api/ps ----------

async def list_installed_models() -> list[dict[str, Any]]:
    """Returns Ollama's full /api/tags `models` list (name, size, details, …)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
            r.raise_for_status()
            return list(r.json().get("models", []))
    except httpx.HTTPError as e:
        logger.error("Ollama /api/tags failed: %s", e)
        raise OllamaError(503, "KI-Service nicht erreichbar") from e


async def list_loaded_models() -> list[dict[str, Any]]:
    """Returns Ollama's /api/ps `models` list — the models currently held in
    (V)RAM. Each entry typically has name, size_vram, expires_at."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{settings.OLLAMA_BASE_URL}/api/ps")
            r.raise_for_status()
            return list(r.json().get("models", []))
    except httpx.HTTPError as e:
        logger.error("Ollama /api/ps failed: %s", e)
        raise OllamaError(503, "KI-Service nicht erreichbar") from e


# ---------- Pre-warming ----------

async def prewarm_text(model: str | None = None) -> bool:
    """Fire-and-log a tiny generate call so Ollama loads the text model into
    memory before the first user-facing request. Returns True on success.
    Never raises — startup must not depend on Ollama being up."""
    target = model or settings.OLLAMA_TEXT_MODEL
    try:
        # Short prompt, no system, tiny output. Crucially still passes
        # keep_alive so the model stays loaded after this warmup call.
        await _generate(
            model=target,
            prompt="Hi",
            system=None,
            keep_alive=_coerce_keep_alive(settings.OLLAMA_TEXT_KEEP_ALIVE),
            json_mode=False,
            temperature=0.0,
            max_tokens=4,
            images=None,
            timeout=float(settings.OLLAMA_TIMEOUT_SECONDS),
        )
        logger.info("Ollama text model '%s' pre-warmed (keep_alive=%s)",
                    target, settings.OLLAMA_TEXT_KEEP_ALIVE)
        return True
    except OllamaError as e:
        logger.warning("Ollama pre-warm failed (model=%s): %s — first user "
                       "request will pay the load cost", target, e.message)
        return False
    except Exception as e:  # noqa: BLE001 — startup must never fail because of warmup
        logger.warning("Ollama pre-warm crashed: %s", e)
        return False
