/** Extends TipTap's built-in TaskItem with a `taskId` attribute so
 *  every checkbox in a note doc maps to a row in the backend
 *  `task_items` table.
 *
 *  The id is written to the markup as `data-task-id="<row>"`. Three
 *  states for any TaskItem node in the doc:
 *    - taskId set        -> existing backend row, sync-only
 *    - taskId null/none  -> newly typed, needs a POST to create
 *    - row exists, no node-> user deleted, needs a DELETE
 *
 *  `NoteEditor` owns the sync loop (NoteTaskSync). This file just
 *  teaches the schema to round-trip the attribute through HTML save+
 *  reload. Bleach already allowlists `data-task-id="<digits>"` on
 *  task-list `<li>`s after alembic 0018.
 */
import TaskItem from '@tiptap/extension-task-item';

export const NoteTaskItem = TaskItem.extend({
  // Keep nested task lists supported (StarterKit/TaskItem default).
  addAttributes() {
    // Pull the parent's attribute schema and graft `taskId` onto it.
    const parent = (this.parent?.() ?? {}) as Record<string, unknown>;
    return {
      ...parent,
      taskId: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('data-task-id');
          if (!raw) return null;
          const n = Number(raw);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs: { taskId?: number | null }) =>
          attrs.taskId ? { 'data-task-id': String(attrs.taskId) } : {},
      },
    };
  },
});

export default NoteTaskItem;
