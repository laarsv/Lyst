/** Editor↔backend sync for note task items.
 *
 *  After every document change in the TipTap editor we:
 *    1. Walk the doc and collect every TaskItem node, in document
 *       order, capturing (taskId | null, text, is_done, doc position).
 *    2. Diff against the last-known set:
 *       - new node with no taskId  → POST /notes/{id}/tasks
 *                                    then write the returned id back
 *                                    into the node's `taskId` attribute
 *                                    so future saves are no-ops.
 *       - node deleted in this update → DELETE /notes/{id}/tasks/{id}
 *       - text or is_done changed     → PATCH /notes/{id}/tasks/{id}
 *
 *  Sync runs OUT-OF-BAND from the autosave path (which posts the full
 *  HTML) — it operates on the editor's mutable JSON state so it can
 *  push the new id back into the node before the next HTML save
 *  serialises it. The two paths are independent: a successful
 *  autosave does not depend on task sync succeeding, and vice-versa.
 */
import type { Editor } from '@tiptap/core';
import { NoteTasksApi } from '@/api/endpoints';

interface TaskSnapshot {
  taskId: number | null;
  text: string;
  isDone: boolean;
  /** Position of the LI node in the doc — used by the patch path to
   *  push position changes back to the server. ProseMirror positions
   *  are integers; we don't need the exact values, just the relative
   *  ordering, so we use the loop index instead. */
  index: number;
  /** Stable pointer into the doc for writing the new taskId back. */
  pos: number;
}

interface InFlightState {
  /** Set of taskIds we've already seen — used by the next pass to
   *  detect deletions. Null entries (un-id'd nodes) aren't tracked
   *  here; the per-node closure tracks "I am being created". */
  lastSeen: Set<number>;
  /** Task ids the user actually deleted since the last sync; we
   *  hold them so we don't re-issue the DELETE on a subsequent flush. */
  pendingDelete: Set<number>;
  /** Promise per createInFlight key (the pos at the time POST was
   *  issued) — prevents a second flush from POSTing the same node
   *  again while the first call is pending. */
  creates: Map<number, Promise<void>>;
}


function snapshot(editor: Editor): TaskSnapshot[] {
  const out: TaskSnapshot[] = [];
  let index = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem') {
      out.push({
        taskId: (node.attrs.taskId as number | null) ?? null,
        text: node.textContent ?? '',
        isDone: !!node.attrs.checked,
        index,
        pos,
      });
      index += 1;
      // Don't descend further — nested task lists are also taskItems
      // and we WANT those, so return undefined (continue).
    }
    return undefined;
  });
  return out;
}


/** Install the sync loop on an editor. Returns a teardown function
 *  that detaches the update listener (for unmount). */
export function attachNoteTaskSync(
  editor: Editor,
  noteId: number,
): () => void {
  const state: InFlightState = {
    lastSeen: new Set<number>(),
    pendingDelete: new Set<number>(),
    creates: new Map(),
  };

  // Prime `lastSeen` from whatever already lives in the doc at attach
  // time so a no-edit load doesn't fire spurious DELETEs.
  for (const t of snapshot(editor)) {
    if (t.taskId !== null) state.lastSeen.add(t.taskId);
  }

  // Per-task-id, the most recent text/isDone we've observed. Lets us
  // avoid PATCHing on every keystroke — only when the value actually
  // changed since last successful sync.
  const lastValue = new Map<number, { text: string; isDone: boolean }>();

  let debounce: number | null = null;

  const flush = async () => {
    debounce = null;
    const current = snapshot(editor);
    const currentIds = new Set<number>();
    for (const t of current) {
      if (t.taskId !== null) currentIds.add(t.taskId);
    }

    // Deletes: anything previously seen, NOT in the current set, not
    // already pending a DELETE.
    for (const oldId of state.lastSeen) {
      if (currentIds.has(oldId)) continue;
      if (state.pendingDelete.has(oldId)) continue;
      state.pendingDelete.add(oldId);
      try {
        await NoteTasksApi.remove(noteId, oldId);
      } catch {
        // Server already missing or auth blip — drop the dedup entry
        // so a subsequent edit doesn't re-attempt the delete forever.
      } finally {
        state.pendingDelete.delete(oldId);
        lastValue.delete(oldId);
      }
    }

    // Creates: any node with no taskId. Use the pos as the dedup key
    // so two flushes that observe the same un-id'd node don't POST
    // twice.
    const creates: Array<{ pos: number; text: string; isDone: boolean; index: number }> = [];
    for (const t of current) {
      if (t.taskId !== null) continue;
      if (state.creates.has(t.pos)) continue;
      creates.push({ pos: t.pos, text: t.text, isDone: t.isDone, index: t.index });
    }
    for (const c of creates) {
      const p = (async () => {
        try {
          const row = await NoteTasksApi.create(noteId, {
            text: c.text,
            is_done: c.isDone,
            position: c.index,
          });
          // Write the new id back into the node attribute. Use a
          // transaction that doesn't enter the undo history so a
          // user's "undo" doesn't strip the id and orphan the row.
          const { state } = editor;
          const tr = state.tr;
          const nodeAt = state.doc.nodeAt(c.pos);
          if (nodeAt) {
            tr.setNodeMarkup(c.pos, undefined, {
              ...nodeAt.attrs,
              taskId: row.id,
            });
            tr.setMeta('addToHistory', false);
            editor.view.dispatch(tr);
          }
          lastValue.set(row.id, { text: c.text, isDone: c.isDone });
        } catch {
          // Couldn't create — leave taskId null so the next flush
          // retries. State.creates is cleaned up below regardless.
        } finally {
          state.creates.delete(c.pos);
        }
      })();
      state.creates.set(c.pos, p);
    }

    // Patches: existing taskId whose text or is_done changed.
    for (const t of current) {
      if (t.taskId === null) continue;
      const prev = lastValue.get(t.taskId);
      if (prev && prev.text === t.text && prev.isDone === t.isDone) continue;
      lastValue.set(t.taskId, { text: t.text, isDone: t.isDone });
      try {
        await NoteTasksApi.update(noteId, t.taskId, {
          text: t.text,
          is_done: t.isDone,
          position: t.index,
        });
      } catch {
        // Drop the cache entry so the next flush retries the patch.
        lastValue.delete(t.taskId);
      }
    }

    // Sync `lastSeen` so the next deletion pass has the right baseline.
    state.lastSeen = currentIds;
  };

  const onUpdate = () => {
    // Debounce a beat so a burst of keystrokes doesn't fan out to a
    // PATCH per character. 500 ms feels right — slower than the
    // editor autosave (600 ms) so usually nothing has actually
    // diverged yet, but fast enough that the user sees their
    // assignment land within a second.
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      void flush();
    }, 500);
  };

  editor.on('update', onUpdate);
  return () => {
    if (debounce !== null) window.clearTimeout(debounce);
    editor.off('update', onUpdate);
  };
}
