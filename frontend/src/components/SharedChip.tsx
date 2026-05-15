/** Tiny "this resource is shared" indicator for overview cards.
 *
 *  Used by NoteCard, ListCard, RecipeCard so owners can tell at a
 *  glance which of their things are shared. Reads the resource's
 *  ShareState — renders nothing when the resource isn't shared at
 *  all OR when share_state is null (recipient-side view; we
 *  deliberately hide the count of OTHER recipients).
 *
 *  Tooltip combines the two halves:
 *    internal only     → "Geteilt mit N Personen"
 *    public only       → "Öffentlich geteilt"
 *    both              → "Geteilt mit N Personen und öffentlich"
 *
 *  The icon is the lucide Users glyph (for internal) or Globe (for
 *  public-only). The combined case still uses Users — the tooltip
 *  carries the public-token half.
 */
import { Globe, Users } from 'lucide-react';
import type { ShareState } from '@/types';

interface Props {
  state: ShareState | null | undefined;
  className?: string;
}

export function SharedChip({ state, className }: Props) {
  if (!state) return null;
  const { internal_count, public: isPublic } = state;
  if (internal_count === 0 && !isPublic) return null;

  // Pick the icon by what's primary. Public-only gets the globe; any
  // internal sharing gets the people glyph (even when public is also
  // on — internal is the more interesting signal for the owner).
  const Icon = internal_count > 0 ? Users : Globe;

  let label: string;
  if (internal_count > 0 && isPublic) {
    label = `Geteilt mit ${internal_count} ${internal_count === 1 ? 'Person' : 'Personen'} und öffentlich`;
  } else if (internal_count > 0) {
    label = `Geteilt mit ${internal_count} ${internal_count === 1 ? 'Person' : 'Personen'}`;
  } else {
    label = 'Öffentlich geteilt';
  }

  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-0.5 text-[10px] text-muted/80 ${
        className ?? ''
      }`}
    >
      <Icon size={12} />
      {internal_count > 0 && (
        <span className="tabular-nums">{internal_count}</span>
      )}
    </span>
  );
}
