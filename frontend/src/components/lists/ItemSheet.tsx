/** Edit sheet for a single list item.
 *
 *  One component, two presentations: a bottom sheet on mobile and an
 *  anchored popover on desktop. The contents are identical — the
 *  desktop kebab swaps the chrome around them.
 *
 *  Fields fall in two sections:
 *    "Item"    — name, quantity, unit, category
 *    "Aufgabe" — assignee, due_at, reminder_at
 *  The "Aufgabe" header is hidden when the parent list has no
 *  assignable users (no collaborators) so the section doesn't look
 *  empty.
 *
 *  All edits flow through `onUpdate`. The sheet is dumb — it doesn't
 *  debounce or batch; the parent owns the PATCH. Simple text edits
 *  fire onUpdate on blur (so the typing experience stays snappy); the
 *  dropdowns/datetime pickers fire on change. The Save button is just
 *  a close button — there's no separate commit step because every
 *  field already saved on blur/change.
 *
 *  The Löschen button surfaces inside the sheet so the user doesn't
 *  have to close + then find the delete elsewhere. Routes through the
 *  same softDelete the swipe gesture uses — undo toast included.
 */
import { useEffect, useRef, useState } from 'react';
import { useScrollLock } from '@/hooks/useScrollLock';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ListItem, ListType } from '@/types';
import { UnitCombobox } from '@/components/UnitCombobox';
import { categoriesForType, iconForCategory } from '@/data/listCategories';
import {
  fromLocalInput,
  toLocalInput,
} from '@/components/tasks/TaskAssignPopover';

interface AssignableUser {
  id: number;
  name: string;
}

interface Props {
  open: boolean;
  item: ListItem;
  listType: ListType;
  canEdit: boolean;
  assignableUsers: AssignableUser[];
  onClose: () => void;
  onUpdate: (patch: Partial<ListItem>) => void;
  onDelete: () => void;
}

const MOBILE_MQ = '(max-width: 767.98px)';

export function ItemSheet({
  open,
  item,
  listType,
  canEdit,
  assignableUsers,
  onClose,
  onUpdate,
  onDelete,
}: Props) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(MOBILE_MQ).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Escape closes; backdrop click handled inline on the wrapper.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Body lock for both presentations — the same component drives the
  // mobile bottom sheet AND the desktop centred modal, and both
  // benefit from a frozen background.
  useScrollLock(open);

  // Mobile-only: swipe-down on the sheet handle closes it. Cheap
  // touch-event listener — we only need the y-delta on release.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || !isMobile || !sheetRef.current) return;
    const el = sheetRef.current;
    let startY: number | null = null;
    let dy = 0;
    const onStart = (e: TouchEvent) => {
      // Only react to drags that start on the handle area (top 32px).
      const t = e.touches[0];
      const r = el.getBoundingClientRect();
      if (t.clientY - r.top > 32) return;
      startY = t.clientY;
      dy = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      el.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = () => {
      if (startY === null) return;
      el.style.transform = '';
      if (dy > 80) onClose();
      startY = null;
      dy = 0;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [open, isMobile, onClose]);

  if (!open) return null;

  const categories = categoriesForType(listType);
  const showAufgabe = canEdit; // due/reminder always allowed even without collaborators

  const body = (
    <ItemFields
      item={item}
      listType={listType}
      categories={categories}
      canEdit={canEdit}
      assignableUsers={assignableUsers}
      showAufgabe={showAufgabe}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onClose={onClose}
    />
  );

  if (isMobile) {
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
          ref={sheetRef}
          className="w-full bg-surface rounded-t-card border-t border-line shadow-flat max-h-[85vh] overflow-y-auto pb-6 transition-transform duration-200"
          style={{
            paddingBottom: 'env(safe-area-inset-bottom, 24px)',
          }}
        >
          {/* Drag handle / pull bar */}
          <div className="flex justify-center pt-2 pb-3 select-none">
            <span className="block w-10 h-1 rounded-full bg-line" aria-hidden />
          </div>
          {body}
        </div>
      </div>,
      document.body,
    );
  }

  // Desktop: centred modal. 480px wide, vertically centred, dimmed
  // backdrop, click-outside to close. Same fields/buttons as the
  // mobile bottom sheet — only the chrome differs.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-ink/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[480px] bg-surface rounded-card border border-line shadow-flat max-h-[85vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>,
    document.body,
  );
}

