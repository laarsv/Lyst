import base64
import io
import uuid

import qrcode
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.collaborator import CollaboratorPermission, ListCollaborator
from app.models.list import List as ListModel
from app.models.user import User


def _qr_base64(url: str) -> str:
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


async def enable_share(db: AsyncSession, lst: ListModel) -> tuple[str, str, str]:
    if not lst.share_token:
        lst.share_token = uuid.uuid4().hex
    lst.share_enabled = True
    await db.commit()
    await db.refresh(lst)
    share_url = f"{settings.FRONTEND_URL}/s/{lst.share_token}"
    qr = _qr_base64(share_url)
    return lst.share_token, share_url, qr


async def disable_share(db: AsyncSession, lst: ListModel) -> None:
    lst.share_enabled = False
    lst.share_token = None
    await db.commit()


async def get_public_list(db: AsyncSession, token: str) -> ListModel | None:
    result = await db.execute(
        select(ListModel)
        .options(selectinload(ListModel.items))
        .where(ListModel.share_token == token, ListModel.share_enabled.is_(True))
    )
    return result.scalar_one_or_none()


async def add_collaborator(
    db: AsyncSession, list_id: int, email: str, permission: CollaboratorPermission
) -> tuple[ListCollaborator, User]:
    user_result = await db.execute(select(User).where(User.email == email.lower()))
    user = user_result.scalar_one_or_none()
    if not user:
        raise ValueError("No registered user with that email")
    existing = await db.execute(
        select(ListCollaborator).where(
            and_(ListCollaborator.list_id == list_id, ListCollaborator.user_id == user.id)
        )
    )
    coll = existing.scalar_one_or_none()
    if coll:
        coll.permission = permission
    else:
        coll = ListCollaborator(list_id=list_id, user_id=user.id, permission=permission)
        db.add(coll)
    await db.commit()
    await db.refresh(coll)
    return coll, user


async def list_collaborators(
    db: AsyncSession, list_id: int
) -> list[tuple[ListCollaborator, User]]:
    result = await db.execute(
        select(ListCollaborator, User)
        .join(User, ListCollaborator.user_id == User.id)
        .where(ListCollaborator.list_id == list_id)
    )
    return [(c, u) for c, u in result.all()]


async def remove_collaborator(db: AsyncSession, list_id: int, user_id: int) -> None:
    result = await db.execute(
        select(ListCollaborator).where(
            and_(ListCollaborator.list_id == list_id, ListCollaborator.user_id == user_id)
        )
    )
    coll = result.scalar_one_or_none()
    if not coll:
        raise ValueError("Collaborator not found")
    await db.delete(coll)
    # Cascade: clear this user's task assignments on this list. A
    # collaborator who loses access mustn't keep seeing tasks they
    # can't reach. The FK has ondelete="SET NULL" on the assignee_id
    # column, but THIS deletion is on the collaborator row — not on
    # the user — so we have to NULL explicitly.
    from app.models.list_item import ListItem  # local import — avoid cycles
    from sqlalchemy import update
    await db.execute(
        update(ListItem)
        .where(ListItem.list_id == list_id, ListItem.assignee_id == user_id)
        .values(assignee_id=None)
    )
    await db.commit()
