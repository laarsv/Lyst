"""Picnic grocery integration: Lyst list items -> Picnic cart. It NEVER orders.

Talks to the optional `picnic-sidecar` container over the internal Docker network
(one shared household Picnic account). Matching a list term to a product is
deliberately suggestion-only: a remembered mapping wins, otherwise the user picks
from ranked candidates in a preview and that choice can be remembered. Nothing is
ever added to the cart without an explicit confirmation from the caller.
"""
from __future__ import annotations

import asyncio
import logging
import re

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.list_item import ListItem
from app.models.picnic_mapping import PicnicMapping

logger = logging.getLogger(__name__)

# The first search after a sidecar start also scans the order history, which is slow.
_SEARCH_TIMEOUT_S = 90.0
_DEFAULT_TIMEOUT_S = 20.0
_SEARCH_CONCURRENCY = 3
_MAX_CANDIDATES = 5
_MAX_COUNT = 99


class PicnicError(Exception):
    """Base for everything the router maps to a user-facing message."""


class PicnicNotConfigured(PicnicError):
    """PICNIC_SIDECAR_TOKEN is not set — the integration is switched off."""


class PicnicNotConnected(PicnicError):
    """The sidecar is up but has no valid Picnic login (run login.mjs)."""


class PicnicUnavailable(PicnicError):
    """Picnic (via the sidecar) returned an error — may be specific to one request."""


class PicnicSidecarUnavailable(PicnicUnavailable):
    """The sidecar itself is unusable (unreachable, timed out, token rejected), so every
    request would fail the same way — callers must abort instead of degrading per item."""


def is_configured() -> bool:
    return bool(settings.PICNIC_SIDECAR_TOKEN)


