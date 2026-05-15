from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.list_item import ListItem


async def list_items(db: AsyncSession, list_id: int) -> list[ListItem]:
    # selectinload(assignee) so the response payload includes
    # assignee_name without a per-row lazy-load round-trip. Cheap on
    # the wire — most list items don't have an assignee at all.
    result = await db.execute(
        select(ListItem)
        .where(ListItem.list_id == list_id)
        .options(selectinload(ListItem.assignee))
        .order_by(ListItem.position)
    )
    return list(result.scalars().all())


async def _next_position(db: AsyncSession, list_id: int) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(ListItem.position), -1) + 1).where(
            ListItem.list_id == list_id
        )
    )
    return result.scalar_one()


async def create_item(
    db: AsyncSession,
    list_id: int,
    *,
    text: str,
    is_checked: bool = False,
    quantity: float | None = None,
    unit: str | None = None,
) -> ListItem:
    pos = await _next_position(db, list_id)
    item = ListItem(
        list_id=list_id,
        text=text,
        is_checked=is_checked,
        quantity=quantity,
        unit=unit,
        position=pos,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def bulk_create_items(
    db: AsyncSession,
    list_id: int,
    *,
    lines: list[str] | None = None,
    items: list[dict] | None = None,
) -> list[ListItem]:
    """Insert many items in one transaction. Pass either `lines` (text-only)
    or `items` (already-parsed dicts with text/quantity/unit/is_checked).
    Empty/blank text rows are skipped silently."""
    pos = await _next_position(db, list_id)
    created: list[ListItem] = []

    if items is not None:
        for spec in items:
            text = (spec.get("text") or "").strip()
            if not text:
                continue
            item = ListItem(
                list_id=list_id,
                text=text,
                quantity=spec.get("quantity"),
                unit=spec.get("unit"),
                is_checked=bool(spec.get("is_checked", False)),
                position=pos,
            )
            db.add(item)
            created.append(item)
            pos += 1
    else:
        for line in lines or []:
            text = line.strip()
            if not text:
                continue
            item = ListItem(list_id=list_id, text=text, position=pos)
            db.add(item)
            created.append(item)
            pos += 1

    await db.commit()
    for it in created:
        await db.refresh(it)
    return created


async def get_item(db: AsyncSession, list_id: int, item_id: int) -> ListItem | None:
    result = await db.execute(
        select(ListItem).where(ListItem.id == item_id, ListItem.list_id == list_id)
    )
    return result.scalar_one_or_none()


async def update_item(db: AsyncSession, item: ListItem, **fields) -> ListItem:
    for k, v in fields.items():
        if v is not None:
            setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


async def delete_item(db: AsyncSession, item: ListItem) -> None:
    await db.delete(item)
    await db.commit()


async def reorder_items(
    db: AsyncSession, list_id: int, positions: list[tuple[int, int]]
) -> None:
    ids = [i for i, _ in positions]
    result = await db.execute(
        select(ListItem).where(ListItem.list_id == list_id, ListItem.id.in_(ids))
    )
    items_by_id = {i.id: i for i in result.scalars().all()}
    for item_id, pos in positions:
        if item_id in items_by_id:
            items_by_id[item_id].position = pos
    await db.commit()
