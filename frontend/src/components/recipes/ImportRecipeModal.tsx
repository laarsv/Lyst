import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { RecipesApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportRecipeModal({ open, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

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
              className="size-4 rounded-full border-2 border-brand-700 border-t-transparent animate-spin"
              aria-hidden
            />
            <span>KI analysiert Rezept… (kann 10–20 Sekunden dauern)</span>
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
