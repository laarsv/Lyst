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
