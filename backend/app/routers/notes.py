from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.note import Note
from app.models.user import User
from app.schemas.note import NoteCreate, NoteOut, NoteUpdate

router = APIRouter(prefix="/notes", tags=["notes"])


def _out(n: Note) -> dict:
    return NoteOut.model_validate(n).model_dump(mode="json")


@router.get("")
async def get_notes(
    q: str | None = None,
    tag: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Note).where(Note.owner_id == user.id).order_by(Note.updated_at.desc())
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(func.lower(Note.title).like(like), func.lower(Note.content).like(like))
        )
    if tag:
        stmt = stmt.where(Note.tags.any(tag))
    result = await db.execute(stmt)
    return ok([_out(n) for n in result.scalars().all()])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_note(
    payload: NoteCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = Note(owner_id=user.id, **payload.model_dump())
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return ok(_out(note))


@router.get("/{note_id}")
async def get_note(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.owner_id == user.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return ok(_out(note))


@router.patch("/{note_id}")
async def patch_note(
    note_id: int,
    payload: NoteUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.owner_id == user.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(note, k, v)
    await db.commit()
    await db.refresh(note)
    return ok(_out(note))


@router.delete("/{note_id}")
async def del_note(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.owner_id == user.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.delete(note)
    await db.commit()
    return ok({"message": "Deleted"})
