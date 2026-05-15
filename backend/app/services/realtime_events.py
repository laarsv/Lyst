"""High-level emitters for the per-user real-time WebSocket channel.

Wraps `user_ws_manager.broadcast_to_users` with the access-set
lookups each resource type needs:
  - note: owner + every NoteShare recipient
  - list: owner + every ListCollaborator
  - list item: same as parent list
  - recipe: owner + every RecipeShare + every RecipeBookShare recipient
  - share: just the recipient (they're the one who needs to know
    something new appeared)

Every emitter is best-effort: failures are swallowed so a flaky WS
fan-out can't fail a save. The router has already committed the
mutation by the time we fire.

Event shape (matches the spec):
    {
      "event": "note.updated" | "list.item.updated" | ...,
      "resource_type": "note" | "list" | "list_item" | "share",
      "resource_id": <int>,
      "parent_id": <int | null>,   # e.g. list_id for an item event
      "actor_id": <int>,
      "timestamp": <iso8601>,
      "payload": { ... } | null    # small patch data; omitted for big diffs
    }

The frontend's user-channel dispatcher (useUserWebSocket) reads
event + resource_type to pick the right cache key to invalidate or
the right local state to patch.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collaborator import ListCollaborator
from app.models.list import List as ListModel
from app.models.note import Note, NoteShare
from app.models.recipe import Recipe, RecipeBookShare, RecipeShare
from app.services.user_ws_manager import user_manager

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _envelope(
    *,
    event: str,
    resource_type: str,
    resource_id: int,
    parent_id: int | None = None,
    actor_id: int,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "event": event,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "parent_id": parent_id,
        "actor_id": actor_id,
        "timestamp": _now_iso(),
        "payload": payload,
    }


# ---------------------------------------------------------------------------
# Access-set lookups — single query each, kept tiny
# ---------------------------------------------------------------------------

async def _list_audience(db: AsyncSession, list_id: int) -> set[int]:
    owner = (
        await db.execute(select(ListModel.owner_id).where(ListModel.id == list_id))
    ).scalar_one_or_none()
    out: set[int] = set()
    if owner is not None:
        out.add(owner)
    collab = await db.execute(
        select(ListCollaborator.user_id).where(ListCollaborator.list_id == list_id)
    )
    out.update(r for (r,) in collab.all())
    return out


async def _note_audience(db: AsyncSession, note_id: int) -> set[int]:
    owner = (
        await db.execute(select(Note.owner_id).where(Note.id == note_id))
    ).scalar_one_or_none()
    out: set[int] = set()
    if owner is not None:
        out.add(owner)
    shares = await db.execute(
        select(NoteShare.shared_with_user_id).where(NoteShare.note_id == note_id)
    )
    out.update(r for (r,) in shares.all())
    return out


async def _recipe_audience(db: AsyncSession, recipe_id: int) -> set[int]:
    owner = (
        await db.execute(select(Recipe.owner_id).where(Recipe.id == recipe_id))
    ).scalar_one_or_none()
    out: set[int] = set()
    if owner is None:
        return out
    out.add(owner)
    shares = await db.execute(
        select(RecipeShare.shared_with_user_id).where(RecipeShare.recipe_id == recipe_id)
    )
    out.update(r for (r,) in shares.all())
    # Whole-book recipients see every recipe owned by the same user.
    book = await db.execute(
        select(RecipeBookShare.shared_with_user_id).where(
            RecipeBookShare.owner_id == owner
        )
    )
    out.update(r for (r,) in book.all())
    return out


# ---------------------------------------------------------------------------
# Emitters
# ---------------------------------------------------------------------------

async def _safe_broadcast(
    audience: set[int],
    message: dict[str, Any],
    *,
    exclude_client_id: str | None,
) -> None:
    try:
        await user_manager.broadcast_to_users(
            audience, message, exclude_client_id=exclude_client_id
        )
    except Exception as e:  # pragma: no cover - WS fan-out is best-effort
        logger.warning("user WS broadcast failed: %s", e)


# Notes -----------------------------------------------------------------

async def emit_note_event(
    db: AsyncSession,
    note_id: int,
    event: str,
    *,
    actor_id: int,
    client_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """`event` is "note.created" / "note.updated" / "note.deleted".
    Audience is the note's owner + everyone it's shared with."""
    audience = await _note_audience(db, note_id)
    await _safe_broadcast(
        audience,
        _envelope(
            event=event,
            resource_type="note",
            resource_id=note_id,
            actor_id=actor_id,
            payload=payload,
        ),
        exclude_client_id=client_id,
    )


async def note_audience(db: AsyncSession, note_id: int) -> set[int]:
    """Public wrapper around _note_audience for callers that need to
    snapshot the audience BEFORE deleting the resource (cascade
    deletes the share rows we'd otherwise look up). Tiny but worth
    exposing rather than importing the leading-underscore name."""
    return await _note_audience(db, note_id)


async def emit_note_deleted(
    audience: set[int],
    note_id: int,
    *,
    actor_id: int,
    client_id: str | None = None,
) -> None:
    """Fan-out variant that takes a pre-computed audience. Used by
    DELETE /notes/{id} where the row is gone before we'd otherwise
    look up its shares."""
    await _safe_broadcast(
        audience,
        _envelope(
            event="note.deleted",
            resource_type="note",
            resource_id=note_id,
            actor_id=actor_id,
            payload=None,
        ),
        exclude_client_id=client_id,
    )


# Lists -----------------------------------------------------------------

async def emit_list_event(
    db: AsyncSession,
    list_id: int,
    event: str,
    *,
    actor_id: int,
    client_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """list.created / list.updated / list.deleted."""
    audience = await _list_audience(db, list_id)
    await _safe_broadcast(
        audience,
        _envelope(
            event=event,
            resource_type="list",
            resource_id=list_id,
            actor_id=actor_id,
            payload=payload,
        ),
        exclude_client_id=client_id,
    )


async def emit_list_item_event(
    db: AsyncSession,
    list_id: int,
    item_id: int,
    event: str,
    *,
    actor_id: int,
    client_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """list.item.created / list.item.updated / list.item.deleted /
    list.item.reordered. parent_id is the list_id."""
    audience = await _list_audience(db, list_id)
    await _safe_broadcast(
        audience,
        _envelope(
            event=event,
            resource_type="list_item",
            resource_id=item_id,
            parent_id=list_id,
            actor_id=actor_id,
            payload=payload,
        ),
        exclude_client_id=client_id,
    )


# Recipes ---------------------------------------------------------------

async def emit_recipe_event(
    db: AsyncSession,
    recipe_id: int,
    event: str,
    *,
    actor_id: int,
    client_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    audience = await _recipe_audience(db, recipe_id)
    await _safe_broadcast(
        audience,
        _envelope(
            event=event,
            resource_type="recipe",
            resource_id=recipe_id,
            actor_id=actor_id,
            payload=payload,
        ),
        exclude_client_id=client_id,
    )


# Shares ----------------------------------------------------------------

async def emit_share_event(
    *,
    recipient_id: int,
    actor_id: int,
    resource_type: str,
    resource_id: int,
    event: str,
    client_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """share.created / share.revoked. Audience is just the recipient —
    they're the one who needs to know something new appeared (or
    disappeared) in their overview. The owner already knows; they
    just did it.

    Doesn't need a DB lookup — caller already has the recipient id."""
    await _safe_broadcast(
        {recipient_id},
        _envelope(
            event=event,
            resource_type=resource_type,
            resource_id=resource_id,
            actor_id=actor_id,
            payload=payload,
        ),
        exclude_client_id=client_id,
    )
