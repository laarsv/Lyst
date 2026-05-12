from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal, get_db
from app.core.dependencies import get_client_id, require_user
from app.core.responses import ok
from app.models.list import CategorizationMode, List as ListModel, ListType
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


async def _list_mode(db: AsyncSession, list_id: int) -> tuple[ListType | None, CategorizationMode]:
    result = await db.execute(
        select(ListModel.type, ListModel.categorization_mode).where(ListModel.id == list_id)
    )
    row = result.one_or_none()
    if row is None:
        return None, CategorizationMode.OFF
    return row[0], row[1]


async def _categorize_in_background(list_id: int, item_id: int) -> None:
    """Runs after the POST response has been sent. Uses its own DB session
    (FastAPI's request-scoped session is gone by the time this fires).

    Skips items that already carry a category or are locked by the user.
    """
    async with AsyncSessionLocal() as db:
        item = (await db.execute(select(ListItem).where(ListItem.id == item_id))).scalar_one_or_none()
        if not item or item.category is not None or item.category_locked:
            return
        category = await categorize_item(db, item.text)
        if category is None:
            return
        item.category = category
        await db.commit()
        await db.refresh(item)
        await ws_manager.broadcast(
            list_id,
            {"type": "item_updated", "payload": ListItemOut.model_validate(item).model_dump(mode="json")},
        )


async def _categorize_set_in_background(list_id: int, item_ids: list[int], force: bool) -> None:
    """Categorize a fixed set of items, broadcasting each one as it lands so
    the frontend can update its progress counter live."""
    for iid in item_ids:
        async with AsyncSessionLocal() as db:
            item = (await db.execute(select(ListItem).where(ListItem.id == iid))).scalar_one_or_none()
            if not item:
                continue
            if not force and (item.category is not None or item.category_locked):
                continue
            category = await categorize_item(db, item.text)
            if category is None:
                continue
            item.category = category
            # The bulk run is system-driven, not user-driven, so locked stays
            # unchanged (force re-categorize doesn't lock either; locking is
            # only for explicit per-item user overrides).
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
    # Fire-and-forget categorization only when the list is in AUTO mode.
    # MANUAL leaves it null until the user hits "Jetzt kategorisieren".
    _t, mode = await _list_mode(db, list_id)
    if mode == CategorizationMode.AUTO:
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
    items = await bulk_create_items(
        db,
        list_id,
        lines=payload.lines,
        items=[i.model_dump() for i in payload.items] if payload.items else None,
    )
    out = [_item_out(it) for it in items]
    for o in out:
        await ws_manager.broadcast(
            list_id, {"type": "item_created", "payload": o}, exclude_client_id=client_id
        )
    _t, mode = await _list_mode(db, list_id)
    if mode == CategorizationMode.AUTO:
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
    patch = payload.model_dump(exclude_unset=True)
    # Treat any user-driven category change as a lock so the auto-categorizer
    # leaves it alone. Setting category=null also clears the lock.
    if "category" in patch:
        patch["category_locked"] = patch["category"] is not None
        # Apply the category fields inline so explicit nulls (clearing) stick;
        # update_item() filters out None values for backwards compatibility.
        item.category = patch.pop("category")
        item.category_locked = patch.pop("category_locked")
    item = await update_item(db, item, **patch) if patch else item
    if not patch:
        await db.commit()
        await db.refresh(item)
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
