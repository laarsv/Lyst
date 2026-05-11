import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { RecipesApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode = 'url' | 'photo';

function fmtElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
}

export function ImportRecipeModal({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) {
      setUrl('');
      setFile(null);
      setError(null);
      setMode('url');
    }
  }, [open]);

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'url' && !url.trim()) return;
    if (mode === 'photo' && !file) return;
    setError(null);
    setLoading(true);
    try {
      const data =
        mode === 'url'
          ? await RecipesApi.importFromUrl(url.trim())
          : await RecipesApi.importFromPhoto(file!);
      onClose();
      nav('/recipes/new', { state: { prefill: data } });
    } catch (e) {
      setError(getApiError(e, 'Import fehlgeschlagen'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={loading ? () => {} : onClose} title="Rezept importieren">
      <div className="space-y-4">
        <div className="flex gap-1 bg-surface border border-line rounded-xl p-1">
          <button
            type="button"
            onClick={() => setMode('url')}
            disabled={loading}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
              mode === 'url' ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-page'
            }`}
          >
            Aus URL
          </button>
          <button
            type="button"
            onClick={() => setMode('photo')}
            disabled={loading}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
              mode === 'photo' ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-page'
            }`}
          >
            Foto importieren
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'url' ? (
            <>
              <p className="text-sm text-muted">
                Füge die URL einer Rezept-Webseite ein. Die KI extrahiert Titel, Zutaten und Schritte —
                du kannst danach alles anpassen, bevor du speicherst.
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
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Lade ein Foto eines Rezepts hoch (z.B. aus einem Kochbuch). Ein Vision-Modell
                erkennt das Rezept und extrahiert die Daten. Max. 10 MB, JPG/PNG/WebP.
              </p>
              <div>
                <label className="label">Bild</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="block w-full text-sm text-muted file:mr-3 file:py-2 file:px-4 file:rounded-ctl file:border file:border-line file:text-sm file:font-medium file:bg-surface file:text-ink hover:file:bg-page"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={loading}
                  required
                />
                {file && (
                  <div className="text-xs text-muted mt-1">
                    {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                )}
              </div>
            </>
          )}

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
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || (mode === 'url' ? !url.trim() : !file)}
            >
              {loading ? 'Importieren…' : 'Importieren'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