function ItemFields({
  item,
  listType,
  categories,
  canEdit,
  assignableUsers,
  showAufgabe,
  onUpdate,
  onDelete,
  onClose,
}: {
  item: ListItem;
  listType: ListType;
  categories: string[] | null;
  canEdit: boolean;
  assignableUsers: AssignableUser[];
  showAufgabe: boolean;
  onUpdate: (patch: Partial<ListItem>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Local state for the text input so typing doesn't push a PATCH
  // per keystroke. Saved on blur, on Enter, and again on close.
  const [text, setText] = useState(item.text);
  const [qty, setQty] = useState(item.quantity?.toString() ?? '');
  const [unit, setUnit] = useState(item.unit ?? '');
  useEffect(() => {
    setText(item.text);
    setQty(item.quantity?.toString() ?? '');
    setUnit(item.unit ?? '');
  }, [item.id, item.text, item.quantity, item.unit]);

  const commitText = () => {
    const trimmed = text.trim();
    if (trimmed && trimmed !== item.text) onUpdate({ text: trimmed });
  };
  const commitQty = () => {
    const next = qty === '' ? null : Number(qty);
    if (next !== item.quantity && !(qty !== '' && Number.isNaN(next))) {
      onUpdate({ quantity: next as number | null });
    }
  };
  const commitUnit = () => {
    const next = unit.trim() || null;
    if (next !== item.unit) onUpdate({ unit: next });
  };

  // Save outstanding text/qty/unit when the sheet closes.
  useEffect(
    () => () => {
      commitText();
      commitQty();
      commitUnit();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="px-4 sm:px-5 pb-3 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Item</div>
        <button
          type="button"
          aria-label="Schließen"
          onClick={onClose}
          className="size-7 inline-flex items-center justify-center rounded-ctl text-muted hover:bg-page"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3">
        <Field label="Name">
          <input
            className="input"
            value={text}
            disabled={!canEdit}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
          />
        </Field>

        <div className="flex gap-3">
          <div className="w-24">
            <Field label="Menge">
              <input
                className="input"
                value={qty}
                inputMode="decimal"
                disabled={!canEdit}
                onChange={(e) => setQty(e.target.value)}
                onBlur={commitQty}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </Field>
          </div>
          <div className="flex-1 min-w-0">
            <FieldGroup label="Einheit">
              <UnitCombobox
                value={unit || null}
                onChange={(u) => {
                  const next = u ?? '';
                  setUnit(next);
                  // UnitCombobox doesn't fire on blur; commit eagerly.
                  if ((next || null) !== item.unit) {
                    onUpdate({ unit: next.trim() || null });
                  }
                }}
              />
            </FieldGroup>
          </div>
        </div>

        {categories && (
          <FieldGroup label="Kategorie">
            <CategoryDropdown
              value={item.category}
              categories={categories}
              listType={listType}
              disabled={!canEdit}
              onChange={(cat) => onUpdate({ category: cat })}
            />
          </FieldGroup>
        )}
      </div>

      {showAufgabe && (
        <>
          <div className="flex items-center gap-2 pt-1">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Aufgabe
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="space-y-3">
            <Field label="Zuweisen an">
              <select
                className="input"
                value={item.assignee_id ?? ''}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({
                    assignee_id:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">— niemand</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Fällig">
              <input
                type="datetime-local"
                className="input"
                value={toLocalInput(item.due_at)}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({ due_at: fromLocalInput(e.target.value) })
                }
              />
            </Field>

            <Field label="Erinnerung">
              <input
                type="datetime-local"
                className="input"
                value={toLocalInput(item.reminder_at)}
                disabled={!canEdit}
                onChange={(e) =>
                  onUpdate({ reminder_at: fromLocalInput(e.target.value) })
                }
              />
            </Field>
          </div>
        </>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-line">
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              onDelete();
              onClose();
            }}
            className="text-sm text-danger hover:underline"
          >
            Löschen
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onClose}
          className="btn-primary text-sm py-1.5"
        >
          Fertig
        </button>
      </div>
    </div>
  );
}

/** Das <label> UMSCHLIESST das Feld (implizite Verknuepfung, kein id noetig).
 *  Zusammengesetzte Bedienelemente — Combobox, Dropdown — gehoeren in
 *  FieldGroup: ein Label darf nur EIN Formularfeld umschliessen, und die
 *  Buttons darin wuerden sonst zusaetzlich das Feld fokussieren. */
function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="block text-[11px] uppercase tracking-wide text-muted mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-muted mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function CategoryDropdown({
  value,
  categories,
  listType,
  disabled,
  onChange,
}: {
  value: string | null;
  categories: string[];
  listType: ListType;
  disabled: boolean;
  onChange: (cat: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {value &&
        (() => {
          const Icon = iconForCategory(listType, value);
          return <Icon size={16} className="text-muted shrink-0" />;
        })()}
      <select
        className="input flex-1"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">— keine</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );
}
