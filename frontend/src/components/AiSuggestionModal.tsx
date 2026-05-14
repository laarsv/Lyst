/** Generic "AI brainstorms a list of suggestions, user picks which to apply"
 *  modal. Powers Feature 1 (recipe ingredient/step suggestions), Feature 2
 *  ("fehlt was?"), and Feature 4 (generate list from goal).
 *
 *  Two-phase UX:
 *    1. Prompt phase: user types a free-form request (or skips it for
 *       prompt-less features), submits, sees a spinner.
 *    2. Review phase: the suggestions arrive as checklist items the user
 *       toggles; "Übernehmen" applies the selection. The selection callback
 *       receives only the checked items.
 *
 *  Suggestions are typed `T` so the parent can render whatever the backend
 *  returns (ingredient objects, step objects, plain strings) via the
 *  `renderItem` prop. The modal is otherwise fully reusable. */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RotateCw, Sparkles } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { getApiError } from '@/api/client';

interface Props<T> {
  open: boolean;
  onClose: () => void;
  /** Modal title (e.g. "Zutaten ergänzen"). */
  title: string;
  /** Sublabel under the title — explains what the AI will do. */
  description?: string;
  /** Show the free-text request input. Disable for prompt-less features
   *  (e.g. "fehlt was?" which always asks the same thing). */
  showPromptInput?: boolean;
  /** Placeholder for the request input. */
  promptPlaceholder?: string;
  /** Initial value for the request input — useful when the parent wants to
   *  pre-fill (e.g. "Vegetarisch machen" preset variations). */
  initialPrompt?: string;
  /** Action label on the apply button. */
  confirmLabel?: string;
  /** Stable identifier per item so the checklist tracks selection. */
  getKey: (item: T, index: number) => string | number;
  /** Per-suggestion render function. */
  renderItem: (item: T, isSelected: boolean) => React.ReactNode;
  /** Called when the user clicks "Vorschlagen" — must return the list. */
  fetchSuggestions: (prompt: string) => Promise<T[]>;
  /** Called with the list of checked items when the user confirms. */
  onApply: (selected: T[]) => void;
}

export function AiSuggestionModal<T>({
  open,
  onClose,
  title,
  description,
  showPromptInput = true,
  promptPlaceholder = 'Was möchtest du ergänzen?',
  initialPrompt = '',
  confirmLabel = 'Übernehmen',
  getKey,
  renderItem,
  fetchSuggestions,
  onApply,
}: Props<T>) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<T[] | null>(null);
  const [picked, setPicked] = useState<Set<string | number>>(new Set());

  // Stash the last submitted prompt so the inline "Erneut versuchen" button
  // re-runs with the same input. AI parse failures are usually transient
  // (model repeated itself, outputted a fence) — one extra try almost
  // always works.
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Reset when the modal opens or the seed prompt changes.
  useEffect(() => {
    if (!open) return;
    setPrompt(initialPrompt);
    setSuggestions(null);
    setPicked(new Set());
    setError(null);
    setLastPrompt('');
  }, [open, initialPrompt]);

  // Auto-fetch when there's no prompt input (Feature 2 case) so the user
  // doesn't see an empty modal that needs an extra click.
  useEffect(() => {
    if (!open || showPromptInput || suggestions !== null || loading || error) return;
    void run('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showPromptInput]);

  const run = async (q: string) => {
    setLoading(true);
    setError(null);
    setLastPrompt(q);
    try {
      const list = await fetchSuggestions(q);
      setSuggestions(list);
      // Pre-check everything — easier to deselect a couple than to pick all.
      setPicked(new Set(list.map((it, i) => getKey(it, i))));
    } catch (e) {
      // Render the error inline with a retry button instead of a fly-by
      // toast — gives the user the actionable next step right where they
      // were looking. Backend already sends a user-friendly German message
      // for the JSON-parse-failed case ("Die KI-Antwort konnte nicht
      // verarbeitet werden. Bitte erneut versuchen.").
      setError(getApiError(e));
      setSuggestions(null);
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    void run(lastPrompt);
  };

  const toggle = (key: string | number) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const apply = () => {
    if (!suggestions) return;
    const out = suggestions.filter((it, i) => picked.has(getKey(it, i)));
    onApply(out);
  };

  const pickedCount = useMemo(() => picked.size, [picked]);

  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-lg">
      <div className="space-y-3">
        {description && (
          <p className="text-sm text-muted">{description}</p>
        )}

        {showPromptInput && suggestions === null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim()) void run(prompt.trim());
            }}
            className="space-y-2"
          >
            <textarea
              className="input min-h-[64px] text-sm"
              placeholder={promptPlaceholder}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              autoFocus
              disabled={loading}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Abbrechen
              </button>
              <button
                type="submit"
                className="btn-primary inline-flex items-center gap-2"
                disabled={!prompt.trim() || loading}
              >
                <Sparkles size={14} /> Vorschlagen
              </button>
            </div>
          </form>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted py-3">
            <Loader2 size={16} className="animate-spin" />
            <span>KI denkt nach…</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-ctl border border-danger/30 bg-danger-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-danger">{error}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={retry}
                    className="btn-primary text-xs inline-flex items-center gap-1.5"
                  >
                    <RotateCw size={12} />
                    Erneut versuchen
                  </button>
                  {showPromptInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                      }}
                      className="btn-secondary text-xs"
                    >
                      Anderen Wunsch
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && suggestions !== null && (
          <>
            {suggestions.length === 0 ? (
              <div className="text-sm text-muted text-center py-4">
                Keine passenden Vorschläge.
              </div>
            ) : (
              <ul className="border border-line rounded-xl divide-y divide-line max-h-64 overflow-auto">
                {suggestions.map((it, i) => {
                  const k = getKey(it, i);
                  const sel = picked.has(k);
                  return (
                    <li key={k}>
                      <label className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-page">
                        <input
                          type="checkbox"
                          checked={sel}
                          onChange={() => toggle(k)}
                          className="mt-0.5 size-4 accent-brand"
                        />
                        <span className="flex-1 text-sm">{renderItem(it, sel)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-between items-center gap-2">
              {showPromptInput && suggestions.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted hover:text-ink"
                  onClick={() => {
                    setSuggestions(null);
                    setPicked(new Set());
                  }}
                >
                  ← Anderen Wunsch
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={pickedCount === 0}
                  onClick={apply}
                >
                  {confirmLabel} ({pickedCount})
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
