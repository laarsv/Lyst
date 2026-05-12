import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState } from 'react';
import type { ListItem } from '@/types';
import clsx from 'clsx';
import { Lock, Tag } from 'lucide-react';

const CATEGORIES = [
  'Obst & Gemüse',
  'Milchprodukte',
  'Tiefkühl',
  'Backwaren',
  'Fleisch & Fisch',
  'Getränke',
  'Trockenwaren',
  'Süßes',
  'Hygiene',
  'Sonstiges',
];

interface Props {
  item: ListItem;
  canEdit: boolean;
  onToggle: (item: ListItem) => void;
  onUpdate: (item: ListItem, patch: Partial<ListItem>) => void;
  onDelete: (item: ListItem) => void;
}

export function SortableItem({ item, canEdit, onToggle, onUpdate, onDelete }: Props) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'group flex items-center gap-2 px-3 py-2.5 rounded-xl border transition',
        item.is_checked ? 'bg-page border-line' : 'bg-surface border-line',
      )}
    >
      {canEdit && (
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted/60 hover:text-muted px-1 select-none"
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
          />
          <input
            className="input w-20 py-1.5"
            value={unit}
            placeholder="Einheit"
            onChange={(e) => setUnit(e.target.value)}
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
      {canEdit && !editing && (
        <CategoryChip
          item={item}
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
}

function CategoryChip({
  item,
  onPick,
}: {
  item: ListItem;
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
          {CATEGORIES.map((c) => (
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
