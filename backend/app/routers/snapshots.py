from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.snapshot import RestoreResponse, SnapshotOut
from app.services.list_service import get_list_for_user
from app.services.snapshot_service import (
    get_snapshot,
    list_snapshots,
    restore_snapshot,
    save_snapshot,
)

router = APIRouter(prefix="/lists/{list_id}/snapshots", tags=["snapshots"])


def _snap_out(snap) -> dict:
    items = snap.items_json or []
    return SnapshotOut(
        id=snap.id,
        list_id=snap.list_id,
        created_at=snap.created_at,
        item_count=len(items),
        checked_count=sum(1 for it in items if it.get("was_checked")),
    ).model_dump(mode="json")


@router.get("")
async def get_snapshots(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    snaps = await list_snapshots(db, list_id)
    return ok([_snap_out(s) for s in snaps])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_snapshot(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Manual snapshot — the reset endpoint already saves one automatically."""
    try:
        lst, _, _ = await get_list_for_user(db, list_id, user.id, require_edit=True)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    snap = await save_snapshot(db, lst)
    return ok(_snap_out(snap))


@router.post("/{snapshot_id}/restore", status_code=status.HTTP_201_CREATED)
async def post_restore(
    list_id: int,
    snapshot_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, _ = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    snap = await get_snapshot(db, list_id, snapshot_id)
    if not snap:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot nicht gefunden")
    new_list = await restore_snapshot(db, lst, snap)
    return ok(RestoreResponse(list_id=new_list.id, list_title=new_list.title).model_dump())
