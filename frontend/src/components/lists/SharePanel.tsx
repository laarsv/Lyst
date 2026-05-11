import { useEffect, useState } from 'react';
import { ShareApi } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import type { ListSummary, ShareInfo } from '@/types';

export function SharePanel({ list, onUpdate }: { list: ListSummary; onUpdate: (l: Partial<ListSummary>) => void }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (list.share_enabled && list.share_token) {
      const url = `${window.location.origin}/s/${list.share_token}`;
      setInfo({ share_token: list.share_token, share_url: url, qr_code_png_base64: '' });
      // QR is only returned at enable time; refetch by toggling enable to get a fresh QR.
    } else {
      setInfo(null);
    }
  }, [list.share_enabled, list.share_token]);

  const enable = async () => {
    setLoading(true);
    try {
      const r = await ShareApi.enable(list.id);
      setInfo(r);
      onUpdate({ share_enabled: true, share_token: r.share_token });
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    try {
      await ShareApi.disable(list.id);
      setInfo(null);
      onUpdate({ share_enabled: false, share_token: null });
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!info) return;
    await navigator.clipboard.writeText(info.share_url);
    toast.success('Link kopiert');
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold">Öffentlicher Link</h3>
          <p className="text-xs text-zinc-500">Schreibgeschützt – jeder mit Link kann die Liste sehen.</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={list.share_enabled}
            onChange={() => (list.share_enabled ? disable() : enable())}
            disabled={loading}
          />
          <div className="w-11 h-6 bg-zinc-200 peer-checked:bg-brand rounded-full transition relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition peer-checked:after:translate-x-5" />
        </label>
      </div>
      {info && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input className="input flex-1 text-xs font-mono" readOnly value={info.share_url} />
            <button className="btn-secondary text-sm" onClick={copy}>Kopieren</button>
          </div>
          {info.qr_code_png_base64 ? (
            <div className="flex justify-center">
              <img
                src={`data:image/png;base64,${info.qr_code_png_base64}`}
                alt="QR-Code"
                className="w-40 h-40 rounded-lg border border-zinc-100"
              />
            </div>
          ) : (
            <div className="text-xs text-zinc-500 text-center">
              QR-Code wird beim erneuten Aktivieren angezeigt.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
