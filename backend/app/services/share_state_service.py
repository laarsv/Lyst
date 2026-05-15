"""Bulk share-state lookups for the overview cards.

One round-trip per resource type returns a `{resource_id:
ShareState}` dict that the router maps onto its serialised rows.
Avoids the N+1 that you'd get from asking each note/list/recipe
"how many share rows do you have?" individually.

`share_enabled` (public token) is already on each resource's row —
the row's serialiser already knows it. We compute the INTERNAL
share-row count here. The caller assembles the final ShareState
dict with both halves.

Permission: the caller already filters to owner-side rows. We
don't double-check here — the count query is just an aggregate
over the share table for the ids the caller passed in.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collaborator import ListCollaborator
from app.models.note import NoteShare
from app.models.recipe import RecipeShare


async def note_internal_share_counts(
    db: AsyncSession, note_ids: list[int] | set[int]
) -> dict[int, int]:
    if not note_ids:
        return {}
    rows = await db.execute(
        select(NoteShare.note_id, func.count(NoteShare.id))
        .where(NoteShare.note_id.in_(list(note_ids)))
        .group_by(NoteShare.note_id)
    )
    return {nid: int(count) for nid, count in rows.all()}


async def list_internal_share_counts(
    db: AsyncSession, list_ids: list[int] | set[int]
) -> dict[int, int]:
    if not list_ids:
        return {}
    rows = await db.execute(
        select(ListCollaborator.list_id, func.count(ListCollaborator.id))
        .where(ListCollaborator.list_id.in_(list(list_ids)))
        .group_by(ListCollaborator.list_id)
    )
    return {lid: int(count) for lid, count in rows.all()}


async def recipe_internal_share_counts(
    db: AsyncSession, recipe_ids: list[int] | set[int]
) -> dict[int, int]:
    if not recipe_ids:
        return {}
    rows = await db.execute(
        select(RecipeShare.recipe_id, func.count(RecipeShare.id))
        .where(RecipeShare.recipe_id.in_(list(recipe_ids)))
        .group_by(RecipeShare.recipe_id)
    )
    return {rid: int(count) for rid, count in rows.all()}
