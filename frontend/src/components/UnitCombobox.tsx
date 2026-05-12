/** Combobox for list-item units: text input + dropdown of canonical units.
 *
 *  - Picking from the dropdown commits immediately (onChange fires).
 *  - Typing a custom unit and pressing Enter or blurring commits.
 *  - Empty value commits as null ("no unit").
 *
 *  Built without an external combobox library because the rest of Lyst is
 *  Radix-free; a 70-line custom control is easier to reason about than a
 *  third-party dependency tree just for this. */
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { CANONICAL_UNITS } from '@/utils/units';

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function UnitCombobox({
  value,
  onChange,
  className = '',
  ariaLabel = 'Einheit',
  placeholder = 'Einheit',
  disabled = false,
}: Props) {
  const [draft, setDraft] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        commit();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  const commit = () => {
    const cleaned = draft.trim();
    const next = cleaned === '' ? null : cleaned;
    if (next !== value) onChange(next);
  };

  const pick = (next: string | null) => {
    setDraft(next ?? '');
    if (next !== value) onChange(next);
    setOpen(false);
  };

  // Filter as the user types so the dropdown doubles as autocomplete. Show
  // everything when the field is empty.
  const q = draft.trim().toLowerCase();
  const filtered = q
    ? CANONICAL_UNITS.filter((u) => u.toLowerCase().startsWith(q))
    : CANONICAL_UNITS;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        type="text"
        className="input w-full py-1.5 pr-12"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            setOpen(false);
          } else if (e.key === 'Escape') {
            setDraft(value ?? '');
            setOpen(false);
          } else if (e.key === 'ArrowDown' && !open) {
            setOpen(true);
          }
        }}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
        {draft && !disabled && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="p-1 text-muted/70 hover:text-ink"
            aria-label="Einheit löschen"
            tabIndex={-1}
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          className="p-1 text-muted/70 hover:text-ink"
          aria-label="Einheit auswählen"
          tabIndex={-1}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 left-0 right-0 max-h-60 overflow-y-auto rounded-ctl border border-line bg-surface shadow-flat"
        >
          <li
            role="option"
            aria-selected={value === null || value === ''}
            className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-page text-muted ${
              value === null || value === '' ? 'bg-brand-50 text-brand-700' : ''
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(null);
            }}
          >
            — ohne —
          </li>
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted/70">
              Enter drücken um „{draft}" zu übernehmen
            </li>
          ) : (
            filtered.map((u) => (
              <li
                key={u}
                role="option"
                aria-selected={value === u}
                className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-page ${
                  value === u ? 'bg-brand-50 text-brand-700' : ''
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(u);
                }}
              >
                {u}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
