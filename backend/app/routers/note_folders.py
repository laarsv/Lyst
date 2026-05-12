from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.note import Note
from app.models.note_folder import NoteFolder
from app.models.user import User
from app.schemas.note import NoteFolderCreate, NoteFolderOut, NoteFolderUpdate

router = APIRouter(prefix="/note-folders", tags=["note-folders"])


def _out(folder: NoteFolder, note_count: int) -> dict:
    return NoteFolderOut.model_validate(folder).model_copy(
        update={"note_count": note_count}
    ).model_dump(mode="json")


@router.get("")
async def get_folders(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    # Note count joined per folder (excludes archived, matching the default
    # main list — keeps the badge consistent with what the user sees).
    note_count = func.count(Note.id).label("note_count")
    stmt = (
        select(NoteFolder, note_count)
        .outerjoin(
            Note,
            (Note.folder_id == NoteFolder.id) & (Note.is_archived.is_(False)),
        )
        .where(NoteFolder.owner_id == user.id)
        .group_by(NoteFolder.id)
        .order_by(NoteFolder.name)
    )
    result = await db.execute(stmt)
    return ok([_out(folder, count) for folder, count in result.all()])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_folder(
    payload: NoteFolderCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    folder = NoteFolder(owner_id=user.id, name=payload.name, color=payload.color)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return ok(_out(folder, 0))


@router.patch("/{folder_id}")
async def patch_folder(
    folder_id: int,
    payload: NoteFolderUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NoteFolder).where(NoteFolder.id == folder_id, NoteFolder.owner_id == user.id)
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ordner nicht gefunden")
    for k, v in payload.model_dump(exclude_unset=True).items():
        if v is not None or k == "color":
            setattr(folder, k, v)
    await db.commit()
    await db.refresh(folder)
    # Note count for the response payload
    cnt = await db.execute(
        select(func.count(Note.id)).where(
            Note.folder_id == folder.id, Note.is_archived.is_(False)
        )
    )
    return ok(_out(folder, cnt.scalar_one()))


@router.delete("/{folder_id}")
async def del_folder(
    folder_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NoteFolder).where(NoteFolder.id == folder_id, NoteFolder.owner_id == user.id)
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ordner nicht gefunden")
    # FK is ON DELETE SET NULL, so notes survive — they just become folderless.
    await db.delete(folder)
    await db.commit()
    return ok({"message": "Deleted"})
