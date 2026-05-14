"""Compat shim — extract_json now lives in app.services.ollama, alongside
the call_text_json / call_vision_json wrappers that handle parse + retry
in one shot. Existing imports of `parse_llm_json` keep working via the
re-export below; new code should call `call_text_json` / `call_vision_json`
directly and skip the manual parse step entirely."""
from __future__ import annotations

from app.services.ollama import extract_json as parse_llm_json

__all__ = ["parse_llm_json"]
