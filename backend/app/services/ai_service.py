"""Tiny shared helpers for the AI feature endpoints.

Every AI endpoint follows the same pattern:
  1. Build a system prompt + user prompt.
  2. `call_text(user_prompt, system=..., json_mode=True)` (centralised Ollama).
  3. Parse the (sometimes-fence-wrapped, sometimes-prose-prefixed) JSON.
  4. Validate against a Pydantic schema.
  5. Map OllamaError → HTTPException with a clear German message.

Step 3 is the only fiddly part — we put it here so every endpoint reuses
the same forgiving parser. Nothing else lives here on purpose; the actual
prompts and validation belong with the endpoints that use them.
"""
from __future__ import annotations

import json
import re
from typing import Any


def parse_llm_json(raw: str) -> Any:
    """Strip ``` / ```json fences and surrounding prose, then `json.loads`.

    Raises `json.JSONDecodeError` on failure — caller should translate that
    into an HTTPException with a user-friendly message. Returns whatever the
    JSON parser returns (dict, list, scalar — leave validation to the caller).
    """
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    head = s.lstrip()[:1]
    if head not in {"{", "["}:
        # Find the first balanced-ish JSON-looking block. We don't try to
        # be perfect — just grab from the first opener to the matching last
        # closer, json.loads will reject anything malformed.
        m = re.search(r"[\[\{][\s\S]*[\]\}]", s)
        if m:
            s = m.group(0)
    return json.loads(s)
