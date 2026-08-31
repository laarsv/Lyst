import { useEffect, useState } from 'react';
import { RemindersApi } from '@/api/endpoints';
import type { Reminder } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RemindersPanel({ listId }: { listId: number }) {
  const [items, setItems] = useState<Reminder[]>([]);
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return toLocalInput(d);
  });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setItems(await RemindersApi.list(listId));
      } catch (e) {
        toast.error(getApiError(e));
      }
    })();
  }, [listId]);

  const add = async () => {
    if (!when) return;
    setLoading(true);
    try {
      const local = new Date(when);
      const r = await RemindersApi.create(listId, local.toISOString(), msg || undefined);
      setItems((cur) => [...cur, r].sort((a, b) => a.remind_at.localeCompare(b.remind_at)));
      setMsg('');
      toast.success('Erinnerung gesetzt');
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (r: Reminder) => {
    try {
      await RemindersApi.remove(listId, r.id);
      setItems((cur) => cur.filter((x) => x.id !== r.id));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <div className="card p-5">
      <h3 className="font-semibold mb-3">Erinnerungen</h3>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="datetime-local"
          className="input flex-1 min-w-[180px]"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <button className="btn-primary text-sm" disabled={loading} onClick={add}>
          Erinnern
        </button>
      </div>
      <input
        aria-label="Notiz zur Erinnerung"
        className="input mb-4"
        placeholder="Optionale Notiz"
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
      />
      {items.length === 0 ? (
        <div className="text-sm text-muted">Keine Erinnerungen.</div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {new Date(r.remind_at).toLocaleString('de-DE')}
                  {r.sent && <span className="ml-2 text-xs text-brand">gesendet</span>}
                </div>
                {r.message && <div className="text-xs text-muted truncate">{r.message}</div>}
              </div>
              <button className="text-xs text-danger hover:underline" onClick={() => remove(r)}>
                Löschen
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
