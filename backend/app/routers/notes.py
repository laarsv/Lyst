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
    folder_id: int | None = None,
    uncategorized: bool = False,
    archived: bool = False,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Notes list with sticky-pinned ordering.

    - `archived=true` shows ONLY archived notes (the archive view).
      Default is to hide archived entries from the main list.
    - `folder_id` filters by folder; `uncategorized=true` shortcuts
      to "no folder assigned" (folder_id IS NULL).
    - Pinned notes always come first regardless of updated_at.
    """
    stmt = (
        select(Note)
        .where(Note.owner_id == user.id)
        .where(Note.is_archived.is_(archived))
        .order_by(Note.is_pinned.desc(), Note.updated_at.desc())
    )
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(func.lower(Note.title).like(like), func.lower(Note.content).like(like))
        )
    if tag:
        stmt = stmt.where(Note.tags.any(tag))
    if uncategorized:
        stmt = stmt.where(Note.folder_id.is_(None))
    elif folder_id is not None:
        stmt = stmt.where(Note.folder_id == folder_id)
    result = await db.execute(stmt)
    return ok([_out(n) for n in result.scalars().all()])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_note(
    payload: NoteCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump()
    if data.get("folder_id") is not None:
        await _ensure_folder_owned(db, data["folder_id"], user.id)
    # Archived notes can't also be pinned (spec).
    if data.get("is_archived") and data.get("is_pinned"):
        data["is_pinned"] = False
    note = Note(owner_id=user.id, **data)
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return ok(_out(note))


async def _ensure_folder_owned(db: AsyncSession, folder_id: int, owner_id: int) -> None:
    from app.models.note_folder import NoteFolder

    result = await db.execute(
        select(NoteFolder).where(NoteFolder.id == folder_id, NoteFolder.owner_id == owner_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ordner nicht gefunden")


@router.get("/search")
async def search_titles(
    q: str = "",
    limit: int = 10,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Title-only autocomplete for the [[…]] interlink dropdown.
    Excludes archived notes."""
    needle = q.strip()
    stmt = (
        select(Note.id, Note.title)
        .where(Note.owner_id == user.id, Note.is_archived.is_(False))
        .order_by(Note.is_pinned.desc(), Note.updated_at.desc())
        .limit(min(max(1, limit), 50))
    )
    if needle:
        stmt = stmt.where(func.lower(Note.title).like(f"%{needle.lower()}%"))
    result = await db.execute(stmt)
    return ok([{"id": i, "title": t} for i, t in result.all()])


@router.get("/{note_id}/backlinks")
async def get_backlinks(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Notes whose markdown content contains [[<this note's title>]]."""
    target = await db.execute(
        select(Note).where(Note.id == note_id, Note.owner_id == user.id)
    )
    note = target.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    # PostgreSQL ILIKE with the literal `[[Title]]` string. We escape the
    # SQL wildcard chars `_` and `%` in the title so a title that happens to
    # contain them doesn't widen the search.
    safe_title = note.title.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%[[{safe_title}]]%"
    result = await db.execute(
        select(Note.id, Note.title)
        .where(Note.owner_id == user.id, Note.id != note.id, Note.is_archived.is_(False))
        .where(Note.content.ilike(pattern, escape="\\"))
        .order_by(Note.updated_at.desc())
    )
    return ok([{"id": i, "title": t} for i, t in result.all()])


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
    patch = payload.model_dump(exclude_unset=True)
    if "folder_id" in patch and patch["folder_id"] is not None:
        await _ensure_folder_owned(db, patch["folder_id"], user.id)
    # Spec: an archived note cannot be pinned. Apply both directions:
    # archiving auto-unpins; pinning an archived note is a no-op.
    if patch.get("is_archived") is True:
        patch["is_pinned"] = False
    elif patch.get("is_pinned") is True and (patch.get("is_archived") or note.is_archived):
        patch["is_pinned"] = False
    for k, v in patch.items():
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
