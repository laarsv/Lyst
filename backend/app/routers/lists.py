from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_client_id, require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.list import ListCreate, ListDuplicate, ListOut, ListUpdate
from app.services.list_service import (
    create_list,
    delete_list,
    duplicate_list,
    get_list_for_user,
    list_for_user,
    list_stats,
    reset_list,
    update_list,
)
from app.services.snapshot_service import save_snapshot
from app.services.ws_manager import manager as ws_manager

router = APIRouter(prefix="/lists", tags=["lists"])


def _list_out(lst, item_count: int, checked_count: int, is_owner: bool, permission: str | None) -> dict:
    return ListOut.model_validate(lst).model_copy(
        update={
            "item_count": item_count,
            "checked_count": checked_count,
            "is_owner": is_owner,
            "permission": permission,
        },
    ).model_dump(mode="json")


@router.get("")
async def get_lists(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_for_user(db, user.id, include_templates=False)
    return ok([_list_out(l, ic, cc, owner, perm) for l, ic, cc, owner, perm in rows])


@router.get("/templates")
async def get_templates(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_for_user(db, user.id, include_templates=True)
    return ok([_list_out(l, ic, cc, owner, perm) for l, ic, cc, owner, perm in rows])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_list(
    payload: ListCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    lst = await create_list(db, user.id, **payload.model_dump())
    return ok(_list_out(lst, 0, 0, True, None))


@router.get("/{list_id}")
async def get_list(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, perm = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    total, checked = await list_stats(db, list_id)
    return ok(_list_out(lst, total, checked, is_owner, perm))


@router.patch("/{list_id}")
async def patch_list(
    list_id: int,
    payload: ListUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, perm = await get_list_for_user(db, list_id, user.id, require_edit=True)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    lst = await update_list(db, lst, **payload.model_dump(exclude_unset=True))
    total, checked = await list_stats(db, list_id)
    return ok(_list_out(lst, total, checked, is_owner, perm))


@router.delete("/{list_id}")
async def del_list(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, _ = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    if not is_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner can delete")
    await delete_list(db, lst)
    return ok({"message": "Deleted"})


@router.post("/{list_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def post_duplicate(
    list_id: int,
    payload: ListDuplicate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        src, _, _ = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    new = await duplicate_list(
        db,
        src,
        user.id,
        title=payload.title,
        as_template=payload.as_template,
        template_name=payload.template_name,
    )
    total, checked = await list_stats(db, new.id)
    return ok(_list_out(new, total, checked, True, None))


@router.post("/{list_id}/reset")
async def post_reset(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    try:
        lst, _, _ = await get_list_for_user(db, list_id, user.id, require_edit=True)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    # Snapshot the current state *before* unchecking, so the user can later
    # restore this session from "Verlauf".
    if lst.items:
        await save_snapshot(db, lst)
    await reset_list(db, lst)
    await ws_manager.broadcast(
        list_id, {"type": "list_reset", "payload": {}}, exclude_client_id=client_id
    )
    return ok({"message": "List reset"})
