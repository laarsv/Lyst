import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type ReactNode } from 'react';

interface Props {
  id: number | string;
  children: ReactNode;
  onDelete?: () => void;
}

export function SortableEditRow({ id, children, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
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
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition text-muted/70 hover:text-danger px-1"
          aria-label="Löschen"
        >
          ×
        </button>
      )}
    </div>
  );
}
