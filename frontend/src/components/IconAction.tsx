/** Compact icon button used in detail-page action rows.
 *
 *  40×40 tap target, lucide icon centered, optional tooltip via the `title`
 *  attribute (and `aria-label` for screen readers). Three visual variants:
 *
 *    - default : muted border, transparent bg → "secondary" feel
 *    - primary : filled brand colour            → main action
 *    - danger  : danger text colour, kept on a muted border so it doesn't
 *                shout at the user constantly
 *
 *  Originally inlined inside ListDetail; lifted out here so RecipeDetail
 *  (and any future detail page) can match it without copy-paste drift. */
import type { LucideIcon } from 'lucide-react';

interface Props {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  className?: string;
}

const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
  default: 'border border-line bg-transparent text-ink hover:bg-page',
  primary: 'bg-brand text-white hover:bg-brand-700 border border-brand',
  danger: 'border border-line bg-transparent text-danger hover:bg-page',
};

export function IconAction({
  label,
  icon: Icon,
  onClick,
  variant = 'default',
  disabled = false,
  className = '',
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`size-10 inline-flex items-center justify-center rounded-ctl transition disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      <Icon size={18} />
    </button>
  );
}
