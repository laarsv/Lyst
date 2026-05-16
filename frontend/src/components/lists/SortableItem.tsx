/** Row component for a list item.
 *
 *  Quiet by default — empty fields render nothing. The row shows the
 *  drag handle, checkbox, text (with " · qty unit" appended when
 *  set), and then ONLY the chips for fields that actually have a
 *  value: assignee avatar, due-date pill, category icon. No
 *  placeholders, no "?" markers, no always-visible "assign to…"
 *  buttons.
 *
 *  Editing UX is viewport-dependent:
 *    - Mobile (≤767px): tap the text area to open the bottom sheet
 *      (`ItemSheet`), which holds every field + the Löschen button.
 *      Inline editing is intentionally disabled here — the row stays
 *      compact and the sheet is the one canonical edit surface.
 *    - Desktop: tap the text area to enter the existing inline
 *      edit. The kebab (⋮) on hover opens the same ItemSheet as a
 *      popover so the user can reach task/category fields without
 *      losing keyboard focus.
 *
 *  Gestures (mobile only):
 *    - Swipe LEFT → reveals delete button → full swipe = soft delete
 *      with undo toast (unchanged from previous iteration).
 *    - Swipe RIGHT → opens the ItemSheet. Same direction-lock as
 *      left, same 80px threshold.
 *
 *  Read-only viewers see chips but no kebab and no tap-to-edit.
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ListItem, ListType } from '@/types';
import clsx from 'clsx';
import {
  CalendarClock,
  Trash2,
} from 'lucide-react';
import {
  formatTaskDue,
  isOverdue,
  taskInitials,
} from '@/components/tasks/taskFormat';
import { iconForCategory } from '@/data/listCategories';
import { ItemSheet } from './ItemSheet';
import type { TaskAssignableUser } from '@/components/tasks/TaskAssignPopover';

// Swipe thresholds (px / fraction of row width).
//   - left  < REVEAL_PX           : snap back
//   - left  REVEAL_PX..AUTO_COMMIT: lock open, button visible
//   - left  >= AUTO_COMMIT * w    : auto-delete + undo toast
//   - right >= REVEAL_PX          : open the sheet
const REVEAL_PX = 80;
const AUTO_COMMIT_FRAC = 0.6;
const DIRECTION_LOCK_PX = 10;

const MOBILE_MQ = '(max-width: 767.98px)';

interface Props {
  item: ListItem;
  canEdit: boolean;
  /** Drives the category override + category icon. SHOPPING and PACKING
   *  have fixed sets; CHECKLIST/CUSTOM render no category UI. */
  listType?: ListType;
  onToggle: (item: ListItem) => void;
  onUpdate: (item: ListItem, patch: Partial<ListItem>) => void;
  onDelete: (item: ListItem) => void;
  onSwipeDelete?: (item: ListItem) => void;
  /** Users assignable to a task on this list. Drives the ItemSheet's
   *  assignee dropdown. */
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEdit,
  });

  // Sheet state — the single canonical edit surface for the row.
  // Mobile and desktop both open it on tap-text; mobile gets the
  // bottom-sheet presentation, desktop gets a centred modal.
  const [sheetOpen, setSheetOpen] = useState(false);

  // ---- Swipe state -------------------------------------------------------
  const rowRef = useRef<HTMLDivElement>(null);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  /** When 'left' (locked open at -REVEAL_PX) we show the delete button. */
  const [swipeLocked, setSwipeLocked] = useState<null | 'left'>(null);
  const [committed, setCommitted] = useState(false);
  const dragState = useRef<{
    startX: number;
    startY: number;
    locked: 'horizontal' | 'vertical' | null;
    width: number;
    pointerId: number;
  } | null>(null);

  useEffect(() => {
    setSwipeX(0);
    setSwiping(false);
    setSwipeLocked(null);
    setCommitted(false);
  }, [item.id]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return;
    if (!canEdit || committed) return;
    if ((e.target as HTMLElement).closest('button,input,a,select,textarea')) return;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      locked: null,
      width: rowRef.current?.getBoundingClientRect().width ?? 320,
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st || e.pointerId !== st.pointerId) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (st.locked === null) {
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
      // Horizontal lock — both directions accepted now.
      if (Math.abs(dx) > Math.abs(dy)) {
        st.locked = 'horizontal';
        setSwiping(true);
      } else {
        st.locked = 'vertical';
        dragState.current = null;
        return;
      }
    }
    if (st.locked === 'horizontal') {
      // Clamp: left side goes negative as before. Right side is
      // visually limited to ~REVEAL_PX + a little overshoot so the
      // gesture has a clear "ready to release" feel.
      const clamped = Math.max(-st.width, Math.min(REVEAL_PX + 24, dx));
      setSwipeX(clamped);
      e.preventDefault();
    }
  };

  const releaseSwipe = (snapTo: number, lockOpen: null | 'left') => {
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

    if (swipeX < 0) {
      // Left-swipe → delete path.
      const distance = -swipeX;
      if (distance >= width * AUTO_COMMIT_FRAC) {
        setCommitted(true);
        setSwipeX(-width);
        setSwiping(false);
        window.setTimeout(() => swipeCommit(item), 180);
      } else if (distance >= REVEAL_PX) {
        releaseSwipe(-REVEAL_PX - 24, 'left');
      } else {
        releaseSwipe(0, null);
      }
    } else if (swipeX > 0) {
      // Right-swipe → open sheet at threshold.
      if (swipeX >= REVEAL_PX) {
        // Animate back to 0 then open — same feel as a tap. The
        // user's intent ("show me edit") is the signal, not where the
        // row ends up.
        releaseSwipe(0, null);
        setSheetOpen(true);
      } else {
        releaseSwipe(0, null);
      }
    } else {
      releaseSwipe(0, null);
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current || e.pointerId !== dragState.current.pointerId) return;
    dragState.current = null;
    releaseSwipe(0, null);
  };

  // Tap on the locked-open row anywhere outside the delete button →
  // snap shut. Capture phase so we beat the child onClicks.
  const onRowClickCaptureWhileOpen = (e: React.MouseEvent) => {
    if (swipeLocked !== 'left') return;
    if ((e.target as HTMLElement).closest('[data-swipe-delete]')) return;
    e.preventDefault();
    e.stopPropagation();
    releaseSwipe(0, null);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Tap on the row's text area opens the ItemSheet for editing —
  // single behaviour across viewports. Read-only viewers don't open
  // the sheet. The sheet handles name/qty/unit + category + task
  // fields + the Löschen action.
  const onTextClick = () => {
    if (!canEdit) return;
    setSheetOpen(true);
  };

  // Compute derived chip data.
  const hasQtyOrUnit = item.quantity !== null || (item.unit && item.unit.trim() !== '');
  const qtyUnitLabel = hasQtyOrUnit
    ? ` · ${item.quantity ?? ''}${item.quantity !== null && item.unit ? ' ' : ''}${item.unit ?? ''}`.trimEnd()
    : '';
  const overdue = isOverdue(item.due_at, item.is_checked);
  const CategoryIcon =
    item.category && listType ? iconForCategory(listType, item.category) : null;

  const rowBody = (
    <div
      className={clsx(
        // 44px minimum height for comfortable tap targets on mobile.
        'group flex items-center gap-2 px-3 rounded-xl border transition min-h-[44px] py-1.5 sm:py-2',
        item.is_checked ? 'bg-page border-line' : 'bg-surface border-line',
      )}
      onClickCapture={onRowClickCaptureWhileOpen}
    >
      {canEdit && (
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted/60 hover:text-muted select-none touch-none size-7 inline-flex items-center justify-center"
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
        className="size-5 rounded-md accent-brand cursor-pointer shrink-0"
      />

      {/* Text area — single entry point on both viewports: tap opens
          the ItemSheet. Truncates aggressively; qty/unit ride after
          the text via a separator so they never wrap to a second
          line. Focusable via Tab → Enter (button semantics) so
          keyboard users get to the sheet without a mouse. */}
      <button
        type="button"
        onClick={onTextClick}
        disabled={!canEdit}
        className={clsx(
          'flex-1 min-w-0 text-left',
          canEdit && 'cursor-pointer',
        )}
      >
        <div
          className={clsx(
            'truncate text-[15px] sm:text-sm leading-snug',
            item.is_checked && 'line-through text-muted/70',
          )}
        >
          {item.text}
          {hasQtyOrUnit && (
            <span className="text-muted">{qtyUnitLabel}</span>
          )}
        </div>
      </button>

      {/* Chips — strict "render iff value set" rule. Order: assignee,
          due, category. Sized for the 44px row height. */}
      {item.assignee_id !== null && (
        <span
          title={item.assignee_name ?? 'Zugewiesen'}
          aria-label={item.assignee_name ?? 'Zugewiesen'}
          className="inline-flex size-5 items-center justify-center rounded-full bg-brand-50 text-brand-700 text-[10px] font-semibold shrink-0"
        >
          {taskInitials(item.assignee_name)}
        </span>
      )}
      {item.due_at && (
        <span
          className={clsx(
            'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-chip shrink-0',
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
      {CategoryIcon && item.category && (
        // Wrap in a span so the native `title` tooltip surfaces the
        // category name on hover/long-press without an extra label
        // node in the row.
        <span
          title={item.category}
          aria-label={item.category}
          className="shrink-0 inline-flex"
        >
          <CategoryIcon size={16} className="text-muted/70" />
        </span>
      )}
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative"
      // data-list-item-id is the deep-link anchor for /lists/<id>?task=<item>.
      // ListDetailPage scrolls the matching node into view + adds a brief
      // .task-pulse ring when it lands.
      data-list-item-id={item.id}
    >
      {/* Red action backdrop — only shown while the user is actually
          swiping left or has the row locked open. Right-swipe doesn't
          need a backdrop; the row stops at +REVEAL_PX and the gesture
          releases into a sheet open. */}
      {canEdit && (swiping || swipeLocked === 'left' || committed) && swipeX <= 0 && (
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
      {/* Right-swipe affordance — a quiet "edit" cue under the row so
          the user feels they're pulling out an action, not just
          dragging the row sideways. */}
      {canEdit && swiping && swipeX > 0 && (
        <div className="absolute inset-0 rounded-xl bg-brand-50 text-brand-700 flex items-center pl-4 select-none">
          <span className="text-sm font-medium">Bearbeiten…</span>
        </div>
      )}
      <div
        ref={rowRef}
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

      {/* Edit sheet — mobile bottom sheet or desktop popover anchored
          to the kebab. Mounted regardless of `sheetOpen` so the
          close-on-empty path stays mounted; the sheet itself bails
          when `open` is false. */}
      {canEdit && listType && (
        <ItemSheet
          open={sheetOpen}
          item={item}
          listType={listType}
          canEdit={canEdit}
          assignableUsers={assignableUsers ?? []}
          onClose={() => setSheetOpen(false)}
          onUpdate={(patch) => onUpdate(item, patch)}
          onDelete={() => onDelete(item)}
        />
      )}
    </div>
  );
}
