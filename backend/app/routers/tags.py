from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.tag import Tag
from app.models.user import User
from app.schemas.tag import TagCreate, TagOut

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("")
async def get_tags(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Tag).where(Tag.owner_id == user.id).order_by(Tag.name)
    )
    return ok([TagOut.model_validate(t).model_dump(mode="json") for t in result.scalars().all()])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_tag(
    payload: TagCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    tag = Tag(owner_id=user.id, name=payload.name, color=payload.color)
    db.add(tag)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag already exists")
    await db.refresh(tag)
    return ok(TagOut.model_validate(tag).model_dump(mode="json"))


@router.delete("/{tag_id}")
async def del_tag(
    tag_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.owner_id == user.id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.delete(tag)
    await db.commit()
    return ok({"message": "Deleted"})
