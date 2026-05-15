import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ListItem, ListType } from '@/types';
import clsx from 'clsx';
import { CalendarClock, CircleUserRound, Lock, Tag, Trash2, UserCircle2 } from 'lucide-react';
import { UnitCombobox } from '@/components/UnitCombobox';
import { categoriesForType } from '@/data/listCategories';
import {
  TaskAssignPopover,
  type TaskAssignableUser,
} from '@/components/tasks/TaskAssignPopover';
import { formatTaskDue, taskInitials, isOverdue } from '@/components/tasks/taskFormat';

// Swipe thresholds (px / fraction of row width). Mirrors the spec:
//   - swipe < REVEAL_PX: snap back to 0 on release
//   - REVEAL_PX <= swipe < AUTO_COMMIT_FRAC * width: snap to revealed
//     state (button visible & tappable)
//   - swipe >= AUTO_COMMIT_FRAC * width: auto-commit (delete + undo)
const REVEAL_PX = 80;
const AUTO_COMMIT_FRAC = 0.6;
// Threshold past which we lock into a horizontal swipe gesture and start
// translating the row. Below this we leave the event alone so vertical
// scrolling and dnd-kit's drag activation can still fire.
const DIRECTION_LOCK_PX = 10;

interface Props {
  item: ListItem;
  canEdit: boolean;
  /** Drives the category override dropdown — SHOPPING and PACKING each
   *  show their own fixed set; for CHECKLIST/CUSTOM the chip is hidden
   *  because there's no fixed taxonomy. Optional for legacy callers. */
  listType?: ListType;
  onToggle: (item: ListItem) => void;
  onUpdate: (item: ListItem, patch: Partial<ListItem>) => void;
  /** Used by the hover-× button on desktop. Fires the actual deletion
   *  synchronously (no undo window). */
  onDelete: (item: ListItem) => void;
  /** Used by the mobile swipe gesture and the swipe-revealed delete
   *  button. The parent is expected to show the "Rückgängig" toast and
   *  defer the real DELETE accordingly. Defaults to `onDelete` if the
   *  parent hasn't migrated to the new contract yet. */
  onSwipeDelete?: (item: ListItem) => void;
  /** Users that can be assigned a task on this list. Owner + every
   *  collaborator (any permission). When undefined or empty the task
   *  popover hides the assignee dropdown — the user can still set
   *  due/reminder, just not assign. */
  assignableUsers?: TaskAssignableUser[];
}

