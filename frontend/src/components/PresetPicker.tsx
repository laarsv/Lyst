/** Combined emoji + colour picker for a list's icon and accent.
 *
 *  Renders a single trigger button — a colour-filled circle showing the
 *  current emoji — and on click pops a picker. Picker layout:
 *    - Desktop  (≥ 768 px): 360 px popover anchored under the trigger
 *    - Mobile   (< 768 px): full-screen modal
 *
 *  Picker body is the same in both layouts:
 *    - Header   : live preview circle + search input
 *    - Body     : scrollable groups of preset circles (paired emoji+colour)
 *    - Footer   : "Eigenes Emoji" text input + "Eigene Farbe" colour picker
 *
 *  Picking a preset sets both fields and closes the picker. The footer
 *  inputs override one field at a time without touching the other, so
 *  users can pick a preset then dial in a custom shade. */
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  filterPresetGroups,
  type Preset,
} from '@/data/presets';

interface Props {
  emoji: string;
  color: string;
  onChange: (next: { emoji: string; color: string }) => void;
  ariaLabel?: string;
  className?: string;
}

const FALLBACK_COLOR = '#5e7a8a';

export function PresetPicker({
  emoji,
  color,
  onChange,
  ariaLabel = 'Symbol auswählen',
  className = '',
}: Props) {
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Reset the search field when the picker re-opens — last session's
  // filter would otherwise be confusing.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Esc closes (both layouts). Desktop popover also closes on outside click;
  // the mobile sheet covers the whole viewport so backdrop logic is moot.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open || isMobile) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, isMobile]);

  const pickPreset = (p: Preset) => {
    onChange({ emoji: p.emoji, color: p.color });
    setOpen(false);
  };

  const groups = filterPresetGroups(query);

  const triggerColor = color || FALLBACK_COLOR;

  return (
    <div className={`relative inline-block ${className}`}>
      {/* Trigger — 56×56 desktop, 64×64 mobile. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`rounded-full inline-flex items-center justify-center shadow-sm hover:shadow-md transition ${
          isMobile ? 'size-16 text-3xl' : 'size-14 text-2xl'
        }`}
        style={{ background: triggerColor }}
      >
        <span aria-hidden="true">{emoji || '?'}</span>
      </button>

      {/* Desktop popover */}
      {open && !isMobile && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={ariaLabel}
          className="absolute z-30 left-0 top-full mt-2 w-[360px] h-[480px] flex flex-col card border border-line bg-surface shadow-flat overflow-hidden"
        >
          <PickerBody
            emoji={emoji}
            color={color}
            query={query}
            onQueryChange={setQuery}
            groups={groups}
            onPickPreset={pickPreset}
            onChange={onChange}
            autoFocusSearch
          />
        </div>
      )}

      {/* Mobile full-screen sheet */}
      {open && isMobile && (
        <div
          className="fixed inset-0 z-[60] bg-surface flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-line shrink-0">
            <h2 className="font-semibold text-base">Symbol wählen</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Schließen"
              className="size-11 inline-flex items-center justify-center rounded-ctl text-muted hover:text-ink hover:bg-page"
            >
              <X size={20} />
            </button>
          </div>
          <PickerBody
            emoji={emoji}
            color={color}
            query={query}
            onQueryChange={setQuery}
            groups={groups}
            onPickPreset={pickPreset}
            onChange={onChange}
            autoFocusSearch={false}
            isMobile
          />
        </div>
      )}
    </div>
  );
}

/** Shared body — same content in popover and sheet, only the outer chrome
 *  differs. Uses flex column with `flex-1 min-h-0 overflow-y-auto` on the
 *  groups area so the header and footer stay pinned. */
function PickerBody({
  emoji,
  color,
  query,
  onQueryChange,
  groups,
  onPickPreset,
  onChange,
  autoFocusSearch,
  isMobile = false,
}: {
  emoji: string;
  color: string;
  query: string;
  onQueryChange: (q: string) => void;
  groups: ReturnType<typeof filterPresetGroups>;
  onPickPreset: (p: Preset) => void;
  onChange: (next: { emoji: string; color: string }) => void;
  autoFocusSearch: boolean;
  isMobile?: boolean;
}) {
  const previewColor = color || FALLBACK_COLOR;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header: live preview + search */}
      <div className="px-3 pt-3 pb-2 border-b border-line shrink-0 bg-surface">
        <div className="flex items-center gap-2">
          <div
            aria-hidden="true"
            className="size-11 rounded-full inline-flex items-center justify-center text-2xl shrink-0 shadow-sm"
            style={{ background: previewColor }}
          >
            <span>{emoji || '?'}</span>
          </div>
          <div className="relative flex-1 min-w-0">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none"
            />
            <input
              aria-label="Symbol suchen"
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Suchen oder eigenes Emoji eingeben..."
              autoFocus={autoFocusSearch}
              className="input w-full pl-8 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Groups — the only scrollable region. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {groups.length === 0 ? (
          <div className="text-sm text-muted/70 py-6 text-center">Keine Treffer.</div>
        ) : (
          groups.map((g) => (
            <section key={g.id}>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1.5 px-0.5">
                {g.label}
              </div>
              <div className={isMobile ? 'grid grid-cols-5 gap-2' : 'grid grid-cols-8 gap-1.5'}>
                {g.presets.map((p, idx) => {
                  const selected = p.emoji === emoji && p.color === color;
                  return (
                    <button
                      key={`${g.id}-${p.emoji}-${idx}`}
                      type="button"
                      onClick={() => onPickPreset(p)}
                      title={p.aliases[0] ?? p.emoji}
                      className={`size-10 rounded-full inline-flex items-center justify-center text-lg transition hover:scale-105 hover:shadow ${
                        selected
                          ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface'
                          : ''
                      }`}
                      style={{ background: p.color }}
                    >
                      <span aria-hidden="true">{p.emoji}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Footer — custom emoji + custom colour. Each overrides only its
          own field, so users can pick a preset then tweak one half. */}
      <div className="border-t border-line bg-page/40 px-3 py-2.5 flex items-end gap-2 shrink-0">
        <label className="flex-1 min-w-0">
          <span className="block text-[10px] uppercase tracking-wider text-muted mb-1">
            Eigenes Emoji
          </span>
          <input
            type="text"
            value={emoji}
            maxLength={6}
            onChange={(e) => onChange({ emoji: e.target.value, color })}
            className="input w-full py-1.5 text-base text-center"
          />
        </label>
        <label className="shrink-0">
          <span className="block text-[10px] uppercase tracking-wider text-muted mb-1">
            Eigene Farbe
          </span>
          <input
            type="color"
            value={previewColor}
            onChange={(e) => onChange({ emoji, color: e.target.value })}
            className="h-[42px] w-14 rounded-ctl border border-line cursor-pointer p-0.5 bg-surface"
            aria-label="Eigene Farbe"
          />
        </label>
      </div>
    </div>
  );
}
