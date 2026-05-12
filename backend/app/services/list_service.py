from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.collaborator import CollaboratorPermission, ListCollaborator
from app.models.list import List as ListModel, ListType
from app.models.list_item import ListItem
from app.models.user import User


async def list_for_user(
    db: AsyncSession, user_id: int, *, include_templates: bool = False
) -> list[tuple[ListModel, int, int, bool, str | None]]:
    """Returns (list, item_count, checked_count, is_owner, permission?) for own + shared lists."""
    item_count = func.count(ListItem.id).label("item_count")
    checked_count = func.coalesce(
        func.sum(case((ListItem.is_checked.is_(True), 1), else_=0)), 0
    ).label("checked_count")

    own_stmt = (
        select(ListModel, item_count, checked_count)
        .outerjoin(ListItem, ListItem.list_id == ListModel.id)
        .where(ListModel.owner_id == user_id)
        .where(ListModel.is_template.is_(include_templates))
        .group_by(ListModel.id)
    )
    own_result = await db.execute(own_stmt)
    own_rows = [(l, ic, cc, True, None) for l, ic, cc in own_result.all()]

    shared_stmt = (
        select(
            ListModel,
            item_count,
            checked_count,
            ListCollaborator.permission,
        )
        .join(ListCollaborator, ListCollaborator.list_id == ListModel.id)
        .outerjoin(ListItem, ListItem.list_id == ListModel.id)
        .where(ListCollaborator.user_id == user_id)
        .where(ListModel.is_template.is_(False))
        .group_by(ListModel.id, ListCollaborator.permission)
    )
    shared_result = await db.execute(shared_stmt)
    shared_rows = [(l, ic, cc, False, p.value) for l, ic, cc, p in shared_result.all()]

    rows = own_rows + shared_rows
    rows.sort(key=lambda r: r[0].updated_at, reverse=True)
    return rows


async def get_list_for_user(
    db: AsyncSession, list_id: int, user_id: int, *, require_edit: bool = False
) -> tuple[ListModel, bool, str | None]:
    """Return (list, is_owner, permission?). Raises ValueError if not accessible."""
    result = await db.execute(
        select(ListModel)
        .options(selectinload(ListModel.items))
        .where(ListModel.id == list_id)
    )
    lst = result.scalar_one_or_none()
    if not lst:
        raise ValueError("List not found")
    if lst.owner_id == user_id:
        return lst, True, None
    coll_result = await db.execute(
        select(ListCollaborator).where(
            and_(ListCollaborator.list_id == list_id, ListCollaborator.user_id == user_id)
        )
    )
    coll = coll_result.scalar_one_or_none()
    if not coll:
        raise ValueError("List not found")
    if require_edit and coll.permission != CollaboratorPermission.EDIT:
        raise PermissionError("Edit permission required")
    return lst, False, coll.permission.value


async def create_list(db: AsyncSession, owner_id: int, **fields) -> ListModel:
    # SHOPPING lists default to category-sorting since that's where the
    # auto-categorizer adds the most value.
    if fields.get("type") == ListType.SHOPPING and "sort_by_category" not in fields:
        fields["sort_by_category"] = True
    lst = ListModel(owner_id=owner_id, **fields)
    db.add(lst)
    await db.commit()
    await db.refresh(lst)
    return lst


async def update_list(
    db: AsyncSession, lst: ListModel, **fields
) -> ListModel:
    for k, v in fields.items():
        if v is not None:
            setattr(lst, k, v)
    await db.commit()
    await db.refresh(lst)
    return lst


async def delete_list(db: AsyncSession, lst: ListModel) -> None:
    await db.delete(lst)
    await db.commit()


async def duplicate_list(
    db: AsyncSession,
    src: ListModel,
    owner_id: int,
    *,
    title: str | None = None,
    as_template: bool = False,
    template_name: str | None = None,
) -> ListModel:
    new_list = ListModel(
        owner_id=owner_id,
        title=title or src.title,
        type=src.type,
        description=src.description,
        color=src.color,
        icon=src.icon,
        is_template=as_template,
        template_name=template_name if as_template else None,
    )
    db.add(new_list)
    await db.flush()
    items_result = await db.execute(
        select(ListItem).where(ListItem.list_id == src.id).order_by(ListItem.position)
    )
    for it in items_result.scalars().all():
        db.add(
            ListItem(
                list_id=new_list.id,
                text=it.text,
                is_checked=False,
                quantity=it.quantity,
                unit=it.unit,
                position=it.position,
            )
        )
    await db.commit()
    await db.refresh(new_list)
    return new_list


async def reset_list(db: AsyncSession, lst: ListModel) -> None:
    for it in lst.items:
        it.is_checked = False
    await db.commit()


async def list_stats(db: AsyncSession, list_id: int) -> tuple[int, int]:
    result = await db.execute(
        select(
            func.count(ListItem.id),
            func.coalesce(
                func.sum(case((ListItem.is_checked.is_(True), 1), else_=0)), 0
            ),
        ).where(ListItem.list_id == list_id)
    )
    total, checked = result.one()
    return total or 0, checked or 0