export function SortableItem({
  item,
  canEdit,
  listType,
  onToggle,
  onUpdate,
  onDelete,
  onSwipeDelete,
  assignableUsers,
}: Props) {
  const swipeCommit = onSwipeDelete ?? onDelete;
  const typeCategories = categoriesForType(listType ?? null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEdit,
  });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [qty, setQty] = useState(item.quantity?.toString() ?? '');
  const [unit, setUnit] = useState(item.unit ?? '');

  useEffect(() => {
    setText(item.text);
    setQty(item.quantity?.toString() ?? '');
    setUnit(item.unit ?? '');
  }, [item.id, item.text, item.quantity, item.unit]);

  // ---- Swipe-to-delete state (touch only) -------------------------------
  // `swipeX` drives the translateX of the foreground row. `swipeLocked`
  // is true once the swipe is "revealed" — release between REVEAL_PX and
  // AUTO_COMMIT_FRAC * width keeps the row open so the user can tap the
  // exposed delete button. `committed` plays the slide-off animation
  // before the row is removed from the DOM by the parent's setItems.
  const rowRef = useRef<HTMLDivElement>(null);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [swipeLocked, setSwipeLocked] = useState(false);
  const [committed, setCommitted] = useState(false);
  const dragState = useRef<{
    startX: number;
    startY: number;
    locked: 'horizontal' | 'vertical' | null;
    width: number;
    pointerId: number;
    pointerType: string;
  } | null>(null);

  // Reset the swipe state if the item identity changes (e.g. WS pushed an
  // update for the same id). Avoids stale translateX on a fresh row.
  useEffect(() => {
    setSwipeX(0);
    setSwiping(false);
    setSwipeLocked(false);
    setCommitted(false);
  }, [item.id]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Swipe is mobile/touch-only by spec. Pen counts as touch on iPad.
    if (e.pointerType !== 'touch') return;
    if (!canEdit || editing || committed) return;
    // Ignore taps that originate on interactive children (drag handle,
    // checkbox, edit button, etc.) — the user is interacting with that
    // control, not the row.
    if ((e.target as HTMLElement).closest('button,input,a,select,textarea')) return;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      locked: null,
      width: rowRef.current?.getBoundingClientRect().width ?? 320,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st || e.pointerId !== st.pointerId) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (st.locked === null) {
      // Direction-lock: classify only after we've moved past the deadzone.
      // Horizontal swipes engage; vertical drags hand off to dnd-kit /
      // the browser scroller.
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
      if (Math.abs(dx) > Math.abs(dy) && dx < 0) {
        st.locked = 'horizontal';
        setSwiping(true);
      } else {
        st.locked = 'vertical';
        dragState.current = null; // hand off
        return;
      }
    }
    if (st.locked === 'horizontal') {
      // Clamp: don't let the user pull right past the start position.
      // Slight elastic resistance past the row width gives the gesture
      // a natural feel without complicating the snap math.
      const clamped = Math.max(-st.width, Math.min(0, dx));
      setSwipeX(clamped);
      // Prevent vertical scroll once we're locked horizontal.
      e.preventDefault();
    }
  };

  const releaseSwipe = (snapTo: number, lockOpen: boolean) => {
    setSwipeX(snapTo);
    setSwipeLocked(lockOpen);
    setSwiping(false);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st || e.pointerId !== st.pointerId) {
      dragState.current = null;
      return;
    }
    const locked = st.locked;
    const width = st.width;
    dragState.current = null;
    if (locked !== 'horizontal') return;

    const distance = Math.abs(swipeX);
    if (distance >= width * AUTO_COMMIT_FRAC) {
      // Full commit: animate fully off-screen, then ask the parent to
      // delete the item (which routes through the 5s undo toast).
      setCommitted(true);
      setSwipeX(-width);
      setSwiping(false);
      // Defer the actual delete until after the slide-out anim plays so
      // the user sees the row leave; the parent's optimistic remove plus
      // the toast handle the rest.
      window.setTimeout(() => swipeCommit(item), 180);
    } else if (distance >= REVEAL_PX) {
      // Partial reveal: lock the row open at ~REVEAL_PX so the user can
      // tap the now-visible delete button. A tap outside snaps it back.
      releaseSwipe(-REVEAL_PX - 24, true);
    } else {
      releaseSwipe(0, false);
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current || e.pointerId !== dragState.current.pointerId) return;
    dragState.current = null;
    releaseSwipe(0, false);
  };

  // Tap anywhere on the row body while the row is locked-open should
  // snap it shut — except taps on the delete button itself, which run
  // onDelete and then the slide-off transition. Use capture phase so
  // we beat the child onClick handlers (text → setEditing, checkbox,
  // etc.) before they fire. Without this the user would tap to dismiss
  // and accidentally enter edit mode.
  const onRowClickCaptureWhileOpen = (e: React.MouseEvent) => {
    if (!swipeLocked) return;
    if ((e.target as HTMLElement).closest('[data-swipe-delete]')) return;
    e.preventDefault();
    e.stopPropagation();
    releaseSwipe(0, false);
  };

  // ----------------------------------------------------------------------

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const save = () => {
    onUpdate(item, {
      text: text.trim() || item.text,
      quantity: qty === '' ? null : Number(qty),
      unit: unit.trim() || null,
    });
    setEditing(false);
  };

  // The row body — extracted so we can wrap it in a swipe container that
  // sits over the (red) delete-action backdrop. The original visual is
  // unchanged; only the wrapper layout is new.
  const rowBody = (
    <div
      className={clsx(
        'group flex items-center gap-2 px-3 py-2.5 rounded-xl border transition',
        item.is_checked ? 'bg-page border-line' : 'bg-surface border-line',
      )}
      onClickCapture={onRowClickCaptureWhileOpen}
    >
      {canEdit && (
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted/60 hover:text-muted px-1 select-none touch-none"
          aria-label="Verschieben"
        >
          ⋮⋮
        </button>
      )}
      <input
        type="checkbox"
        checked={item.is_checked}
        onChange={() => onToggle(item)}
        disabled={!canEdit}
        className="size-5 rounded-md accent-brand cursor-pointer"
      />
      {editing && canEdit ? (
        <div className="flex-1 flex flex-wrap items-center gap-2">
          <input
            className="input flex-1 py-1.5 min-w-[150px]"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <input
            className="input w-20 py-1.5"
            value={qty}
            inputMode="decimal"
            placeholder="Menge"
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <UnitCombobox
            className="w-28"
            value={unit || null}
            onChange={(u) => setUnit(u ?? '')}
          />
          <button className="btn-primary text-xs py-1" onClick={save}>OK</button>
        </div>
      ) : (
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => canEdit && setEditing(true)}
        >
          <div
            className={clsx(
              'truncate',
              item.is_checked && 'line-through text-muted/70',
            )}
          >
            {item.text}
          </div>
          {(item.quantity !== null || item.unit) && (
            <div className="text-xs text-muted">
              {item.quantity !== null && item.quantity}
              {item.unit && ` ${item.unit}`}
            </div>
          )}
        </div>
      )}
      {/* Task affordance — visible chips for active tasks, plus a
          hover-only icon trigger for the assignment popover. Hidden
          for empty items (no text yet) per spec, and for read-only
          views. The trigger sits to the LEFT of category/delete so it
          stays accessible on narrow rows. */}
      {canEdit && !editing && item.text.trim() && (
        <TaskAffordance
          item={item}
          assignableUsers={assignableUsers ?? []}
          onUpdate={onUpdate}
        />
      )}
      {canEdit && !editing && typeCategories && (
        <CategoryChip
          item={item}
          categories={typeCategories}
          onPick={(category) => onUpdate(item, { category })}
        />
      )}
      {canEdit && !editing && (
        <button
          className="opacity-0 group-hover:opacity-100 transition text-muted/70 hover:text-danger px-1"
          onClick={() => onDelete(item)}
          aria-label="Löschen"
        >
          ×
        </button>
      )}
    </div>
  );

  // Outer ref is what dnd-kit listens to; inner ref captures the row
  // width and is the element we translate during the swipe gesture.
  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* Red action backdrop. Visible only while swiping/locked so it
          doesn't add a flicker for non-touch users. Sized to fill the
          rounded card. */}
      {canEdit && (swiping || swipeLocked || committed) && (
        <div className="absolute inset-0 rounded-xl bg-danger flex items-center justify-end pr-4 select-none">
          <button
            type="button"
            data-swipe-delete
            onClick={() => {
              const w = rowRef.current?.getBoundingClientRect().width ?? 320;
              setCommitted(true);
              setSwipeX(-w);
              setSwiping(false);
              window.setTimeout(() => swipeCommit(item), 180);
            }}
            className="text-white text-sm font-medium inline-flex items-center gap-1.5"
            aria-label="Eintrag löschen"
          >
            <Trash2 size={16} />
            Löschen
          </button>
        </div>
      )}
      <div
        ref={rowRef}
        // touch-action: pan-y → browser handles vertical scrolling, we
        // own horizontal pans. This keeps the page scrollable while
        // letting our handler claim the horizontal axis.
        style={{
          touchAction: 'pan-y',
          transform: `translate3d(${swipeX}px, 0, 0)`,
          transition: swiping ? 'none' : 'transform 180ms ease-out',
          opacity: committed ? 0 : 1,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {rowBody}
      </div>
    </div>
  );
}

