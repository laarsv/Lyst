"""Pure parser for Picnic recipe e-mails (.eml) — NO Ollama, no DB, no network.

Picnic (German grocery delivery) sends recipe e-mails in a stable layout. We
parse the text/plain part structurally and pull the hero-image URL out of the
text/html part. Kept dependency-free (stdlib only) so it's trivially unit-
testable; the orchestration (download image, dedup, create) lives in
`picnic_import_service`.

Format (confirmed against real mails):
  * Title *                         ← first "* … *" line
  N Personen · M Minuten            ← servings + prep time
  [400 g] Hähnchenbrustfilet        ← bracketed ingredients ([] = no qty)
  [2 Stk.] Zitrone
  Wok-Öl, Salz, Pfeffer und 1 Zehe Knoblauch   ← trailing collection line
  * So wird's gemacht! *            ← steps marker
  Schritt 1 …  Schritt 2 …          ← steps (split on "Schritt N")
  Tipp: …                           ← cut off (NOT a step)
  Wie findest du …                  ← rating block, cut off
"""
from __future__ import annotations

import email
import re
from dataclasses import dataclass, field
from email import policy
from html import unescape


@dataclass
class PicnicIngredient:
    name: str
    quantity: float | None = None
    unit: str | None = None


@dataclass
class PicnicParsed:
    title: str
    servings: int | None = None
    prep_time_minutes: int | None = None
    ingredients: list[PicnicIngredient] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    image_url: str | None = None
    # Stable per-recipe id from the image URL (…/recipes/<HASH>/1000x1000.png) —
    # the primary dedup key, robust to Picnic title typo-fixes/renames.
    image_hash: str | None = None


# Lowercased + period-stripped → canonical display unit.
_UNIT_MAP = {
    "g": "g", "kg": "kg", "mg": "mg", "ml": "ml", "l": "l",
    "el": "EL", "tl": "TL",
    "stk": "Stk", "stück": "Stk", "stueck": "Stk",
    "bund": "Bund", "pck": "Pck", "päckchen": "Pck", "packung": "Packung",
    "zehe": "Zehe", "zehen": "Zehe", "handvoll": "Handvoll",
    "prise": "Prise", "prisen": "Prise",
    "scheibe": "Scheiben", "scheiben": "Scheiben",
    "dose": "Dose", "dosen": "Dose", "tasse": "Tasse", "tassen": "Tasse",
    "stange": "Stange", "stangen": "Stangen",
}

_STEPS_MARKER = re.compile(r"so\s+wird'?s\s+gemacht", re.I)
_STOP_MARKER = re.compile(r"^\s*\*?\s*(tipp|wie findest du|guten appetit)\b", re.I)
_STEP_SPLIT = re.compile(r"Schritt\s*\d+\s*[:.)]?\s*", re.I)
_STAR_LINE = re.compile(r"^\s*\*\s*(.+?)\s*\*\s*$")
_BRACKET_LINE = re.compile(r"^\s*\[(.*?)\]\s*(.+?)\s*$")
# Real recipe image lives on a storefront…picnicinternational.com host under a
# /recipes/ path. Logos/footers are braze.eu; tracking pixels are elsewhere.
_PICNIC_IMG = re.compile(
    r"https://storefront[a-z0-9.\-]*picnicinternational\.com/[^\s\"'>)]*recipes[^\s\"'>)]*",
    re.I,
)


def _num(s: str) -> float | None:
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


def _canon_unit(token: str) -> str | None:
    return _UNIT_MAP.get(token.strip().rstrip(".").lower())


def _part(msg, content_type: str) -> str:
    """First decoded body of the given content-type, or ''. """
    for part in msg.walk():
        if part.get_content_type() == content_type and not part.is_multipart():
            try:
                return part.get_content()
            except Exception:
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(part.get_content_charset() or "utf-8", "replace")
    return ""


def _parse_bracket(bracket: str) -> tuple[float | None, str | None]:
    b = bracket.strip()
    if not b:
        return None, None
    m = re.match(r"^(\d+(?:[.,]\d+)?)\s*(.*)$", b)
    if not m:
        return None, None
    qty = _num(m.group(1))
    rest = m.group(2).strip()
    if not rest:
        return qty, None
    return qty, _canon_unit(rest) or rest.rstrip(".")


