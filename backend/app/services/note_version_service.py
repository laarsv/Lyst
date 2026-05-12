from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note
from app.models.note_version import NoteVersion

NOTE_VERSION_DEBOUNCE_SECONDS = 60
NOTE_VERSION_MAX_PER_NOTE = 50


async def maybe_save_version(db: AsyncSession, note: Note, *, force: bool = False) -> NoteVersion | None:
    """Snapshot the note's *current* title/content as a NoteVersion.
    Skipped if the last version was created within the debounce window
    (unless `force=True`, e.g. before a restore so the pre-restore state
    is always recoverable). Trims oldest versions over the cap."""
    if not force:
        last = await db.execute(
            select(NoteVersion)
            .where(NoteVersion.note_id == note.id)
            .order_by(NoteVersion.created_at.desc())
            .limit(1)
        )
        latest = last.scalar_one_or_none()
        if latest is not None:
            age = datetime.now(timezone.utc) - latest.created_at
            if age < timedelta(seconds=NOTE_VERSION_DEBOUNCE_SECONDS):
                return None
            # Don't snapshot if nothing meaningful changed since the last version.
            if latest.title == note.title and latest.content == note.content:
                return None
    snap = NoteVersion(note_id=note.id, title=note.title, content=note.content)
    db.add(snap)
    await db.commit()
    await _trim(db, note.id)
    await db.refresh(snap)
    return snap


async def _trim(db: AsyncSession, note_id: int) -> None:
    rows_q = await db.execute(
        select(NoteVersion)
        .where(NoteVersion.note_id == note_id)
        .order_by(NoteVersion.created_at.desc())
    )
    rows = list(rows_q.scalars().all())
    excess = rows[NOTE_VERSION_MAX_PER_NOTE:]
    if not excess:
        return
    for old in excess:
        await db.delete(old)
    await db.commit()


async def list_versions(db: AsyncSession, note_id: int) -> list[NoteVersion]:
    result = await db.execute(
        select(NoteVersion)
        .where(NoteVersion.note_id == note_id)
        .order_by(NoteVersion.created_at.desc())
    )
    return list(result.scalars().all())


async def get_version(db: AsyncSession, note_id: int, version_id: int) -> NoteVersion | None:
    result = await db.execute(
        select(NoteVersion).where(
            NoteVersion.id == version_id, NoteVersion.note_id == note_id
        )
    )
    return result.scalar_one_or_none()
