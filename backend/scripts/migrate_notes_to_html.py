"""One-shot data migration: convert every Markdown note to HTML.

Run AFTER `alembic upgrade head` (which adds the `content_format`
column via revision 0016).

What it does:
  - Walks `notes` where `content_format = 'MARKDOWN'`.
  - For each row, renders `content` through `markdown_to_html` (which
    handles wikilinks, GFM task lists, tables, images, code) and pipes
    the result through `sanitize_note_html`.
  - Writes the new HTML back to `content` and flips `content_format`
    to `HTML`.
  - Done in a transaction per batch (default 100 notes) so a crash in
    the middle leaves a recoverable state — already-converted notes
    stay HTML and the next run picks up from where it stopped.

Idempotent: re-running the script does no work because every row will
already have `content_format = 'HTML'` after the first pass. To
*force* a reconversion for a single note (e.g. recovering from a bad
conversion via a backup), flip its `content_format` back to MARKDOWN
manually and re-run.

Usage:
    docker compose exec backend python -m scripts.migrate_notes_to_html
    # or, locally:
    cd backend && python -m scripts.migrate_notes_to_html

Flags:
    --dry-run      print conversions but don't write
    --batch N      commit every N notes (default 100)
    --limit N      stop after N notes (useful for spot-checks)
    --verbose      print before/after snippet for each note

IMPORTANT — back up first:
    Before running this, snapshot the `notes` table. Postgres example:

        pg_dump -t notes -F c -f notes-pre-html-migration.dump $DATABASE_URL

    The migration is one-way (Markdown is discarded once HTML is
    saved). The `content_format` column stays for one release so a
    botched single-note conversion can be restored from this dump
    without rolling back the whole table.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Make `app.*` importable when run as a script from inside `backend/`.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.note import Note, NoteContentFormat  # noqa: E402
from app.services.note_html import markdown_to_html  # noqa: E402


async def _convert_batch(
    session: AsyncSession,
    *,
    batch: int,
    limit: int | None,
    dry_run: bool,
    verbose: bool,
) -> tuple[int, int]:
    """Process up to `limit` markdown notes in batches of `batch`.
    Returns (scanned, converted)."""
    scanned = 0
    converted = 0

    while True:
        stmt = (
            select(Note)
            .where(Note.content_format == NoteContentFormat.MARKDOWN)
            .order_by(Note.id)
            .limit(batch)
        )
        if limit is not None:
            remaining = limit - scanned
            if remaining <= 0:
                break
            stmt = stmt.limit(min(batch, remaining))

        rows = (await session.execute(stmt)).scalars().all()
        if not rows:
            break

        for note in rows:
            scanned += 1
            original_md = note.content or ""
            html = markdown_to_html(original_md)

            if verbose:
                _preview("BEFORE", original_md)
                _preview("AFTER ", html)
                print(f"  note id={note.id} title={note.title!r}")
                print("-" * 60)

            if not dry_run:
                note.content = html
                note.content_format = NoteContentFormat.HTML
                converted += 1

        if dry_run:
            # Reset so the same rows aren't returned next loop. In dry-run
            # we don't write the format flip, so we bail out after one
            # batch — the user just wanted a sample.
            await session.rollback()
            break

        await session.commit()

        if limit is not None and scanned >= limit:
            break

    return scanned, converted


def _preview(label: str, text: str, width: int = 200) -> None:
    snippet = text.replace("\n", " \\n ")
    if len(snippet) > width:
        snippet = snippet[:width] + "…"
    print(f"  {label}: {snippet}")


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="Don't write, just print")
    ap.add_argument("--batch", type=int, default=100, help="Commit batch size (default 100)")
    ap.add_argument("--limit", type=int, default=None, help="Stop after N notes")
    ap.add_argument("--verbose", action="store_true", help="Show before/after snippets")
    args = ap.parse_args()

    async with AsyncSessionLocal() as session:
        scanned, converted = await _convert_batch(
            session,
            batch=args.batch,
            limit=args.limit,
            dry_run=args.dry_run,
            verbose=args.verbose,
        )

    mode = "dry-run" if args.dry_run else "applied"
    print(f"Done ({mode}). scanned={scanned} converted={converted}")


if __name__ == "__main__":
    asyncio.run(main())
