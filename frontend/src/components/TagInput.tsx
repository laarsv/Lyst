import { useState } from 'react';
import type { SuggestedTagGroup } from '@/data/recipeTags';

/** Free-form tag input — extracted verbatim from the recipe-edit tag picker
 *  so recipes and plants share one implementation. Chips for applied tags, a
 *  text field with `<datalist>` autocomplete, and curated quick-pick group
 *  chips below. Tags are free-form strings; suggestions are hints only.
 *
 *  `labelAction` is an optional slot to the right of the label (recipes use
 *  it for their "Tags vorschlagen (KI)" button); plants pass nothing. */
export function TagInput({
  label,
  value,
  onChange,
  suggestionGroups,
  datalistId,
  placeholder = '+ tag',
  labelAction,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestionGroups: SuggestedTagGroup[];
  datalistId: string;
  placeholder?: string;
  labelAction?: React.ReactNode;
}) {
  const [input, setInput] = useState('');
  const flat = suggestionGroups.flatMap((g) => g.tags);

  const addTag = () => {
    const v = input.trim().replace(/^#/, '');
    if (v && !value.includes(v)) onChange([...value, v]);
    setInput('');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="label !mb-0">{label}</label>
        {labelAction}
      </div>
      <div className="flex flex-wrap items-center gap-1 input min-h-[42px] py-2">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-xs bg-page px-2 py-1 rounded-full">
            #{t}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== t))}
              className="text-muted/70 hover:text-danger"
            >
              ×
            </button>
          </span>
        ))}
        <input
          list={datalistId}
          className="flex-1 min-w-[100px] outline-none text-sm"
          placeholder={placeholder}
          value={input}
          inputMode="text"
          enterKeyHint="done"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              // stopPropagation so an ancestor form doesn't claim the Enter
              // and shift focus to the next field.
              e.preventDefault();
              e.stopPropagation();
              addTag();
              e.currentTarget.focus();
            }
          }}
          onBlur={addTag}
        />
        <datalist id={datalistId}>
          {flat.filter((t) => !value.includes(t)).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      {/* Curated quick-pick chips. Hidden when all suggestions are applied so
          the form stays quiet for users who pick custom tags only. */}
      {suggestionGroups.some((g) => g.tags.some((t) => !value.includes(t))) && (
        <div className="mt-2 space-y-1">
          {suggestionGroups.map((group) => {
            const remaining = group.tags.filter((t) => !value.includes(t));
            if (remaining.length === 0) return null;
            return (
              <div key={group.label} className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] uppercase tracking-wider text-muted w-20 shrink-0">
                  {group.label}
                </span>
                {remaining.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onChange([...value, t])}
                    className="inline-flex items-center text-xs bg-page hover:bg-brand-50 hover:text-brand-700 px-2 py-1 rounded-full border border-line transition"
                  >
                    + {t}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
