import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { RecipesApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
}

function fmtElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
}

export function ImportRecipeModal({ open, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const nav = useNavigate();

  // Live elapsed-time counter so the user sees the request is alive,
  // not stuck — Ollama on a CPU mini-PC can take 60+ seconds.
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const data = await RecipesApi.importFromUrl(url.trim());
      onClose();
      // Reset for next time
      setUrl('');
      // Navigate to the edit page with prefill in router state
      nav('/recipes/new', { state: { prefill: data } });
    } catch (e) {
      setError(getApiError(e, 'Import fehlgeschlagen'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title="Rezept aus URL importieren"
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-zinc-500">
          Füge die URL einer Rezept-Webseite ein. Die KI extrahiert Titel, Zutaten und Schritte —
          du kannst danach noch alles anpassen, bevor du speicherst.
        </p>
        <div>
          <label className="label">URL</label>
          <input
            type="url"
            className="input"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            autoFocus
            required
          />
        </div>
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
            {error}
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-3 bg-brand-50 text-brand-700 rounded-lg p-3 text-sm">
            <span
              className="size-4 rounded-full border-2 border-brand-700 border-t-transparent animate-spin shrink-0"
              aria-hidden
            />
            <span className="flex-1">
              KI analysiert Rezept… (je nach Hardware bis zu 1–2 Minuten)
            </span>
            <span className="tabular-nums font-mono text-brand-700/70 shrink-0">
              {fmtElapsed(elapsed)}
            </span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            Abbrechen
          </button>
          <button type="submit" className="btn-primary" disabled={loading || !url.trim()}>
            {loading ? 'Importieren…' : 'Importieren'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
