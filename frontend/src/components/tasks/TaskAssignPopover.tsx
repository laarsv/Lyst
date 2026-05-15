/** Compact popover used by list items + note task-list items to
 *  upgrade themselves into a task: pick an assignee, a due-at, a
 *  reminder-at, or clear the lot. Desktop = anchored popover under
 *  the trigger; mobile = bottom-sheet via portal.
 *
 *  The popover is dumb — the caller owns the persistence call. We
 *  hand back a patch object via onChange and let the caller decide
 *  whether that goes to PATCH /lists/{id}/items/{item_id} or
 *  PATCH /notes/{id}/tasks/{task_id}.
 *
 *  The assignee list is supplied as a prop because lists pull from
 *  collaborators, notes pull from share recipients. Both already have
 *  the row sets cached at the page level so we don't re-fetch here.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, BellRing, UserCircle2, X } from 'lucide-react';

export interface TaskAssignableUser {
  id: number;
  name: string;
}

export interface TaskPopoverValue {
  assignee_id: number | null;
  due_at: string | null; // ISO 8601
  reminder_at: string | null;
}

interface Props {
  open: boolean;
  /** DOM element to anchor the popover to (desktop only). Mobile
   *  ignores it and renders a bottom sheet. */
  anchor: HTMLElement | null;
  value: TaskPopoverValue;
  users: TaskAssignableUser[];
  onClose: () => void;
  /** Fires for each individual field change. The caller debounces /
   *  batches the PATCH. */
  onChange: (patch: Partial<TaskPopoverValue>) => void;
  /** Clear all three task fields in a single shot. */
  onClear: () => void;
}

const MOBILE_MQ = '(max-width: 767.98px)';

export function TaskAssignPopover({
  open,
  anchor,
  value,
  users,
  onClose,
  onChange,
  onClear,
}: Props) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(MOBILE_MQ).matches,
  );
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Position the popover under the anchor on desktop. We use a simple
  // rect-based placement — Floating UI is overkill for a popover this
  // small and always-opens-below.
  useEffect(() => {
    if (!open || !anchor || isMobile) return;
    const update = () => {
      const r = anchor.getBoundingClientRect();
      setPos({
        top: r.bottom + window.scrollY + 6,
        // Right-align so the popover doesn't fall off the right edge
        // of a narrow list-item row. Min-width below clamps to a
        // usable width.
        left: Math.max(8, r.right + window.scrollX - 260),
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [open, anchor, isMobile]);

  // Click-outside + Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !anchor?.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;

  const body = (
    <div
      ref={popoverRef}
      className="card p-3 shadow-flat border border-line bg-surface flex flex-col gap-3 min-w-[260px]"
      // Stop mousedowns from bubbling to a parent that would close us.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted">Aufgabe</div>
        <button
          type="button"
          aria-label="Schließen"
          onClick={onClose}
          className="size-6 inline-flex items-center justify-center rounded-ctl text-muted hover:bg-page"
        >
          <X size={14} />
        </button>
      </div>

      <FieldRow icon={UserCircle2} label="Zuweisen an">
        <select
          className="input py-1.5 text-sm"
          value={value.assignee_id ?? ''}
          onChange={(e) =>
            onChange({
              assignee_id: e.target.value === '' ? null : Number(e.target.value),
            })
          }
        >
          <option value="">— Niemand —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow icon={CalendarClock} label="Fällig am">
        <input
          type="datetime-local"
          className="input py-1.5 text-sm"
          value={toLocalInput(value.due_at)}
          onChange={(e) =>
            onChange({ due_at: fromLocalInput(e.target.value) })
          }
        />
      </FieldRow>

      <FieldRow icon={BellRing} label="Erinnerung">
        <input
          type="datetime-local"
          className="input py-1.5 text-sm"
          value={toLocalInput(value.reminder_at)}
          onChange={(e) =>
            onChange({ reminder_at: fromLocalInput(e.target.value) })
          }
        />
      </FieldRow>

      <div className="flex justify-end pt-1 border-t border-line/60">
        <button
          type="button"
          onClick={onClear}
          disabled={
            value.assignee_id === null &&
            value.due_at === null &&
            value.reminder_at === null
          }
          className="text-xs text-danger hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Aufgabe entfernen
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    // Bottom sheet — full-width, dismiss on backdrop.
    return createPortal(
      <div
        className="fixed inset-0 z-[70] bg-ink/40 flex items-end"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="w-full bg-surface rounded-t-card border-t border-line p-3"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
        >
          {body}
        </div>
      </div>,
      document.body,
    );
  }

  // Desktop — anchored portal so the popover can leave the editor /
  // list scroll container without getting clipped.
  return createPortal(
    <div
      style={{
        position: 'absolute',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        zIndex: 60,
      }}
    >
      {body}
    </div>,
    document.body,
  );
}

function FieldRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof UserCircle2;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] text-muted flex items-center gap-1.5">
        <Icon size={12} />
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

/** ISO 8601 (with TZ) → local `datetime-local` input value, which
 *  expects "YYYY-MM-DDTHH:MM" with no timezone. We render in the
 *  user's local zone so the picker behaves intuitively. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Local `datetime-local` value → ISO 8601 with timezone offset. Empty
 *  string => null (clears the field). */
export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
