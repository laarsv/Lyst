import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SnapshotsApi } from '@/api/endpoints';
import type { ListSnapshot } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

export function HistoryPanel({ listId }: { listId: number }) {
  const [snaps, setSnaps] = useState<ListSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    void (async () => {
      try {
        setSnaps(await SnapshotsApi.list(listId));
      } catch (e) {
        toast.error(getApiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [listId]);

  const restore = async (s: ListSnapshot) => {
    setRestoring(s.id);
    try {
      const r = await SnapshotsApi.restore(listId, s.id);
      toast.success(`„${r.list_title}" angelegt`);
      nav(`/lists/${r.list_id}`);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="card p-5">
      <h3 className="font-semibold mb-1">Verlauf</h3>
      <p className="text-xs text-muted mb-3">
        Beim Zurücksetzen wird automatisch ein Snapshot gespeichert (max. 10). Du kannst eine
        frühere Sitzung als neue Liste wiederherstellen.
      </p>
      {loading ? (
        <div className="text-sm text-muted/70">Lade…</div>
      ) : snaps.length === 0 ? (
        <div className="text-sm text-muted">Noch keine Snapshots.</div>
      ) : (
        <ul className="divide-y divide-line">
          {snaps.map((s) => (
            <li key={s.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {new Date(s.created_at).toLocaleString('de-DE')}
                </div>
                <div className="text-xs text-muted">
                  {s.checked_count} / {s.item_count} erledigt
                </div>
              </div>
              <button
                className="btn-secondary text-xs"
                onClick={() => restore(s)}
                disabled={restoring !== null}
              >
                {restoring === s.id ? 'Stelle her…' : 'Wiederherstellen'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
