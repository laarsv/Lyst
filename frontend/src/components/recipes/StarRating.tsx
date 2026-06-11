import clsx from 'clsx';
import { Star } from 'lucide-react';

interface Props {
  /** Current rating 0–5. 0 renders all-empty. */
  value: number;
  /** Omit to render read-only (no hover/click). Clicking the current value
   *  again clears the rating (→ 0). */
  onChange?: (value: number) => void;
  size?: number;
  className?: string;
  ariaLabel?: string;
}

/** Five-star rating. Filled stars use amber (gold is the universal rating
 *  colour and reads correctly on both light surface and dark); empty stars
 *  fall back to the muted line token. */
export function StarRating({ value, onChange, size = 20, className, ariaLabel }: Props) {
  const readOnly = !onChange;
  return (
    <div
      className={clsx('inline-flex items-center gap-0.5', className)}
      role={readOnly ? 'img' : 'radiogroup'}
      aria-label={ariaLabel ?? `Bewertung ${value} von 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        return (
          <button
            key={n}
            type="button"
            disabled={readOnly}
            onClick={() => onChange?.(n === value ? 0 : n)}
            className={clsx(
              'p-0.5 rounded-md',
              readOnly ? 'cursor-default' : 'hover:scale-110 transition-transform',
            )}
            aria-label={`${n} ${n === 1 ? 'Stern' : 'Sterne'}`}
          >
            <Star
              size={size}
              className={filled ? 'fill-amber-400 text-amber-400' : 'text-line'}
            />
          </button>
        );
      })}
    </div>
  );
}
