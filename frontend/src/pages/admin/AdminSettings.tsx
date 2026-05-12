import { useEffect, useState } from 'react';
import { AdminApi } from '@/api/endpoints';
import type { LlmProvider, LlmSettings, OllamaStatus } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';

function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

export function AdminSettingsPage() {
  const [data, setData] = useState<LlmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await AdminApi.getLlmSettings());
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const switchProvider = async (provider: LlmProvider) => {
    if (!data || data.provider === provider) return;
    setBusy(true);
    try {
      await AdminApi.setLlmProvider(provider);
      toast.success(provider === 'ollama' ? 'Ollama (lokal) aktiv' : 'Claude (Cloud) aktiv');
      await load();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const setOllama = async (model: string | null) => {
    setBusy(true);
    try {
      await AdminApi.setOllamaModel(model);
      toast.success(model ? `Ollama-Modell: ${model}` : 'Ollama auf Standard zurückgesetzt');
      await load();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const setAnthropic = async (model: string | null) => {
    setBusy(true);
    try {
      await AdminApi.setAnthropicModel(model);
      toast.success(model ? `Claude-Modell: ${model}` : 'Claude auf Standard zurückgesetzt');
      await load();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <p className="text-sm text-muted">Globale System-Einstellungen für alle Nutzer.</p>
      </div>

      <section className="card p-6">
        <div className="mb-4">
          <h2 className="font-semibold">KI für Rezept-Import</h2>
          <p className="text-sm text-muted">
            Wähle den Anbieter und das Modell für den URL-Importer. Änderungen wirken sofort.
          </p>
        </div>

        {loading ? (
          <div className="text-muted/70 py-6 text-center">Lade…</div>
        ) : data ? (
          <>
            <div className="flex gap-1 bg-surface border border-line rounded-xl p-1 mb-5">
              <button
                onClick={() => switchProvider('ollama')}
                disabled={busy}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  data.provider === 'ollama' ? 'bg-surface shadow-sm' : 'text-muted hover:bg-surface/60'
                }`}
              >
                Ollama (lokal)
              </button>
              <button
                onClick={() => switchProvider('anthropic')}
                disabled={busy}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  data.provider === 'anthropic' ? 'bg-surface shadow-sm' : 'text-muted hover:bg-surface/60'
                }`}
              >
                Claude (Cloud)
              </button>
            </div>

            {data.provider === 'ollama' ? (
              <OllamaSection data={data.ollama} onSelect={setOllama} busy={busy} onReload={load} />
            ) : (
              <AnthropicSection data={data.anthropic} onSelect={setAnthropic} busy={busy} />
            )}
          </>
        ) : null}
      </section>

      <OllamaStatusSection />
      <TestEmailSection />
    </div>
  );
}

function OllamaStatusSection() {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setStatus(await AdminApi.getOllamaStatus());
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="card p-6 mt-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Ollama-Status</h2>
          <p className="text-sm text-muted">
            Welche Modelle hat Ollama gerade im Speicher? Dank{' '}
            <code className="bg-page px-1 py-0.5 rounded">keep_alive</code> sollte das Text-Modell
            permanent geladen sein — Antworten kommen dann sofort.
          </p>
        </div>
        <button className="text-brand text-sm hover:underline shrink-0" onClick={load} disabled={loading}>
          Aktualisieren
        </button>
      </div>

      {loading && !status ? (
        <div className="text-muted/70 py-4 text-center text-sm">Lade…</div>
      ) : status ? (
        <>
          <div className="grid sm:grid-cols-2 gap-3 mb-4 text-xs">
            <div className="rounded-lg border border-line p-3">
              <div className="text-muted">Text-Modell</div>
              <div className="font-medium font-mono mt-1">{status.configured.text_model}</div>
              <div className="text-muted mt-0.5">
                keep_alive:{' '}
                <code className="bg-page px-1 py-0.5 rounded">{status.configured.text_keep_alive}</code>
              </div>
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="text-muted">Vision-Modell</div>
              <div className="font-medium font-mono mt-1">{status.configured.vision_model || '—'}</div>
              <div className="text-muted mt-0.5">
                keep_alive:{' '}
                <code className="bg-page px-1 py-0.5 rounded">{status.configured.vision_keep_alive}</code>
              </div>
            </div>
          </div>

          {status.error ? (
            <div className="text-sm text-danger bg-danger-50 border border-danger/30 rounded-lg p-3">
              {status.error}
            </div>
          ) : status.loaded.length === 0 ? (
            <div className="text-sm text-muted bg-page border border-line rounded-lg p-3">
              Aktuell ist kein Modell geladen. Beim nächsten Aufruf zahlst du den Lade-Aufwand —
              prüfe die <code className="bg-surface px-1 py-0.5 rounded">keep_alive</code>-Werte.
            </div>
          ) : (
            <ul className="divide-y divide-line border border-line rounded-xl">
              {status.loaded.map((m, i) => {
                const name = m.name || m.model || 'unbekannt';
                const sizeGb = m.size_vram || m.size;
                return (
                  <li key={`${name}-${i}`} className="p-3 flex items-center gap-3">
                    <span className="size-2 rounded-full bg-brand shrink-0" title="Im Speicher" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium font-mono truncate">{name}</div>
                      <div className="text-xs text-muted flex flex-wrap gap-x-3">
                        {m.details?.parameter_size && <span>{m.details.parameter_size}</span>}
                        {m.details?.quantization_level && <span>{m.details.quantization_level}</span>}
                        {sizeGb && <span>{(sizeGb / 1024 ** 3).toFixed(1)} GB im RAM</span>}
                        {m.expires_at && <span>läuft ab: {new Date(m.expires_at).toLocaleTimeString('de-DE')}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}

function OllamaSection({
  data,
  onSelect,
  busy,
  onReload,
}: {
  data: LlmSettings['ollama'];
  onSelect: (model: string | null) => Promise<void>;
  busy: boolean;
  onReload: () => Promise<void>;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3 text-xs text-muted flex-wrap gap-2">
        <span>
          Server: <code className="bg-page px-1.5 py-0.5 rounded">{data.base_url}</code>
        </span>
        <button className="text-brand hover:underline" onClick={onReload} disabled={busy}>
          Liste neu laden
        </button>
      </div>
      {data.error ? (
        <div className="text-sm text-danger bg-danger-50 border border-danger/30 rounded-lg p-3">
          {data.error}
          <div className="text-xs mt-1 text-danger">
            Prüfe ob Ollama läuft und über die konfigurierte URL erreichbar ist.
          </div>
        </div>
      ) : data.models.length === 0 ? (
        <div className="text-muted/70 py-6 text-center">
          Keine Modelle installiert. Per <code className="bg-page px-1.5 py-0.5 rounded">ollama pull &lt;modell&gt;</code> auf dem Ollama-Host eines installieren.
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line border border-line rounded-xl">
            {data.models.map((m) => {
              const isSelected = data.selected === m.name;
              return (
                <li key={m.name} className={`p-3 flex items-center gap-3 ${isSelected ? 'bg-brand-50' : ''}`}>
                  <input
                    type="radio"
                    name="ollama-model"
                    checked={isSelected}
                    onChange={() => !isSelected && onSelect(m.name)}
                    disabled={busy}
                    className="size-4 accent-brand"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted flex flex-wrap gap-x-3">
                      {m.details?.parameter_size && <span>{m.details.parameter_size} Parameter</span>}
                      {m.details?.quantization_level && <span>{m.details.quantization_level}</span>}
                      {m.details?.family && <span>{m.details.family}</span>}
                      {m.size && <span>{fmtSize(m.size)}</span>}
                    </div>
                  </div>
                  {isSelected && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-brand text-white shrink-0">Aktiv</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <span>
              Standard aus <code className="bg-page px-1.5 py-0.5 rounded">.env</code>:{' '}
              <code className="bg-page px-1.5 py-0.5 rounded">{data.env_default}</code>
            </span>
            {data.is_override && (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => onSelect(null)}
                disabled={busy}
              >
                Auf Standard zurücksetzen
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AnthropicSection({
  data,
  onSelect,
  busy,
}: {
  data: LlmSettings['anthropic'];
  onSelect: (model: string | null) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div>
      {!data.has_api_key && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-3">
          <strong>ANTHROPIC_API_KEY ist nicht gesetzt.</strong> Du kannst hier ein Modell auswählen,
          aber der Importer wird einen Fehler zurückgeben bis der Key in <code className="bg-amber-100 px-1 py-0.5 rounded">.env</code> ergänzt
          und das Backend neu gestartet ist.
        </div>
      )}
      <ul className="divide-y divide-line border border-line rounded-xl">
        {data.models.map((m) => {
          const isSelected = data.selected === m.id;
          return (
            <li key={m.id} className={`p-3 flex items-center gap-3 ${isSelected ? 'bg-brand-50' : ''}`}>
              <input
                type="radio"
                name="anthropic-model"
                checked={isSelected}
                onChange={() => !isSelected && onSelect(m.id)}
                disabled={busy}
                className="size-4 accent-brand"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-muted">{m.description}</div>
                <code className="text-[10px] text-muted/70">{m.id}</code>
              </div>
              {isSelected && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-brand text-white shrink-0">Aktiv</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>
          Standard aus <code className="bg-page px-1.5 py-0.5 rounded">.env</code>:{' '}
          <code className="bg-page px-1.5 py-0.5 rounded">{data.env_default}</code>
        </span>
        {data.is_override && (
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={() => onSelect(null)}
            disabled={busy}
          >
            Auf Standard zurücksetzen
          </button>
        )}
      </div>
    </div>
  );
}

function TestEmailSection() {
  const myEmail = useAuthStore((s) => s.email);
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (myEmail) setTo(myEmail);
  }, [myEmail]);

  const send = async () => {
    if (!to.trim()) return;
    setSending(true);
    setLastResult(null);
    try {
      const r = await AdminApi.sendTestEmail(to.trim());
      setLastResult({ ok: true, message: `Test-E-Mail an ${r.to} versendet.` });
      toast.success('Test-E-Mail versendet');
    } catch (e) {
      const msg = getApiError(e);
      setLastResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card p-6 mt-6">
      <div className="mb-4">
        <h2 className="font-semibold">E-Mail-Versand testen</h2>
        <p className="text-sm text-muted">
          Sendet eine kurze Test-Mail über Resend. Prüft API-Key, Absender-Domain und DNS auf einen Schlag.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          className="input flex-1 min-w-[220px]"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="empfaenger@example.com"
          disabled={sending}
        />
        <button className="btn-primary" disabled={sending || !to.trim()} onClick={send}>
          {sending ? 'Sende…' : 'Test senden'}
        </button>
      </div>
      {lastResult && (
        <div
          className={`mt-3 text-sm rounded-lg border p-3 ${
            lastResult.ok
              ? 'text-brand-700 bg-brand-50 border-brand-100'
              : 'text-danger bg-danger-50 border-danger/30'
          }`}
        >
          {lastResult.message}
        </div>
      )}
    </section>
  );
}
