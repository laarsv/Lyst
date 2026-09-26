import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState, type ReactNode } from 'react';

interface Props {
  id: number | string;
  children: ReactNode;
  onDelete?: () => void;
}

export function SortableEditRow({ id, children, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-start gap-2 p-2 rounded-xl border border-line bg-surface"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted/60 hover:text-muted select-none touch-none size-7 inline-flex items-center justify-center"
        aria-label="Verschieben"
      >
        ⋮⋮
      </button>
      <div className="flex-1 min-w-0">{children}</div>
      {onDelete && confirming && (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 self-center rounded-lg bg-danger px-2 py-1 text-xs font-medium text-white"
        >
          Löschen
        </button>
      )}
      {onDelete && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition text-muted/70 hover:text-danger px-1"
          aria-label="Löschen"
        >
          ×
        </button>
      )}
    </div>
  );
}
