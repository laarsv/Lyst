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
  const { internal_count, public: isPublic, via_book: viaBook } = state;
  if (internal_count === 0 && !isPublic && !viaBook) return null;

  // Pick the icon by what's primary. Public-only gets the globe; any
  // internal sharing OR book coverage gets the people glyph since
  // both imply "named individuals can see this".
  const showsPeople = internal_count > 0 || viaBook;
  const Icon = showsPeople ? Users : Globe;

  // Build a multi-phrase tooltip when several share modes apply at once.
  const parts: string[] = [];
  if (internal_count > 0) {
    parts.push(
      `Geteilt mit ${internal_count} ${
        internal_count === 1 ? 'Person' : 'Personen'
      }`,
    );
  }
  if (viaBook) {
    parts.push('Teil des geteilten Rezeptbuchs');
  }
  if (isPublic) {
    parts.push('Öffentlich geteilt');
  }
  // Join with " · " — keeps the tooltip compact even when all three
  // are true. The default branch can't fire here (we already
  // returned early when nothing was set).
  const label = parts.join(' · ');

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