def _parse_loose(piece: str) -> PicnicIngredient | None:
    """A collection-line item: '1 Zehe Knoblauch' / '1 Zwiebel' / 'Wok-Öl'."""
    s = unescape(piece).strip().strip(".")
    if not s:
        return None
    m = re.match(r"^(\d+(?:[.,]\d+)?)\s+(.+)$", s)
    if m:
        qty = _num(m.group(1))
        rest = m.group(2).strip()
        head, _, tail = rest.partition(" ")
        unit = _canon_unit(head)
        if unit and tail.strip():
            return PicnicIngredient(name=tail.strip(), quantity=qty, unit=unit)
        # number + non-unit word → quantity, no unit (e.g. "1 Zwiebel")
        return PicnicIngredient(name=rest, quantity=qty, unit=None)
    return PicnicIngredient(name=s, quantity=None, unit=None)


def _clean_step(raw: str) -> str:
    txt = re.sub(r"<[^>]+>", " ", raw)  # strip any stray HTML (Picnic uses <strong>)
    txt = unescape(txt)
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r" +([,.;:!?])", r"\1", txt)  # tag-strip leaves "Salz ," → "Salz,"
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    return txt.strip()


def parse_picnic_eml(raw: bytes) -> PicnicParsed | None:
    """Parse a Picnic recipe .eml. Returns None when it doesn't look like one
    (no title, or no ingredients) so callers can fail loudly on format drift."""
    msg = email.message_from_bytes(raw, policy=policy.default)
    text = _part(msg, "text/plain")
    html = _part(msg, "text/html")
    subject = str(msg.get("subject", "") or "")

    if not text.strip() and not subject:
        return None

    lines = text.splitlines()

    # ---- title: first "* … *" line (skip the steps/tip markers) ----
    title = None
    for ln in lines:
        m = _STAR_LINE.match(ln)
        if m:
            cand = m.group(1).strip()
            if _STEPS_MARKER.search(cand) or _STOP_MARKER.match(cand):
                continue
            title = cand
            break
    if not title and subject:
        title = re.sub(r"^\s*Rezept:\s*", "", subject, flags=re.I).strip()
    if not title:
        return None

    # ---- servings + prep time ----
    servings = None
    prep = None
    sm = re.search(r"(\d+)\s*Personen", text, re.I)
    if sm:
        servings = int(sm.group(1))
    tm = re.search(r"(\d+)\s*Minuten", text, re.I)
    if tm:
        prep = int(tm.group(1))

    # ---- split body at the steps marker ----
    steps_idx = None
    for i, ln in enumerate(lines):
        if _STEPS_MARKER.search(ln):
            steps_idx = i
            break
    ingredient_lines = lines[:steps_idx] if steps_idx is not None else lines

    # ---- ingredients: bracketed lines + one trailing collection line ----
    ingredients: list[PicnicIngredient] = []
    last_bracket = -1
    for idx, ln in enumerate(ingredient_lines):
        bm = _BRACKET_LINE.match(ln)
        if bm:
            qty, unit = _parse_bracket(bm.group(1))
            name = unescape(bm.group(2)).strip()
            if name:
                ingredients.append(PicnicIngredient(name=name, quantity=qty, unit=unit))
                last_bracket = idx
    # Collection line: the FIRST non-bracketed "," / "und" line AFTER the
    # bracketed block (so a greeting like "Hallo, …" above it is never picked).
    for ln in ingredient_lines[last_bracket + 1:] if last_bracket >= 0 else []:
        s = ln.strip()
        if not s or _STAR_LINE.match(s) or _BRACKET_LINE.match(s):
            continue
        if re.search(r"Personen|Minuten", s, re.I):
            continue
        if "," in s or re.search(r"\bund\b", s, re.I):
            for p in re.split(r",|\bund\b", s, flags=re.I):
                ing = _parse_loose(p)
                if ing and ing.name:
                    ingredients.append(ing)
            break  # only the first such line

    if not ingredients:
        return None

    # ---- steps: region after the marker, cut before Tipp / rating ----
    steps: list[str] = []
    if steps_idx is not None:
        region_lines = lines[steps_idx + 1:]
        cut = len(region_lines)
        for i, ln in enumerate(region_lines):
            if _STOP_MARKER.match(ln):
                cut = i
                break
        region = "\n".join(region_lines[:cut])
        parts = _STEP_SPLIT.split(region)
        for chunk in parts:
            s = _clean_step(chunk)
            if s:
                steps.append(s)

    # ---- image URL + stable hash from the html part ----
    image_url = None
    image_hash = None
    if html:
        im = _PICNIC_IMG.search(html)
        if im:
            image_url = unescape(im.group(0))
            hm = re.search(r"/recipes/([^/?#]+)", image_url)
            if hm:
                image_hash = hm.group(1)

    return PicnicParsed(
        title=title,
        servings=servings,
        prep_time_minutes=prep,
        ingredients=ingredients,
        steps=steps,
        image_url=image_url,
        image_hash=image_hash,
    )
