import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchApi, type SearchResults } from '@/api/endpoints';
import { Modal } from '@/components/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
}

const DEBOUNCE_MS = 300;

export function SearchModal({ open, onClose }: Props) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) {
      setQ('');
      setResults(null);
      setError(null);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const r = await SearchApi.global(trimmed);
        if (!cancelled) {
          setResults(r);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Suche fehlgeschlagen');
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const go = (path: string) => {
    onClose();
    nav(path);
  };

  const total =
    (results?.notes.length ?? 0) +
    (results?.lists.length ?? 0) +
    (results?.recipes.length ?? 0);

  return (
    <Modal open={open} onClose={onClose} className="max-w-xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-muted text-lg">⌕</span>
          <input
            ref={inputRef}
            type="text"
            className="input flex-1"
            placeholder="Suchen in Notizen, Listen und Rezepten…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <kbd className="hidden sm:inline text-[10px] text-muted bg-page border border-line rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>
        {q.trim().length > 0 && q.trim().length < 2 && (
          <div className="text-xs text-muted px-1">Mindestens 2 Zeichen.</div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted px-1">
            <span className="size-3 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            Suche…
          </div>
        )}
        {error && <div className="text-sm text-danger px-1">{error}</div>}

        {results && total === 0 && !loading && (
          <div className="text-sm text-muted text-center py-6">Keine Ergebnisse.</div>
        )}

        {results && total > 0 && (
          <div className="max-h-[60vh] overflow-auto -mx-1 px-1 space-y-4">
            {results.notes.length > 0 && (
              <ResultGroup label="Notizen" count={results.notes.length}>
                {results.notes.map((n) => (
                  <ResultRow
                    key={`n-${n.id}`}
                    icon="📝"
                    title={n.title || '(ohne Titel)'}
                    snippet={n.snippet}
                    tags={n.tags}
                    onClick={() => go(`/notes?focus=${n.id}`)}
                  />
                ))}
              </ResultGroup>
            )}
            {results.lists.length > 0 && (
              <ResultGroup label="Listen" count={results.lists.length}>
                {results.lists.map((l) => (
                  <ResultRow
                    key={`l-${l.id}`}
                    icon={l.icon || '📋'}
                    title={l.title}
                    snippet={l.matched_item ? `Eintrag: ${l.matched_item}` : ''}
                    accent={l.color}
                    onClick={() => go(`/lists/${l.id}`)}
                  />
                ))}
              </ResultGroup>
            )}
            {results.recipes.length > 0 && (
              <ResultGroup label="Rezepte" count={results.recipes.length}>
                {results.recipes.map((r) => (
                  <ResultRow
                    key={`r-${r.id}`}
                    icon="🍽️"
                    title={r.title}
                    snippet={
                      r.matched_ingredient
                        ? `Zutat: ${r.matched_ingredient}`
                        : r.snippet ?? ''
                    }
                    tags={r.tags}
                    onClick={() => go(`/recipes/${r.id}`)}
                  />
                ))}
              </ResultGroup>
            )}
          </div>
        )}

        {!results && !loading && q.trim().length < 2 && (
          <div className="text-xs text-muted px-1">
            Tipp: <kbd className="bg-page border border-line rounded px-1">⌘</kbd> +{' '}
            <kbd className="bg-page border border-line rounded px-1">K</kbd> öffnet die Suche
            jederzeit.
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted font-medium mb-1 px-1">
        {label} <span className="text-muted/60">({count})</span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ResultRow({
  icon,
  title,
  snippet,
  tags,
  accent,
  onClick,
}: {
  icon: string;
  title: string;
  snippet: string;
  tags?: string[];
  accent?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-2 py-2 rounded-ctl hover:bg-page flex items-start gap-2"
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
    >
      <span className="text-lg shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium truncate">{title}</span>
        {snippet && (
          <span className="block text-xs text-muted truncate">{snippet}</span>
        )}
        {tags && tags.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {tags.slice(0, 5).map((t) => (
              <span
                key={t}
                className="text-[10px] leading-4 px-1.5 py-0.5 rounded-full bg-page text-muted border border-line"
              >
                #{t}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
