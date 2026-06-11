import clsx from 'clsx';
import type { RecipeOrigin } from '@/types';

const ORIGIN_META: Record<RecipeOrigin, { icon: string; label: string }> = {
  structured_import: { icon: '📋', label: 'Direktimport (ohne KI)' },
  ai_variant: { icon: '🔀', label: 'KI-Variante' },
  ai_import: { icon: '🤖', label: 'KI-Import' },
  manual: { icon: '✏️', label: 'Manuell erstellt' },
};

/** Small, muted provenance marker — where a recipe came from. Mirrors the
 *  share-state badge's understated style. */
export function RecipeOriginBadge({
  origin,
  className,
}: {
  origin: RecipeOrigin;
  className?: string;
}) {
  const meta = ORIGIN_META[origin];
  if (!meta) return null;
  return (
    <span
      className={clsx('text-xs leading-none opacity-70 shrink-0 cursor-default', className)}
      title={meta.label}
      aria-label={meta.label}
    >
      {meta.icon}
    </span>
  );
}
