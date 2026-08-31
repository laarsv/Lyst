import { useEffect, useState, useId} from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { RecipesApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Suggestion {
  recipe_id: number;
  title: string;
  reason: string;
}

export function SuggestRecipesModal({ open, onClose }: Props) {
  const fid = useId();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setText('');
      setSuggestions(null);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    const items = text
      .split(/[,\n;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return;
    setLoading(true);
    setError(null);
    setSuggestions(null);
    try {
      const r = await RecipesApi.suggest(items);
      setSuggestions(r.suggestions);
    } catch (e) {
      setError(getApiError(e, 'Vorschläge konnten nicht generiert werden'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={loading ? () => {} : onClose} title="Was kann ich kochen?">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Liste auf, was du zuhause hast (komma-separiert). Die KI sucht aus deinen Rezepten
          die 3 passendsten heraus.
        </p>
        <div>
          <label className="label" htmlFor={`${fid}-vorhandene-zutaten`}>Vorhandene Zutaten</label>
          <textarea
            id={`${fid}-vorhandene-zutaten`}
            className="input min-h-[80px]"
            placeholder="z.B. Eier, Speck, Parmesan, Spaghetti"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
          />
        </div>

        {error && (
          <div className="text-sm text-danger bg-danger-50 border border-danger/30 rounded-lg p-3">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-3 bg-brand-50 text-brand-700 rounded-lg p-3 text-sm">
            <span
              className="size-4 rounded-full border-2 border-brand-700 border-t-transparent animate-spin shrink-0"
              aria-hidden
            />
            <span>KI sucht Rezepte heraus…</span>
          </div>
        )}

        {suggestions && suggestions.length === 0 && !loading && (
          <div className="text-sm text-muted bg-page rounded-lg p-3 border border-line">
            Keine passenden Rezepte gefunden. Vielleicht andere Zutaten probieren oder mehr
            Rezepte anlegen.
          </div>
        )}

        {suggestions && suggestions.length > 0 && (
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.recipe_id} className="border border-line rounded-card p-3">
                <Link
                  to={`/recipes/${s.recipe_id}`}
                  className="font-medium text-ink hover:text-brand-700"
                  onClick={onClose}
                >
                  {s.title}
                </Link>
                <div className="text-sm text-muted mt-1">{s.reason}</div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            Schließen
          </button>
          <button
            className="btn-primary"
            disabled={loading || !text.trim()}
            onClick={submit}
          >
            {loading ? 'Frage KI…' : 'Vorschläge holen'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
