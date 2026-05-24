"""Permission helpers for the recipes routers (alembic 0014).

Lives in its own module so all four recipes_*.py sub-routers can import
the same gate without circular re-imports back from the main recipes
module. Both helpers raise the HTTP-layer exceptions directly, so this
is HTTP-layer code despite the "looks like services/" feel.

  require_recipe_edit       → owner OR EDIT recipient; for mutating endpoints
  recipe_with_any_access    → owner OR any-permission recipient; for
                              read-derivative writes that create resources
                              owned by the caller (duplicate, copy-to-list)
"""
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collaborator import CollaboratorPermission
from app.models.recipe import Recipe
from app.services.recipe_service import get_accessible_recipe


async def require_recipe_edit(
    db: AsyncSession, recipe_id: int, user_id: int
) -> Recipe:
    """Owner OR EDIT recipient. Use for content-mutating endpoints."""
    try:
        rec, _, perm = await get_accessible_recipe(db, recipe_id, user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if perm != CollaboratorPermission.EDIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Du hast keine Bearbeitungsrechte für dieses Rezept.",
        )
    return rec


async def recipe_with_any_access(
    db: AsyncSession, recipe_id: int, user_id: int
) -> Recipe:
    """Owner OR any-permission recipient. Use for read-derivative writes
    that create resources owned by the caller (duplicate, copy-to-list)."""
    try:
        rec, _, _ = await get_accessible_recipe(db, recipe_id, user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return rec
