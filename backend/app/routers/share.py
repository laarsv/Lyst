from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.share import (
    CollaboratorInvite,
    CollaboratorOut,
    PublicList,
    PublicListItem,
    ShareEnableResponse,
)
from app.services.list_service import get_list_for_user
from app.services.share_service import (
    add_collaborator,
    disable_share,
    enable_share,
    get_public_list,
    list_collaborators,
    remove_collaborator,
)

router = APIRouter(tags=["share"])


@router.post("/lists/{list_id}/share/enable")
async def share_enable(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, _ = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    if not is_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner can share")
    token, url, qr = await enable_share(db, lst)
    return ok(
        ShareEnableResponse(share_token=token, share_url=url, qr_code_png_base64=qr).model_dump()
    )


@router.post("/lists/{list_id}/share/disable")
async def share_disable(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, _ = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    if not is_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner can unshare")
    await disable_share(db, lst)
    return ok({"message": "Share disabled"})


@router.get("/share/{token}")
async def public_share(token: str, db: AsyncSession = Depends(get_db)):
    lst = await get_public_list(db, token)
    if not lst:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    items = [PublicListItem.model_validate(it) for it in sorted(lst.items, key=lambda i: i.position)]
    return ok(
        PublicList(
            title=lst.title,
            type=lst.type,
            description=lst.description,
            color=lst.color,
            icon=lst.icon,
            updated_at=lst.updated_at,
            items=items,
        ).model_dump(mode="json")
    )


@router.get("/lists/{list_id}/collaborators")
async def get_collaborators(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    rows = await list_collaborators(db, list_id)
    return ok(
        [
            CollaboratorOut(
                user_id=u.id, email=u.email, name=u.name, permission=c.permission
            ).model_dump(mode="json")
            for c, u in rows
        ]
    )


@router.post("/lists/{list_id}/collaborators", status_code=status.HTTP_201_CREATED)
async def post_collaborator(
    list_id: int,
    payload: CollaboratorInvite,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, _ = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    if not is_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner can invite")
    try:
        coll, target = await add_collaborator(db, list_id, payload.email, payload.permission)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok(
        CollaboratorOut(
            user_id=target.id, email=target.email, name=target.name, permission=coll.permission
        ).model_dump(mode="json")
    )


@router.delete("/lists/{list_id}/collaborators/{user_id}")
async def del_collaborator(
    list_id: int,
    user_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, _ = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    if not is_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner can remove")
    try:
        await remove_collaborator(db, list_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok({"message": "Removed"})


# =============================================================================
#  Public recipe + recipe-book views (no auth)
# =============================================================================
#
# Mounted on the same `share` router so all public surfaces share a prefix.
# Read-only — no edit / delete / collab routes here.

from app.schemas.recipe import (
    IngredientOut as _IngredientOut,
    PublicRecipe,
    PublicRecipeBook,
    PublicRecipeBookEntry,
    StepOut as _StepOut,
)
from app.services.recipe_service import get_public_book, get_public_recipe


@router.get("/share/recipe/{token}")
async def public_recipe(token: str, db: AsyncSession = Depends(get_db)):
    rec = await get_public_recipe(db, token)
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return ok(
        PublicRecipe(
            title=rec.title,
            description=rec.description,
            servings=rec.servings,
            prep_time_minutes=rec.prep_time_minutes,
            cook_time_minutes=rec.cook_time_minutes,
            image_url=rec.image_url,
            source_url=rec.source_url,
            tags=list(rec.tags or []),
            updated_at=rec.updated_at,
            ingredients=[
                _IngredientOut.model_validate(i)
                for i in sorted(rec.ingredients, key=lambda x: x.position)
            ],
            steps=[
                _StepOut.model_validate(s)
                for s in sorted(rec.steps, key=lambda x: x.position)
            ],
        ).model_dump(mode="json")
    )


@router.get("/share/recipe-book/{token}")
async def public_recipe_book(token: str, db: AsyncSession = Depends(get_db)):
    result = await get_public_book(db, token)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    user, rows = result
    return ok(
        PublicRecipeBook(
            owner_name=user.name,
            recipes=[
                PublicRecipeBookEntry.model_validate(r).model_copy(
                    update={
                        "ingredient_count": ic,
                        # Surface per-recipe tokens only when that recipe is
                        # also share-enabled — otherwise the deep-link 404s
                        # and the user gets a confusing experience. Card stays
                        # un-clickable in that case (frontend handles it).
                        "share_token": r.share_token if r.share_enabled else None,
                    }
                )
                for r, ic in rows
            ],
        ).model_dump(mode="json")
    )


# =============================================================================
#  Public note view (no auth) — alembic 0013
# =============================================================================

from app.schemas.note import PublicNote
from app.services.note_share_service import get_public_note


@router.get("/share/note/{token}")
async def public_note(token: str, db: AsyncSession = Depends(get_db)):
    note = await get_public_note(db, token)
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return ok(
        PublicNote(
            title=note.title,
            content=note.content or "",
            content_format=note.content_format,
            tags=list(note.tags or []),
            updated_at=note.updated_at,
        ).model_dump(mode="json")
    )
