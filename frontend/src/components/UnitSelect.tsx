import { UNIT_OPTIONS, isKnownUnit } from '@/lib/units';

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Dropdown for recipe ingredient units. Free-text is intentionally not
 *  allowed; if an existing recipe (e.g. one imported via the AI URL/photo
 *  importer) has a unit that isn't in the canonical list, we surface it as
 *  an extra option labelled "… (importiert)" so the value isn't silently
 *  dropped — the user can still keep it or pick a canonical replacement. */
export function UnitSelect({
  value,
  onChange,
  className = '',
  disabled = false,
  ariaLabel,
}: Props) {
  const current = value ?? '';
  const showExtra = value !== null && value !== '' && !isKnownUnit(value);
  return (
    <select
      className={`input py-1.5 ${className}`}
      value={current}
      disabled={disabled}
      aria-label={ariaLabel ?? 'Einheit'}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      {UNIT_OPTIONS.map((u) => (
        <option key={u.value} value={u.value}>
          {u.label}
        </option>
      ))}
      {showExtra && (
        <option value={value!}>{value} (importiert)</option>
      )}
    </select>
  );
}
