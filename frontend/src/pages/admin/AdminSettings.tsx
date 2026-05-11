import { useEffect, useState } from 'react';
import { AdminApi } from '@/api/endpoints';
import type { OllamaSettings } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

export function AdminSettingsPage() {
  const [data, setData] = useState<OllamaSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await AdminApi.getOllamaSettings());
    } catch (e) {
      setError(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const select = async (model: string | null) => {
    setSaving(model ?? '__reset__');
    try {
      const r = await AdminApi.setOllamaModel(model);
      toast.success(
        model ? `Modell auf „${r.selected}" gesetzt` : `Auf Standard zurückgesetzt: „${r.selected}"`,
      );
      await load();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <p className="text-sm text-zinc-500">Globale System-Einstellungen für alle Nutzer.</p>
      </div>

      <section className="card p-6">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">KI-Modell für Rezept-Import</h2>
            <p className="text-sm text-zinc-500">
              Bestimmt welches Ollama-Modell der Rezept-Importer nutzt.
              Wird automatisch von <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">{data?.ollama_base_url ?? '—'}</code> abgefragt.
            </p>
          </div>
          <button className="btn-secondary text-sm" onClick={load} disabled={loading}>
            Neu laden
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 mb-4">
            {error}
            <div className="text-xs mt-1 text-red-500">
              Prüfe ob Ollama erreichbar ist und mindestens ein Modell installiert ist.
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-zinc-400 py-6 text-center">Lade Modelle…</div>
        ) : data && data.models.length > 0 ? (
          <>
            <ul className="divide-y divide-zinc-100 border border-zinc-100 rounded-xl">
              {data.models.map((m) => {
                const isSelected = data.selected === m.name;
                return (
                  <li
                    key={m.name}
                    className={`p-3 flex items-center gap-3 ${isSelected ? 'bg-brand-50' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ollama-model"
                      checked={isSelected}
                      onChange={() => !isSelected && select(m.name)}
                      disabled={saving !== null}
                      className="size-4 accent-brand"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-zinc-500 flex flex-wrap gap-x-3">
                        {m.details?.parameter_size && <span>{m.details.parameter_size} Parameter</span>}
                        {m.details?.quantization_level && <span>{m.details.quantization_level}</span>}
                        {m.details?.family && <span>{m.details.family}</span>}
                        {m.size && <span>{fmtSize(m.size)}</span>}
                      </div>
                    </div>
                    {isSelected && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-brand text-white shrink-0">
                        Aktiv
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
              <span>
                Standard aus <code className="bg-zinc-100 px-1.5 py-0.5 rounded">.env</code>:{' '}
                <code className="bg-zinc-100 px-1.5 py-0.5 rounded">{data.env_default}</code>
              </span>
              {data.is_override && (
                <button
                  type="button"
                  className="text-brand hover:underline"
                  onClick={() => select(null)}
                  disabled={saving !== null}
                >
                  Auf Standard zurücksetzen
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="text-zinc-400 py-6 text-center">
            Keine Modelle installiert. Per <code className="bg-zinc-100 px-1.5 py-0.5 rounded">ollama pull &lt;modell&gt;</code> auf dem Ollama-Host eines installieren.
          </div>
        )}
      </section>
    </div>
  );
}
