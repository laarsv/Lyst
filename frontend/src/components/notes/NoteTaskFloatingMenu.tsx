/** Floating "Aufgabe" trigger for task-list items inside the editor.
 *
 *  Anchored to the active task-item li. When the user moves the
 *  caret into a task, a small button appears in the right margin;
 *  clicking opens the same TaskAssignPopover the list-detail page
 *  uses. The popover saves to the corresponding `task_items` row
 *  identified by the node's `taskId` attribute (filled in by
 *  NoteTaskSync once the row exists on the backend).
 *
 *  We deliberately don't render the assignment chips INLINE in the
 *  editor — ProseMirror's content-edit semantics fight every attempt
 *  to inject managed DOM next to a node-view's text. The popover is
 *  the source of truth; the /tasks page surfaces the assignment
 *  state alongside the rest of the user's tasks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { CircleUserRound } from 'lucide-react';
import {
  TaskAssignPopover,
  type TaskAssignableUser,
} from '@/components/tasks/TaskAssignPopover';
import { NoteTasksApi } from '@/api/endpoints';
import type { NoteTask } from '@/types';

interface Props {
  editor: Editor;
  noteId: number;
  assignableUsers: TaskAssignableUser[];
}

export function NoteTaskFloatingMenu({ editor, noteId, assignableUsers }: Props) {
  // The active <li data-type="taskItem"> DOM node — used as the
  // trigger button's anchor and the popover's reference rect.
  const [liEl, setLiEl] = useState<HTMLElement | null>(null);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  /** Last-known server state for this row. We hydrate it on demand
   *  when the user opens the popover so the dropdown reflects the
   *  current assignee/due/reminder values. */
  const [rowState, setRowState] = useState<NoteTask | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Track which task-item the caret is inside. We use ProseMirror's
  // `editor.isActive('taskItem')` plus a DOM walk to find the actual
  // <li>, because the button needs to anchor to a real element rect
  // (Floating UI / popover positioning).
  useEffect(() => {
    const update = () => {
      if (!editor.isActive('taskItem')) {
        setLiEl(null);
        setTaskId(null);
        setPopoverOpen(false);
        return;
      }
      const sel = editor.view.domAtPos(editor.state.selection.from);
      let node: Node | null = sel.node;
      while (node && (node as HTMLElement).nodeType !== 1) {
        node = node.parentNode;
      }
      let el = node as HTMLElement | null;
      while (el && !(el.tagName === 'LI' && el.getAttribute('data-type') === 'taskItem')) {
        el = el.parentElement;
      }
      if (!el) {
        setLiEl(null);
        setTaskId(null);
        return;
      }
      setLiEl(el);
      const idAttr = el.getAttribute('data-task-id');
      setTaskId(idAttr ? Number(idAttr) : null);
    };
    update();
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  // Hydrate the row's current state lazily when the popover opens.
  // The sync loop already created/updated this row by then.
  useEffect(() => {
    if (!popoverOpen || taskId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const tasks = await NoteTasksApi.list(noteId);
        if (cancelled) return;
        const me = tasks.find((t) => t.id === taskId);
        setRowState(me ?? null);
      } catch {
        if (!cancelled) setRowState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [popoverOpen, taskId, noteId]);

  const applyPatch = useCallback(
    async (
      patch: Partial<{
        assignee_id: number | null;
        due_at: string | null;
        reminder_at: string | null;
      }>,
    ) => {
      if (taskId === null) return;
      try {
        const updated = await NoteTasksApi.update(noteId, taskId, patch);
        setRowState(updated);
      } catch {
        // Patch failed — toast happens upstream; leave the popover
        // showing the previous server state.
      }
    },
    [noteId, taskId],
  );

  if (!liEl) return null;
  // Anchor: a button absolutely-positioned to the right of the li.
  // The li gets `position: relative` via index.css (already set on
  // every task-item by the task-list CSS); the trigger floats inside
  // its right edge so it stays glued during reflow.
  const liRect = liEl.getBoundingClientRect();
  const triggerStyle: React.CSSProperties = {
    position: 'fixed',
    top: liRect.top + 4,
    left: liRect.right - 30,
    zIndex: 30,
  };

  // The popover anchors to the trigger button; that lets it follow
  // the trigger if the li reflows (caret movement reshuffles list
  // items mid-edit).
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        style={triggerStyle}
        title="Aufgabe"
        aria-label="Aufgabe"
        onClick={(e) => {
          e.preventDefault();
          setPopoverOpen((o) => !o);
        }}
        // Don't blur the editor.
        onMouseDown={(e) => e.preventDefault()}
        className="size-7 inline-flex items-center justify-center rounded-ctl bg-surface border border-line text-muted hover:text-brand-700 hover:bg-brand-50 transition shadow-flat"
      >
        <CircleUserRound size={14} />
      </button>
      <TaskAssignPopover
        open={popoverOpen}
        anchor={btnRef.current}
        users={assignableUsers}
        value={{
          assignee_id: rowState?.assignee_id ?? null,
          due_at: rowState?.due_at ?? null,
          reminder_at: rowState?.reminder_at ?? null,
        }}
        onClose={() => setPopoverOpen(false)}
        onChange={(patch) => {
          void applyPatch(patch);
        }}
        onClear={() => {
          void applyPatch({
            assignee_id: null,
            due_at: null,
            reminder_at: null,
          });
          setPopoverOpen(false);
        }}
      />
    </>
  );
}
