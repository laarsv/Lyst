/** Settings section: the remembered "list term -> Picnic product" choices.
 *
 *  They're household-wide (one shared Picnic account), created by ticking "Merken" in the
 *  "Zu Picnic" dialog. Here you can review them and delete a wrong one — the term then falls
 *  back to the automatic ranking. Renders nothing at all unless Picnic is configured, so the
 *  Settings page is unchanged for everyone without the integration. */
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from '@/components/Toast';
import { useConfirm } from '@/components/Dialogs';
import { getApiError } from '@/api/client';
import { PicnicApi } from '@/api/endpoints';
import type { PicnicMapping } from '@/types';

// Only offer a filter box once the list is long enough to need one.
const FILTER_THRESHOLD = 8;

export function PicnicMappingsSection() {
  const confirmDialog = useConfirm();
  const [configured, setConfigured] = useState(false);
  const [mappings, setMappings] = useState<PicnicMapping[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await PicnicApi.status();
        if (cancelled || !status.configured) return;
        setConfigured(true);
        const rows = await PicnicApi.mappings();
        if (!cancelled) setMappings(rows);
      } catch {
        // Not configured / backend hiccup: a missing section beats a broken Settings page.
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!mappings || !q) return mappings ?? [];
    return mappings.filter(
      (m) => m.term.includes(q) || m.product_name.toLowerCase().includes(q),
    );
  }, [mappings, filter]);

  if (!configured) return null;

  const remove = async (m: PicnicMapping) => {
    const ok = await confirmDialog({
      title: 'Zuordnung löschen?',
      message: `„${m.term}“ wird beim nächsten Mal wieder nach Name und Kaufhäufigkeit vorgeschlagen.`,
      confirmLabel: 'Löschen',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(m.id);
    try {
      await PicnicApi.deleteMapping(m.id);
      setMappings((cur) => (cur ?? []).filter((x) => x.id !== m.id));
      toast.success('Zuordnung gelöscht');
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="card p-6 space-y-3">
      <div>
        <h2 className="font-semibold">Picnic-Zuordnungen</h2>
        <p className="text-sm text-muted">
          Gemerkte Produkte für Begriffe auf deinen Listen. Sie gelten für den ganzen Haushalt und
          entstehen, wenn du im Dialog „Zu Picnic“ ein Produkt bestätigst und „Merken“ angehakt lässt.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-danger" role="alert">
          Die Zuordnungen konnten nicht geladen werden.
        </p>
      ) : mappings === null ? (
        <p className="text-sm text-muted">Lade…</p>
      ) : mappings.length === 0 ? (
        <p className="text-sm text-muted">Noch keine Zuordnungen gemerkt.</p>
      ) : (
        <>
          {mappings.length > FILTER_THRESHOLD && (
            <input
              type="search"
              className="input"
              placeholder="Filtern…"
              aria-label="Zuordnungen filtern"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          {visible.length === 0 ? (
            <p className="text-sm text-muted">Keine Treffer.</p>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{m.term}</div>
                    <div className="truncate text-sm text-muted">{m.product_name}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost p-2 text-danger"
                    aria-label={`Zuordnung „${m.term}“ löschen`}
                    disabled={busyId === m.id}
                    onClick={() => void remove(m)}
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="text-xs text-muted">
            {mappings.length} {mappings.length === 1 ? 'Zuordnung' : 'Zuordnungen'}
          </div>
        </>
      )}
    </section>
  );
}
