from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.list import List as ListModel, ListType
from app.models.list_item import ListItem
from app.models.list_snapshot import ListSnapshot

MAX_SNAPSHOTS_PER_LIST = 10


async def save_snapshot(db: AsyncSession, lst: ListModel) -> ListSnapshot:
    """Freeze the current items into a snapshot row, then trim the oldest
    so we keep at most MAX_SNAPSHOTS_PER_LIST per list. Called from the
    list-reset path before items are unchecked."""
    items_payload = [
        {
            "text": it.text,
            "quantity": it.quantity,
            "unit": it.unit,
            "position": it.position,
            "was_checked": it.is_checked,
        }
        for it in sorted(lst.items, key=lambda i: i.position)
    ]
    snap = ListSnapshot(list_id=lst.id, items_json=items_payload)
    db.add(snap)
    await db.commit()
    await _trim(db, lst.id)
    await db.refresh(snap)
    return snap


async def _trim(db: AsyncSession, list_id: int) -> None:
    result = await db.execute(
        select(ListSnapshot)
        .where(ListSnapshot.list_id == list_id)
        .order_by(ListSnapshot.created_at.desc())
    )
    rows = list(result.scalars().all())
    for old in rows[MAX_SNAPSHOTS_PER_LIST:]:
        await db.delete(old)
    if len(rows) > MAX_SNAPSHOTS_PER_LIST:
        await db.commit()


async def list_snapshots(db: AsyncSession, list_id: int) -> list[ListSnapshot]:
    result = await db.execute(
        select(ListSnapshot)
        .where(ListSnapshot.list_id == list_id)
        .order_by(ListSnapshot.created_at.desc())
    )
    return list(result.scalars().all())


async def get_snapshot(db: AsyncSession, list_id: int, snapshot_id: int) -> ListSnapshot | None:
    result = await db.execute(
        select(ListSnapshot).where(ListSnapshot.id == snapshot_id, ListSnapshot.list_id == list_id)
    )
    return result.scalar_one_or_none()


async def restore_snapshot(
    db: AsyncSession, source: ListModel, snapshot: ListSnapshot
) -> ListModel:
    """Create a new list (same type/icon/color) and seed it with the
    snapshot's items, preserving the `was_checked` state. Returns the new
    list — caller is responsible for any redirect."""
    new_list = ListModel(
        owner_id=source.owner_id,
        title=f"{source.title} – wiederhergestellt",
        type=source.type if source.type else ListType.SHOPPING,
        description=source.description,
        color=source.color,
        icon=source.icon,
    )
    db.add(new_list)
    await db.flush()
    for item in snapshot.items_json or []:
        db.add(
            ListItem(
                list_id=new_list.id,
                text=item.get("text", ""),
                quantity=item.get("quantity"),
                unit=item.get("unit"),
                position=int(item.get("position", 0)),
                is_checked=bool(item.get("was_checked", False)),
            )
        )
    await db.commit()
    await db.refresh(new_list)
    return new_list