function TaskAffordance({
  item,
  assignableUsers,
  onUpdate,
}: {
  item: ListItem;
  assignableUsers: TaskAssignableUser[];
  onUpdate: (item: ListItem, patch: Partial<ListItem>) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const hasTaskFields =
    item.assignee_id !== null ||
    item.due_at !== null ||
    item.reminder_at !== null;
  const overdue = isOverdue(item.due_at, item.is_checked);

  const applyPatch = (patch: Partial<{
    assignee_id: number | null;
    due_at: string | null;
    reminder_at: string | null;
  }>) => {
    // Optimistic: the parent's onUpdate also drives the WS broadcast
    // and reconciles with the server response.
    onUpdate(item, patch as Partial<ListItem>);
  };

  return (
    <>
      {/* Assignment chips (only when at least one task field is set).
          Sit between the row body and the action icons so they read
          left-to-right with the other metadata. */}
      {hasTaskFields && (
        <div className="flex items-center gap-1.5 shrink-0">
          {item.due_at && (
            <span
              className={clsx(
                'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-chip',
                overdue
                  ? 'bg-danger-50 text-danger'
                  : 'bg-page text-muted',
              )}
              title={new Date(item.due_at).toLocaleString('de-DE')}
            >
              <CalendarClock size={11} />
              {formatTaskDue(item.due_at)}
            </span>
          )}
          {item.assignee_id !== null && (
            <span
              title={item.assignee_name ?? 'Zugewiesen'}
              className="inline-flex size-6 items-center justify-center rounded-full bg-brand-50 text-brand-700 text-[10px] font-semibold"
            >
              {taskInitials(item.assignee_name)}
            </span>
          )}
        </div>
      )}
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Aufgabe"
        title="Aufgabe"
        className={clsx(
          'transition shrink-0 size-7 inline-flex items-center justify-center rounded-ctl',
          hasTaskFields
            ? 'text-brand-700 hover:bg-brand-50'
            : 'opacity-0 group-hover:opacity-100 text-muted/70 hover:text-ink hover:bg-page',
        )}
      >
        {hasTaskFields ? <CircleUserRound size={15} /> : <UserCircle2 size={15} />}
      </button>
      <TaskAssignPopover
        open={open}
        anchor={anchorRef.current}
        users={assignableUsers}
        value={{
          assignee_id: item.assignee_id,
          due_at: item.due_at,
          reminder_at: item.reminder_at,
        }}
        onClose={() => setOpen(false)}
        onChange={(patch) => applyPatch(patch)}
        onClear={() => {
          applyPatch({
            assignee_id: null,
            due_at: null,
            reminder_at: null,
          });
          setOpen(false);
        }}
      />
    </>
  );
}

function CategoryChip({
  item,
  categories,
  onPick,
}: {
  item: ListItem;
  /** The fixed category set for the parent list's type. */
  categories: string[];
  onPick: (category: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const has = !!item.category;
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={
          item.category_locked
            ? `${item.category} (manuell festgelegt — Auto-Sortierung lässt das in Ruhe)`
            : item.category ?? 'Kategorie zuweisen'
        }
        className={clsx(
          'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-chip transition',
          has
            ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
            : 'opacity-0 group-hover:opacity-100 text-muted/70 border border-dashed border-line hover:text-ink',
        )}
      >
        {has ? (
          <>
            {item.category_locked && <Lock size={10} />}
            <span className="truncate max-w-[110px]">{item.category}</span>
          </>
        ) : (
          <>
            <Tag size={10} />
            <span>Kategorie</span>
          </>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[170px] card p-1 shadow-flat border border-line bg-surface">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPick(c);
                setOpen(false);
              }}
              className={`w-full text-left px-2 py-1.5 text-sm rounded transition ${
                item.category === c ? 'bg-brand-50 text-brand-700' : 'hover:bg-page'
              }`}
            >
              {c}
            </button>
          ))}
          {item.category && (
            <>
              <div className="border-t border-line my-1" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(null);
                  setOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 text-sm rounded text-muted hover:bg-page hover:text-ink"
              >
                Kategorie entfernen
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
