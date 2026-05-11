import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState } from 'react';
import type { ListItem } from '@/types';
import clsx from 'clsx';

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
        item.is_checked ? 'bg-page border-line' : 'bg-white border-line',
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
