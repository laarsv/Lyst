from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.collaborator import ListCollaborator
from app.models.list import List as ListModel
from app.models.list_item import ListItem
from app.models.note import Note
from app.models.recipe import Recipe, RecipeIngredient
from app.models.user import User

router = APIRouter(prefix="/search", tags=["search"])

PER_GROUP_LIMIT = 20


def _snippet(text: str, needle: str, ctx: int = 60) -> str | None:
    """Return a small excerpt around the first match of `needle` in `text`."""
    if not text:
        return None
    idx = text.lower().find(needle.lower())
    if idx == -1:
        return None
    start = max(0, idx - ctx)
    end = min(len(text), idx + len(needle) + ctx)
    snip = text[start:end].replace("\n", " ").strip()
    return ("…" if start > 0 else "") + snip + ("…" if end < len(text) else "")


@router.get("")
async def global_search(
    q: str = Query(..., min_length=2, max_length=128),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    needle = q.strip()
    like = f"%{needle.lower()}%"

    # ---------- Notes (own only, exclude archived) ----------
    # Tags live in a Postgres ARRAY(String). Flatten them into a space-
    # separated string and LIKE against that — same idiom as the recipes
    # block below — so a query of "kw" matches a note tagged "#KW".
    note_tags_blob = func.lower(func.array_to_string(Note.tags, " "))
    notes_stmt = (
        select(Note)
        .where(Note.owner_id == user.id, Note.is_archived.is_(False))
        .where(
            or_(
                func.lower(Note.title).like(like),
                func.lower(Note.content).like(like),
                note_tags_blob.like(like),
            )
        )
        .order_by(Note.is_pinned.desc(), Note.updated_at.desc())
        .limit(PER_GROUP_LIMIT)
    )
    notes_res = await db.execute(notes_stmt)
    notes_out: list[dict[str, Any]] = []
    for n in notes_res.scalars().all():
        notes_out.append(
            {
                "id": n.id,
                "title": n.title,
                "snippet": _snippet(n.content, needle) or "",
                "folder_id": n.folder_id,
                "is_pinned": n.is_pinned,
                "tags": list(n.tags or []),
            }
        )

    # ---------- Lists (own + collaborator-shared) ----------
    own_lists_stmt = select(ListModel.id).where(ListModel.owner_id == user.id)
    shared_lists_stmt = (
        select(ListCollaborator.list_id).where(ListCollaborator.user_id == user.id)
    )
    accessible = own_lists_stmt.union(shared_lists_stmt).subquery()

    # Lists where the title matches OR any item text matches
    matched_by_item = (
        select(ListItem.list_id)
        .where(func.lower(ListItem.text).like(like))
        .distinct()
        .subquery()
    )
    lists_stmt = (
        select(ListModel)
        .where(ListModel.id.in_(select(accessible.c.id)))
        .where(ListModel.is_template.is_(False))
        .where(
            or_(
                func.lower(ListModel.title).like(like),
                ListModel.id.in_(select(matched_by_item.c.list_id)),
            )
        )
        .order_by(ListModel.updated_at.desc())
        .limit(PER_GROUP_LIMIT)
    )
    lists_res = await db.execute(lists_stmt)
    list_objs = list(lists_res.scalars().all())

    # Look up the matching item per list (best-effort, just one for the snippet)
    list_item_map: dict[int, str] = {}
    if list_objs:
        item_match = await db.execute(
            select(ListItem)
            .where(ListItem.list_id.in_([l.id for l in list_objs]))
            .where(func.lower(ListItem.text).like(like))
        )
        for item in item_match.scalars().all():
            list_item_map.setdefault(item.list_id, item.text)

    lists_out = [
        {
            "id": l.id,
            "title": l.title,
            "icon": l.icon,
            "color": l.color,
            "type": l.type.value,
            "matched_item": list_item_map.get(l.id),
        }
        for l in list_objs
    ]

    # ---------- Recipes (own only) ----------
    matched_by_ingredient = (
        select(RecipeIngredient.recipe_id)
        .where(func.lower(RecipeIngredient.name).like(like))
        .distinct()
        .subquery()
    )
    recipe_tags_blob = func.lower(func.array_to_string(Recipe.tags, " "))
    recipes_stmt = (
        select(Recipe)
        .options(selectinload(Recipe.ingredients))
        .where(Recipe.owner_id == user.id)
        .where(
            or_(
                func.lower(Recipe.title).like(like),
                func.lower(func.coalesce(Recipe.description, "")).like(like),
                recipe_tags_blob.like(like),
                Recipe.id.in_(select(matched_by_ingredient.c.recipe_id)),
            )
        )
        .order_by(Recipe.updated_at.desc())
        .limit(PER_GROUP_LIMIT)
    )
    recipes_res = await db.execute(recipes_stmt)
    recipes_out: list[dict[str, Any]] = []
    for r in recipes_res.scalars().all():
        ing_match = next(
            (ing.name for ing in r.ingredients if needle.lower() in ing.name.lower()),
            None,
        )
        recipes_out.append(
            {
                "id": r.id,
                "title": r.title,
                "category": r.category.value,
                "image_url": r.image_url,
                "snippet": _snippet(r.description or "", needle),
                "matched_ingredient": ing_match,
                "tags": list(r.tags or []),
            }
        )

    return ok({"notes": notes_out, "lists": lists_out, "recipes": recipes_out, "query": needle})
