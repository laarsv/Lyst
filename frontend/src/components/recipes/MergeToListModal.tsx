import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListsApi, RecipesApi } from '@/api/endpoints';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { useConfirm } from '@/components/Dialogs';
import { getApiError } from '@/api/client';
import { fmtQty } from '@/lib/format';
import { iconForCategory } from '@/data/listCategories';
import type { ListSummary, MergePreviewResponse, RecipeSummary } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode = 'existing' | 'new';
type Step = 'pick' | 'preview';

/** Merge several recipes into one aisle-sorted shopping list. Step 1 picks
 *  recipes (each with its own servings) + a target list; step 2 shows the
 *  consolidated, deduped, aisle-grouped preview with provenance before saving. */
export function MergeToListModal({ open, onClose }: Props) {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [shoppingLists, setShoppingLists] = useState<ListSummary[]>([]);
  const [sel, setSel] = useState<Map<number, number>>(new Map()); // recipeId → servings
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>('new');
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [step, setStep] = useState<Step>('pick');
  const [preview, setPreview] = useState<MergePreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const nav = useNavigate();
  const confirmDialog = useConfirm();

  useEffect(() => {
    if (!open) return;
    setStep('pick');
    setSel(new Map());
    setPreview(null);
    setQ('');
    setNewTitle('Wocheneinkauf');
    void (async () => {
      try {
        const [recs, lists] = await Promise.all([RecipesApi.list(), ListsApi.list()]);
        setRecipes(recs);
        const shopping = lists.filter((l) => l.type === 'SHOPPING' && l.is_owner);
        setShoppingLists(shopping);
        if (shopping.length > 0) {
          setMode('existing');
          setSelectedListId(shopping[0].id);
        } else {
          setMode('new');
        }
      } catch (e) {
        toast.error(getApiError(e));
      }
    })();
  }, [open]);

  const toggle = (r: RecipeSummary) =>
    setSel((cur) => {
      const next = new Map(cur);
      if (next.has(r.id)) next.delete(r.id);
      else next.set(r.id, r.servings && r.servings > 0 ? r.servings : 2);
      return next;
    });

  const setServings = (id: number, v: number) =>
    setSel((cur) => {
      if (!cur.has(id)) return cur;
      const next = new Map(cur);
      next.set(id, Math.min(999, Math.max(1, v || 1)));
      return next;
    });

  const payload = () =>
    Array.from(sel.entries()).map(([recipe_id, servings]) => ({ recipe_id, servings }));

  const goPreview = async () => {
    if (sel.size === 0) return toast.error('Mindestens ein Rezept wählen');
    setLoadingPreview(true);
    try {
      const p = await RecipesApi.mergePreview(payload());
      setPreview(p);
      setStep('preview');
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoadingPreview(false);
    }
  };

  const submit = async () => {
    if (mode === 'existing' && !selectedListId) return toast.error('Liste wählen');
    if (mode === 'new' && !newTitle.trim()) return toast.error('Titel für neue Liste eingeben');
    setSubmitting(true);
    try {
      const r = await RecipesApi.mergeToList({
        recipes: payload(),
        list_id: mode === 'existing' ? selectedListId : null,
        new_list_title: mode === 'new' ? newTitle.trim() : undefined,
      });
      onClose();
      toast.success(`${r.items_added} Einträge zu „${r.list_title}" hinzugefügt`);
      setTimeout(async () => {
        if (
          await confirmDialog({
            title: `Zur Liste „${r.list_title}" wechseln?`,
            message: `${r.items_added} Einträge wurden hinzugefügt.`,
            confirmLabel: 'Öffnen',
          })
        )
          nav(`/lists/${r.list_id}`);
      }, 100);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? recipes.filter((r) => r.title.toLowerCase().includes(n)) : recipes;
  }, [recipes, q]);

  return (
    <Modal open={open} onClose={onClose} title="Einkaufsliste aus Rezepten" className="max-w-lg">
      {step === 'pick' ? (
        <div className="space-y-4">
          <input
            className="input"
            placeholder="Rezept suchen…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="border border-line rounded-xl divide-y divide-line max-h-72 overflow-auto">
            {filtered.map((r) => {
              const picked = sel.has(r.id);
              return (
                <div key={r.id} className="px-3 py-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() => toggle(r)}
                      className="size-4 accent-brand"
                    />
                    <span className="flex-1 text-sm">{r.title}</span>
                  </label>
                  {picked && (
                    <div className="flex items-center gap-2 mt-2 ml-6">
                      <span className="text-xs text-muted">Portionen</span>
                      <button
                        type="button"
                        onClick={() => setServings(r.id, (sel.get(r.id) ?? 2) - 1)}
                        className="size-7 rounded-lg border border-line hover:bg-page"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={sel.get(r.id) ?? 2}
                        onChange={(e) => setServings(r.id, Number(e.target.value))}
                        className="input w-16 text-center py-1"
                      />
                      <button
                        type="button"
                        onClick={() => setServings(r.id, (sel.get(r.id) ?? 2) + 1)}
                        className="size-7 rounded-lg border border-line hover:bg-page"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-sm text-muted/70 text-center">Keine Rezepte</div>
            )}
          </div>

          <div>
            <label className="label">Ziel</label>
            <div className="flex gap-1 bg-surface border border-line rounded-xl p-1 mb-2">
              <button
                type="button"
                onClick={() => setMode('existing')}
                disabled={shoppingLists.length === 0}
                className={`flex-1 px-3 py-1.5 rounded-lg text-sm transition disabled:opacity-50 ${
                  mode === 'existing' ? 'bg-surface shadow-sm font-medium' : 'text-muted'
                }`}
              >
                Bestehende Liste
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`flex-1 px-3 py-1.5 rounded-lg text-sm transition ${
                  mode === 'new' ? 'bg-surface shadow-sm font-medium' : 'text-muted'
                }`}
              >
                Neue Liste
              </button>
            </div>
            {mode === 'existing' ? (
              <select
                className="input"
                value={selectedListId ?? ''}
                onChange={(e) => setSelectedListId(Number(e.target.value))}
              >
                {shoppingLists.length === 0 && <option value="">Keine Einkaufsliste vorhanden</option>}
                {shoppingLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.icon ? `${l.icon} ` : ''}
                    {l.title}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                placeholder="Titel der neuen Liste"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
            <button
              className="btn-primary"
              disabled={sel.size === 0 || loadingPreview}
              onClick={goPreview}
            >
              {loadingPreview ? 'Lade…' : `Vorschau (${sel.size})`}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {preview?.item_count ?? 0} Einträge aus {sel.size}{' '}
            {sel.size === 1 ? 'Rezept' : 'Rezepten'} — zusammengefasst, nach Bereichen sortiert.
          </p>
          <div className="border border-line rounded-xl divide-y divide-line max-h-80 overflow-auto">
            {preview?.sections.map((sec) => {
              const Icon = iconForCategory('SHOPPING', sec.aisle);
              return (
                <div key={sec.aisle} className="py-2">
                  <div className="flex items-center gap-2 px-3 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">
                    <Icon size={14} /> {sec.aisle}
                    <span className="text-muted/60 normal-case">({sec.items.length})</span>
                  </div>
                  <ul>
                    {sec.items.map((it, i) => {
                      const lineStr =
                        it.lines
                          .map((l) =>
                            `${l.quantity != null ? fmtQty(l.quantity) : ''} ${l.unit ?? ''}`.trim(),
                          )
                          .filter(Boolean)
                          .join(' · ') || '—';
                      return (
                        <li key={i} className="px-3 py-1.5">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm flex-1">{it.name}</span>
                            <span className="text-xs text-muted tabular-nums">{lineStr}</span>
                          </div>
                          {it.recipes.length > 1 && (
                            <div className="text-[10px] text-muted/70 mt-0.5">
                              aus {it.recipes.join(' + ')}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {(preview?.sections.length ?? 0) === 0 && (
              <div className="px-3 py-4 text-sm text-muted/70 text-center">Keine Zutaten</div>
            )}
          </div>
          <div className="flex justify-between gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setStep('pick')}>← Zurück</button>
            <button
              className="btn-primary"
              disabled={submitting || !preview?.item_count}
              onClick={submit}
            >
              {submitting ? 'Erstelle…' : 'Liste erstellen'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
