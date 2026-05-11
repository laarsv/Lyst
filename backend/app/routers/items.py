from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.list_item import (
    BulkItemsCreate,
    ListItemCreate,
    ListItemOut,
    ListItemUpdate,
    ReorderRequest,
)
from app.services.item_service import (
    bulk_create_items,
    create_item,
    delete_item,
    get_item,
    list_items,
    reorder_items,
    update_item,
)
from app.services.list_service import get_list_for_user

router = APIRouter(prefix="/lists/{list_id}/items", tags=["items"])


def _item_out(it) -> dict:
    return ListItemOut.model_validate(it).model_dump(mode="json")


async def _ensure_edit(db: AsyncSession, list_id: int, user_id: int) -> None:
    try:
        await get_list_for_user(db, list_id, user_id, require_edit=True)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))


@router.get("")
async def get_items(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    items = await list_items(db, list_id)
    return ok([_item_out(it) for it in items])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_item(
    list_id: int,
    payload: ListItemCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_edit(db, list_id, user.id)
    item = await create_item(db, list_id, **payload.model_dump())
    return ok(_item_out(item))


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
async def post_bulk(
    list_id: int,
    payload: BulkItemsCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_edit(db, list_id, user.id)
    items = await bulk_create_items(db, list_id, payload.lines)
    return ok([_item_out(it) for it in items])


@router.patch("/reorder")
async def patch_reorder(
    list_id: int,
    payload: ReorderRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_edit(db, list_id, user.id)
    await reorder_items(db, list_id, [(i.id, i.position) for i in payload.items])
    return ok({"message": "Reordered"})


@router.patch("/{item_id}")
async def patch_item(
    list_id: int,
    item_id: int,
    payload: ListItemUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_edit(db, list_id, user.id)
    item = await get_item(db, list_id, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    item = await update_item(db, item, **payload.model_dump(exclude_unset=True))
    return ok(_item_out(item))


@router.delete("/{item_id}")
async def del_item(
    list_id: int,
    item_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_edit(db, list_id, user.id)
    item = await get_item(db, list_id, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    await delete_item(db, item)
    return ok({"message": "Deleted"})
