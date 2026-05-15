"""One-shot data migration: turn every existing note task-list item
into a TaskItem row and stamp `data-task-id="<row>"` on the matching
`<li data-type="taskItem">` in the note's HTML.

Run AFTER `alembic upgrade head` puts the task_items table in place.

What it does, per note that already has content_format='HTML':
  1. Parse the HTML.
  2. For every `<li data-type="taskItem">` without a `data-task-id`,
     insert a TaskItem row (text from the li's text content, is_done
     from `data-checked="true|false"`, position = document order).
  3. Stamp the new id back onto the `<li>` as a `data-task-id`
     attribute and save the patched HTML back to `notes.content`.
  4. Commit in batches.

Idempotent: a re-run finds no nodes without `data-task-id` and exits
zero-converted. Re-running after editing a single note also does
nothing — only NEW task-items (no id) trigger an insert.

Notes still flagged content_format='MARKDOWN' are skipped — once the
0016 migration script flips them to HTML, this one picks them up.

Usage:
    docker compose exec backend python -m scripts.migrate_note_tasks_to_rows
    # flags: --dry-run --verbose --batch N --limit N
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.note import Note, NoteContentFormat  # noqa: E402
from app.models.task_item import TaskItem  # noqa: E402


def _patch_note_tasks(html: str, ids_pending: list[dict]) -> tuple[str, int]:
    """Find every <li data-type="taskItem"> without data-task-id.
    Mutate `ids_pending` with one dict per match (`{text, is_done,
    position}`). Returns the patched HTML (placeholders left for the
    caller to fill once row ids are known) and the count of new tasks.

    We use BeautifulSoup rather than regex because attribute order +
    quoting are not stable between TipTap versions / pastes from other
    sources, and we already pay for bs4 elsewhere (the markdown-to-
    HTML migration uses it). Stable serialisation of the parsed tree
    means re-running is byte-stable.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html or "", "html.parser")
    position = 0
    new_count = 0
    for li in soup.find_all("li", attrs={"data-type": "taskItem"}):
        # Track every taskItem's position even if it's already
        # tagged — that's the canonical order the aggregator reads.
        if li.has_attr("data-task-id") and li["data-task-id"]:
            position += 1
            continue
        # Text content: strip nested tags, collapse whitespace.
        text = li.get_text(separator=" ", strip=True)
        is_done = li.get("data-checked", "false").lower() == "true"
        # Sentinel attribute the caller fills in once the row id is
        # known. Using `pending-<index>` makes the SQL update trivial.
        sentinel = f"__pending_{new_count}__"
        li["data-task-id"] = sentinel
        ids_pending.append({
            "text": text,
            "is_done": is_done,
            "position": position,
            "sentinel": sentinel,
        })
        position += 1
        new_count += 1
    return str(soup), new_count


async def _convert_one(session: AsyncSession, note: Note, dry_run: bool) -> int:
    """Returns the number of new TaskItem rows created for this note."""
    pending: list[dict] = []
    patched, new_count = _patch_note_tasks(note.content or "", pending)
    if new_count == 0:
        return 0
    if dry_run:
        return new_count

    # Insert one row per pending entry, then patch the sentinel
    # placeholders in the HTML with the real ids.
    final_html = patched
    for entry in pending:
        row = TaskItem(
            note_id=note.id,
            text=entry["text"],
            is_done=entry["is_done"],
            position=entry["position"],
        )
        session.add(row)
        await session.flush()  # populate row.id
        final_html = final_html.replace(
            f'data-task-id="{entry["sentinel"]}"',
            f'data-task-id="{row.id}"',
        )
    note.content = final_html
    return new_count


async def _convert_batch(
    session: AsyncSession,
    *,
    batch: int,
    limit: int | None,
    dry_run: bool,
    verbose: bool,
) -> tuple[int, int, int]:
    """Returns (scanned_notes, patched_notes, new_task_rows)."""
    scanned = 0
    patched = 0
    new_rows = 0
    offset = 0

    while True:
        stmt = (
            select(Note)
            .where(Note.content_format == NoteContentFormat.HTML)
            .order_by(Note.id)
            .offset(offset)
            .limit(batch)
        )
        rows = (await session.execute(stmt)).scalars().all()
        if not rows:
            break
        offset += len(rows)

        for note in rows:
            scanned += 1
            count = await _convert_one(session, note, dry_run=dry_run)
            if count > 0:
                patched += 1
                new_rows += count
                if verbose:
                    print(
                        f"  note id={note.id} title={note.title!r}: "
                        f"{count} new task row(s)"
                    )

            if limit is not None and patched >= limit:
                break

        if dry_run:
            await session.rollback()
        else:
            await session.commit()

        if limit is not None and patched >= limit:
            break

    return scanned, patched, new_rows


async def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--dry-run", action="store_true", help="Don't write, just count")
    ap.add_argument("--batch", type=int, default=50, help="Commit batch size")
    ap.add_argument("--limit", type=int, default=None, help="Stop after N patched notes")
    ap.add_argument("--verbose", action="store_true", help="Print per-note conversion counts")
    args = ap.parse_args()

    async with AsyncSessionLocal() as session:
        scanned, patched, new_rows = await _convert_batch(
            session,
            batch=args.batch,
            limit=args.limit,
            dry_run=args.dry_run,
            verbose=args.verbose,
        )

    mode = "dry-run" if args.dry_run else "applied"
    print(
        f"Done ({mode}). scanned={scanned} patched_notes={patched} "
        f"new_task_rows={new_rows}"
    )


if __name__ == "__main__":
    asyncio.run(main())
