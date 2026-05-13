/** Filter icon button with a small brand-colored dot when any filter is set.
 *  44×44 tap target on mobile per the iOS HIG. */
import { SlidersHorizontal } from 'lucide-react';

interface Props {
  active: boolean;
  onClick: () => void;
  className?: string;
}

export function NotesFilterButton({ active, onClick, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? 'Filter (aktiv)' : 'Filter'}
      aria-pressed={active}
      className={`relative size-11 inline-flex items-center justify-center rounded-ctl border border-line bg-surface text-ink hover:bg-page transition ${className}`}
    >
      <SlidersHorizontal size={18} />
      {active && (
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand"
        />
      )}
    </button>
  );
}
