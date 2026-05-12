from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal, get_db
from app.core.dependencies import get_client_id, require_user
from app.core.responses import ok
from app.models.list import List as ListModel, ListType
from app.models.list_item import ListItem
from app.models.user import User
from app.schemas.list_item import (
    BulkItemsCreate,
    ListItemCreate,
    ListItemOut,
    ListItemUpdate,
    ReorderRequest,
)
from app.services.category_service import categorize_item
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
from app.services.ws_manager import manager as ws_manager

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


async def _list_is_shopping(db: AsyncSession, list_id: int) -> bool:
    result = await db.execute(select(ListModel.type).where(ListModel.id == list_id))
    row = result.scalar_one_or_none()
    return row == ListType.SHOPPING


async def _categorize_in_background(list_id: int, item_id: int) -> None:
    """Runs after the POST response has been sent. Uses its own DB session
    (FastAPI's request-scoped session is gone by the time this fires)."""
    async with AsyncSessionLocal() as db:
        item_result = await db.execute(select(ListItem).where(ListItem.id == item_id))
        item = item_result.scalar_one_or_none()
        if not item or item.category is not None:
            return
        category = await categorize_item(db, item.text)
        if category is None:
            # Ollama unreachable — leave the item uncategorized; the UI shows
            # "Wird kategorisiert…" forever, that's fine — better than guessing.
            return
        item.category = category
        await db.commit()
        await db.refresh(item)
        await ws_manager.broadcast(
            list_id,
            {"type": "item_updated", "payload": ListItemOut.model_validate(item).model_dump(mode="json")},
        )


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
    background: BackgroundTasks,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await _ensure_edit(db, list_id, user.id)
    item = await create_item(db, list_id, **payload.model_dump())
    out = _item_out(item)
    await ws_manager.broadcast(
        list_id, {"type": "item_created", "payload": out}, exclude_client_id=client_id
    )
    # Fire-and-forget categorization for SHOPPING items. The Ollama call
    # can take seconds and we don't want to delay the POST response.
    if await _list_is_shopping(db, list_id):
        background.add_task(_categorize_in_background, list_id, item.id)
    return ok(out)


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
async def post_bulk(
    list_id: int,
    payload: BulkItemsCreate,
    background: BackgroundTasks,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await _ensure_edit(db, list_id, user.id)
    items = await bulk_create_items(db, list_id, payload.lines)
    out = [_item_out(it) for it in items]
    for o in out:
        await ws_manager.broadcast(
            list_id, {"type": "item_created", "payload": o}, exclude_client_id=client_id
        )
    if await _list_is_shopping(db, list_id):
        for it in items:
            background.add_task(_categorize_in_background, list_id, it.id)
    return ok(out)


@router.patch("/reorder")
async def patch_reorder(
    list_id: int,
    payload: ReorderRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await _ensure_edit(db, list_id, user.id)
    positions = [(i.id, i.position) for i in payload.items]
    await reorder_items(db, list_id, positions)
    await ws_manager.broadcast(
        list_id,
        {
            "type": "item_reordered",
            "payload": [{"id": i, "position": p} for i, p in positions],
        },
        exclude_client_id=client_id,
    )
    return ok({"message": "Reordered"})


@router.patch("/{item_id}")
async def patch_item(
    list_id: int,
    item_id: int,
    payload: ListItemUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await _ensure_edit(db, list_id, user.id)
    item = await get_item(db, list_id, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    item = await update_item(db, item, **payload.model_dump(exclude_unset=True))
    out = _item_out(item)
    await ws_manager.broadcast(
        list_id, {"type": "item_updated", "payload": out}, exclude_client_id=client_id
    )
    return ok(out)


@router.delete("/{item_id}")
async def del_item(
    list_id: int,
    item_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    await _ensure_edit(db, list_id, user.id)
    item = await get_item(db, list_id, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    await delete_item(db, item)
    await ws_manager.broadcast(
        list_id,
        {"type": "item_deleted", "payload": {"id": item_id}},
        exclude_client_id=client_id,
    )
    return ok({"message": "Deleted"})
