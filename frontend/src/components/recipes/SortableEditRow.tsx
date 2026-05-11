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
      className="group flex items-start gap-2 p-2 rounded-xl border border-zinc-100 bg-white"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-zinc-300 hover:text-zinc-500 px-1 py-1 select-none"
        aria-label="Verschieben"
      >
        ⋮⋮
      </button>
      <div className="flex-1 min-w-0">{children}</div>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition text-zinc-400 hover:text-red-500 px-1"
          aria-label="Löschen"
        >
          ×
        </button>
      )}
    </div>
  );
}
