import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { useSyncStatus } from '@/offline/status';
import { discard, discardAllFailed, listQueue, retry, flush } from '@/offline/syncQueue';
import type { QueuedOp } from '@/offline/db';

const KIND_LABEL: Record<QueuedOp['kind'], string> = {
  item_create: 'Item hinzufügen',
  item_update: 'Item ändern',
  item_delete: 'Item löschen',
  list_reset: 'Liste zurücksetzen',
};

/** Sits in the AppShell header. Three visual states:
 *
 *   - Online + queue empty           → nothing rendered
 *   - Offline                         → muted "Offline"
 *   - Online but failed items exist   → red "Sync-Probleme (N)" pill that
 *                                       opens a popover with retry / discard
 */
export function SyncStatusBadge() {
  const { online, pending, failed, syncing } = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QueuedOp[]>([]);

  useEffect(() => {
    if (!open) return;
    void listQueue().then(setItems);
  }, [open, pending, failed]);

  // Nothing to surface when everything is clean and online.
  if (online && pending === 0 && !syncing) return null;

  if (!online) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-chip bg-page text-muted border border-line"
        title="Du bist offline. Änderungen werden lokal gepuffert."
      >
        <CloudOff size={12} />
        <span className="hidden sm:inline">Offline</span>
      </span>
    );
  }

  if (failed > 0) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-chip bg-danger-50 text-danger border border-danger/30 hover:opacity-90"
          aria-label="Sync-Probleme öffnen"
        >
          <AlertTriangle size={12} />
          {failed} Problem{failed === 1 ? '' : 'e'}
        </button>
        {open && (
          <div
            className="absolute right-0 top-full mt-1 z-50 w-80 max-w-[90vw] card p-3 shadow-flat border border-line bg-surface"
            onMouseLeave={() => setOpen(false)}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Sync-Probleme</div>
              <button
                className="text-xs text-muted hover:text-ink"
                onClick={() => void discardAllFailed()}
              >
                Alle verwerfen
              </button>
            </div>
            <ul className="divide-y divide-line max-h-64 overflow-auto">
              {items
                .filter((o) => o.failed_reason)
                .map((o) => (
                  <li key={o.id} className="py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-ink truncate">{KIND_LABEL[o.kind]}</div>
                        <div className="text-danger/80 truncate">{o.failed_reason}</div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          className="text-brand-700 hover:underline"
                          onClick={() => o.id && void retry(o.id)}
                        >
                          Erneut
                        </button>
                        <button
                          className="text-muted hover:text-danger"
                          onClick={() => o.id && void discard(o.id)}
                        >
                          Verwerfen
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // Online and queue still draining (e.g. just reconnected).
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-chip bg-brand-50 text-brand-700 cursor-pointer"
      title={`${pending} Änderung${pending === 1 ? '' : 'en'} in Synchronisation`}
      onClick={() => void flush()}
    >
      <RefreshCw size={12} className="animate-spin" />
      Sync ({pending})
    </span>
  );
}
