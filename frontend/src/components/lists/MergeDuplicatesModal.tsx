/** Feature 5: review and merge likely-duplicate items in a list.
 *
 *  Two-pass detection: client-side fuzzy bucketing first (free, instant),
 *  optional "AI prüfen" button for semantic matches the fuzzy pass missed
 *  ("Tomatenmark" / "Tomatenpaste"). Per group the user sees:
 *    - what would be kept (primary item with merged quantity)
 *    - which items would be deleted
 *    - "Zusammenfassen" / "Behalten" buttons
 *
 *  Merging is implemented via the existing PATCH/DELETE endpoints — no new
 *  backend route needed for the apply step. */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { fmtQty } from '@/lib/format';
import { AiListsApi, ItemsApi } from '@/api/endpoints';
import { findDuplicateGroups, type DuplicateGroup } from '@/utils/duplicates';
import type { ListItem } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  listId: number;
  items: ListItem[];
  /** Refresh the local item state after a merge — typically the same
   *  refetcher the parent uses for WebSocket gaps. */
  onMerged: () => Promise<void> | void;
}

export function MergeDuplicatesModal({ open, onClose, listId, items, onMerged }: Props) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null); // primary id being merged

  // Detect on open and whenever the items prop changes (a successful merge
  // shrinks the list, so a re-detection is cheap insurance).
  useEffect(() => {
    if (!open) return;
    setGroups(findDuplicateGroups(items));
  }, [open, items]);

  const remaining = useMemo(() => groups ?? [], [groups]);

  const runAi = async () => {
    setAiLoading(true);
    try {
      const aiGroups = await AiListsApi.findDuplicates(listId);
      // Translate id-only groups back into full DuplicateGroup objects so
      // the UI is uniform with the fuzzy pass.
      const byId = new Map(items.map((i) => [i.id, i] as const));
      const enriched: DuplicateGroup[] = [];
      for (const g of aiGroups) {
        const its = g.item_ids.map((id) => byId.get(id)).filter(Boolean) as ListItem[];
        if (its.length < 2) continue;
        const primary = its[0];
        // Use the same merge-fields logic as the fuzzy pass — keep merge
        // semantics consistent.
        const grp = findDuplicateGroups(its)[0];
        if (grp) enriched.push(grp);
      }
      // Merge with existing fuzzy groups, deduping by primary id.
      const seen = new Set((groups ?? []).map((g) => g.primary.id));
      const combined = [...(groups ?? [])];
      for (const g of enriched) {
        if (!seen.has(g.primary.id)) combined.push(g);
      }
      setGroups(combined);
      if (enriched.length === 0) {
        toast.info('KI hat keine zusätzlichen Doppelungen gefunden');
      }
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setAiLoading(false);
    }
  };

  const merge = async (g: DuplicateGroup) => {
    setBusy(g.primary.id);
    try {
      await ItemsApi.update(listId, g.primary.id, {
        text: g.merged.text,
        quantity: g.merged.quantity,
        unit: g.merged.unit,
      });
      // Delete duplicates in parallel — the UI reflects the change once
      // the parent refetches.
      await Promise.all(g.duplicates.map((d) => ItemsApi.remove(listId, d.id)));
      // Drop the merged group from local state so the UI updates instantly.
      setGroups((cur) => (cur ?? []).filter((x) => x.primary.id !== g.primary.id));
      toast.success(`${g.duplicates.length + 1} Einträge zusammengefasst`);
      await onMerged();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(null);
    }
  };

  const skip = (g: DuplicateGroup) => {
    setGroups((cur) => (cur ?? []).filter((x) => x.primary.id !== g.primary.id));
  };

  return (
    <Modal open={open} onClose={onClose} title="Doppelte Einträge prüfen" className="max-w-lg">
      <div className="space-y-3">
        {!groups ? (
          <div className="text-sm text-muted py-4">Suche…</div>
        ) : remaining.length === 0 ? (
          <div className="text-sm text-muted text-center py-6">
            Keine Doppelungen gefunden.
            <div className="mt-3">
              <button
                type="button"
                onClick={runAi}
                disabled={aiLoading}
                className="btn-secondary text-sm inline-flex items-center gap-2"
              >
                {aiLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> KI prüft…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} /> KI semantisch prüfen
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">
              Wähle pro Gruppe, ob die Einträge zusammengefasst werden sollen.
              Mengen werden addiert, wenn die Einheit gleich ist.
            </p>
            <ul className="space-y-2 max-h-72 overflow-auto">
              {remaining.map((g) => (
                <li
                  key={g.primary.id}
                  className="border border-line rounded-ctl p-3 bg-page/40"
                >
                  <div className="text-xs text-muted mb-1">Wird zusammengefasst zu:</div>
                  <div className="font-medium">
                    {g.merged.text}
                    {g.merged.quantity !== null && (
                      <span className="text-muted ml-2 text-sm">
                        {fmtQty(g.merged.quantity)} {g.merged.unit ?? ''}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-2 mb-1">Einträge:</div>
                  <ul className="text-sm text-muted space-y-0.5">
                    <li>
                      • {g.primary.text}
                      {g.primary.quantity !== null && (
                        <span className="ml-1">
                          ({fmtQty(g.primary.quantity)} {g.primary.unit ?? ''})
                        </span>
                      )}
                    </li>
                    {g.duplicates.map((d) => (
                      <li key={d.id}>
                        • {d.text}
                        {d.quantity !== null && (
                          <span className="ml-1">
                            ({fmtQty(d.quantity)} {d.unit ?? ''})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => skip(g)}
                      disabled={busy === g.primary.id}
                    >
                      Behalten
                    </button>
                    <button
                      type="button"
                      className="btn-primary text-xs"
                      onClick={() => merge(g)}
                      disabled={busy === g.primary.id}
                    >
                      {busy === g.primary.id ? 'Fasse zusammen…' : 'Zusammenfassen'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex justify-between items-center pt-1">
              <button
                type="button"
                onClick={runAi}
                disabled={aiLoading}
                className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"
              >
                {aiLoading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> KI prüft…
                  </>
                ) : (
                  <>
                    <Sparkles size={12} /> Auch KI semantisch prüfen
                  </>
                )}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={onClose}>
                Fertig
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
