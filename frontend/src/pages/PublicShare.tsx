import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShareApi } from '@/api/endpoints';
import type { PublicListData } from '@/types';

export function PublicSharePage() {
  const { token } = useParams();
  const [data, setData] = useState<PublicListData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        setData(await ShareApi.getPublic(token));
      } catch {
        setError('Diese Liste ist nicht (mehr) öffentlich.');
      }
    })();
  }, [token]);

  if (error) {
    return (
      <div className="min-h-full flex items-center justify-center p-6 text-center">
        <div className="card p-8 max-w-sm">
          <div className="text-2xl font-semibold text-brand mb-2">Lyst</div>
          <p className="text-zinc-600">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-center text-zinc-400">Lade…</div>;

  const checked = data.items.filter((i) => i.is_checked).length;

  return (
    <div className="max-w-xl mx-auto p-4 sm:p-6">
      <div className="text-center mb-4">
        <a href="/" className="text-brand font-semibold">Lyst</a>
      </div>
      <div
        className="card p-6 mb-4"
        style={{ borderTopColor: data.color || '#0a84ff', borderTopWidth: 4 }}
      >
        <div className="flex items-center gap-3">
          {data.icon && <span className="text-3xl">{data.icon}</span>}
          <div>
            <h1 className="text-2xl font-semibold">{data.title}</h1>
            <div className="text-sm text-zinc-500">
              {checked} / {data.items.length} erledigt · zuletzt geändert{' '}
              {new Date(data.updated_at).toLocaleString('de-DE')}
            </div>
          </div>
        </div>
        {data.description && <p className="text-sm text-zinc-600 mt-3">{data.description}</p>}
      </div>
      <div className="card p-3">
        <ul className="divide-y divide-zinc-100">
          {data.items.map((it) => (
            <li key={it.id} className="py-2.5 px-2 flex items-center gap-2">
              <input type="checkbox" checked={it.is_checked} disabled className="size-5 accent-brand" />
              <div className="flex-1 min-w-0">
                <div className={it.is_checked ? 'line-through text-zinc-400' : ''}>{it.text}</div>
                {(it.quantity !== null || it.unit) && (
                  <div className="text-xs text-zinc-500">
                    {it.quantity !== null && it.quantity}{it.unit && ` ${it.unit}`}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-center text-xs text-zinc-400 mt-6">Schreibgeschützte Ansicht</p>
    </div>
  );
}