# --------------------------------------------------------------------------- #
# Sidecar client
# --------------------------------------------------------------------------- #
async def _call(
    method: str,
    path: str,
    *,
    params: dict | None = None,
    json: dict | None = None,
    timeout: float = _DEFAULT_TIMEOUT_S,
) -> dict:
    if not is_configured():
        raise PicnicNotConfigured()
    try:
        async with httpx.AsyncClient(
            base_url=settings.PICNIC_SIDECAR_URL, timeout=timeout
        ) as client:
            resp = await client.request(
                method,
                path,
                params=params,
                json=json,
                headers={"Authorization": f"Bearer {settings.PICNIC_SIDECAR_TOKEN}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("picnic sidecar unreachable: %s", exc.__class__.__name__)
        raise PicnicSidecarUnavailable("Picnic-Dienst nicht erreichbar") from exc

    if resp.status_code == 409:
        raise PicnicNotConnected()
    if resp.status_code in (401, 403):
        logger.warning("picnic sidecar rejected the token (%s)", resp.status_code)
        raise PicnicSidecarUnavailable("Picnic-Dienst lehnt das Token ab (PICNIC_SIDECAR_TOKEN prüfen)")
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("message") or resp.json().get("error")
        except ValueError:
            detail = None
        logger.warning("picnic sidecar %s %s -> %s %s", method, path, resp.status_code, detail)
        raise PicnicUnavailable(detail or f"Picnic-Dienst antwortete mit {resp.status_code}")
    return resp.json()


async def get_status() -> dict:
    """{configured, connected}. Never raises: a down sidecar just reads as not connected."""
    if not is_configured():
        return {"configured": False, "connected": False}
    try:
        data = await _call("GET", "/status")
    except PicnicError:
        return {"configured": True, "connected": False}
    return {"configured": True, "connected": bool(data.get("connected"))}


async def search(term: str) -> list[dict]:
    data = await _call("GET", "/search", params={"q": term}, timeout=_SEARCH_TIMEOUT_S)
    return data.get("results", [])


async def get_cart() -> dict:
    return await _call("GET", "/cart")


async def add_to_cart(items: list[dict]) -> dict:
    """items: [{"id": picnic_product_id, "count": int}]. Returns the sidecar's cart summary."""
    return await _call("POST", "/cart/add", json={"items": items})


# --------------------------------------------------------------------------- #
# Term parsing + ranking (pure)
# --------------------------------------------------------------------------- #
# "2 Eier" / "2x Eier" -> count 2. Deliberately NOT "500g Mehl" (digit run followed by a
# unit): the (?=\D) lookahead and \s+ make that fail to match, so it stays a plain term.
_COUNT_RE = re.compile(r"^\s*(\d{1,2})\s*(?:x|×)?\s+(?=\D)", re.IGNORECASE)


def normalize_term(text: str) -> str:
    """Lower-case, collapse whitespace, drop trailing punctuation. '' if nothing is left."""
    cleaned = re.sub(r"\s+", " ", text.strip().lower()).strip(" .,;:!?")
    return cleaned[:100]


def parse_item(text: str, quantity: float | None = None, unit: str | None = None) -> tuple[str, int]:
    """(normalised term, count) for a list item. Count comes from a leading integer in the
    text, else from a unit-less integer `quantity`, else 1."""
    count = 1
    rest = text
    match = _COUNT_RE.match(text)
    if match:
        count, rest = int(match.group(1)), text[match.end():]
    elif quantity and not unit and float(quantity).is_integer():
        count = int(quantity)
    return normalize_term(rest), max(1, min(count, _MAX_COUNT))


def _name_matches(term: str, name: str) -> bool:
    lowered = name.lower()
    return all(word in lowered for word in term.split())


def rank_candidates(
    term: str, products: list[dict], mapping: PicnicMapping | None = None
) -> tuple[list[dict], str | None]:
    """(candidates, preselected product id). Order: remembered mapping, then products whose
    name contains every word of the term, then everything else — each group by recent
    purchase count, then Picnic's own order. Something is preselected only when we are
    confident (a mapping, or a name match that was bought before); otherwise the user picks."""
    candidates: list[dict] = []
    skip_id = None
    if mapping is not None:
        found = next((p for p in products if p["id"] == mapping.product_id), None)
        # The mapped product may not be in this search's results; still offer it, from the snapshot.
        candidates.append(
            {
                **(
                    found
                    or {
                        "id": mapping.product_id,
                        "name": mapping.product_name,
                        "price_cents": None,
                        "unit": None,
                        "image_id": None,
                        "bought": 0,
                    }
                ),
                "reason": "mapping",
            }
        )
        skip_id = mapping.product_id

    indexed = [(i, p) for i, p in enumerate(products) if p["id"] != skip_id]
    indexed.sort(
        key=lambda ip: (
            0 if _name_matches(term, ip[1]["name"]) else 1,
            -ip[1].get("bought", 0),
            ip[0],
        )
    )
    for _, p in indexed:
        matches = _name_matches(term, p["name"])
        reason = "match_bought" if matches and p.get("bought", 0) > 0 else ("match" if matches else "other")
        candidates.append({**p, "reason": reason})

    candidates = candidates[:_MAX_CANDIDATES]
    preselected = None
    if candidates and candidates[0]["reason"] in ("mapping", "match_bought"):
        preselected = candidates[0]["id"]
    return candidates, preselected


# --------------------------------------------------------------------------- #
# Mappings
# --------------------------------------------------------------------------- #
async def list_mappings(db: AsyncSession) -> list[PicnicMapping]:
    result = await db.execute(select(PicnicMapping).order_by(PicnicMapping.term))
    return list(result.scalars())


async def remember_mapping(
    db: AsyncSession, *, term: str, product_id: str, product_name: str, user_id: int | None
) -> PicnicMapping:
    """Upsert by normalised term: confirming a term again replaces its product."""
    normalized = normalize_term(term)
    if not normalized:
        raise ValueError("Leerer Begriff")
    existing = (
        await db.execute(select(PicnicMapping).where(PicnicMapping.term == normalized))
    ).scalar_one_or_none()
    if existing is None:
        existing = PicnicMapping(term=normalized, created_by_id=user_id)
        db.add(existing)
    existing.product_id = product_id
    existing.product_name = product_name[:255]
    await db.commit()
    await db.refresh(existing)
    return existing


async def delete_mapping(db: AsyncSession, mapping_id: int) -> bool:
    mapping = await db.get(PicnicMapping, mapping_id)
    if mapping is None:
        return False
    await db.delete(mapping)
    await db.commit()
    return True


# --------------------------------------------------------------------------- #
# Preview
# --------------------------------------------------------------------------- #
async def build_preview(db: AsyncSession, items: list[ListItem]) -> list[dict]:
    """One entry per item: {item_id, text, term, count, candidates, preselected, error}.
    Not-configured / not-connected / sidecar-unusable abort the whole preview; a Picnic
    error for a single term only blanks that item (error set), so one bad lookup never
    loses the rest."""
    parsed = [(it, *parse_item(it.text, it.quantity, it.unit)) for it in items]
    terms = {term for _, term, _ in parsed if term}

    mappings: dict[str, PicnicMapping] = {}
    if terms:
        rows = await db.execute(select(PicnicMapping).where(PicnicMapping.term.in_(terms)))
        mappings = {m.term: m for m in rows.scalars()}

    sem = asyncio.Semaphore(_SEARCH_CONCURRENCY)

    async def lookup(term: str) -> tuple[list[dict], str | None]:
        async with sem:
            try:
                return await search(term), None
            except (PicnicNotConfigured, PicnicNotConnected, PicnicSidecarUnavailable):
                raise
            except PicnicError as exc:
                return [], str(exc)

    ordered_terms = sorted(terms)
    results = await asyncio.gather(*(lookup(t) for t in ordered_terms))
    by_term = dict(zip(ordered_terms, results))

    preview: list[dict] = []
    for item, term, count in parsed:
        products, error = by_term.get(term, ([], None))
        candidates, preselected = rank_candidates(term, products, mappings.get(term)) if term else ([], None)
        preview.append(
            {
                "item_id": item.id,
                "text": item.text,
                "term": term,
                "count": count,
                "candidates": candidates,
                "preselected": preselected,
                "error": error,
            }
        )
    return preview
