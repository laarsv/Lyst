import { useEffect, useMemo, useState, useId} from 'react';
import { useNavigate } from 'react-router-dom';
import { ListsApi, RecipesApi } from '@/api/endpoints';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { useConfirm } from '@/components/Dialogs';
import { getApiError } from '@/api/client';
import { fmtQty, scaleQty } from '@/lib/format';
import type { ListSummary, Recipe } from '@/types';

interface Props {
  open: boolean;
  recipe: Recipe;
  onClose: () => void;
}

type Mode = 'existing' | 'new';

// When the recipe doesn't define servings (e.g. an AI-imported recipe with
// a missing field), the stepper defaults to 2 and we cap the picker at 20
// — backend's copy_to_list already keeps the scaling factor at 1.0 in that
// case, so ingredients are added as-is regardless of the chosen number.
const FALLBACK_SERVINGS = 2;
const FALLBACK_MAX = 20;
const NORMAL_MAX = 999;

export function CopyToListModal({ open, recipe, onClose }: Props) {
  const fid = useId();
  const [shoppingLists, setShoppingLists] = useState<ListSummary[]>([]);
  const [mode, setMode] = useState<Mode>('new');
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const sourceUnknown = !recipe.servings || recipe.servings <= 0;
  const sourceServings = sourceUnknown ? FALLBACK_SERVINGS : recipe.servings;
  const maxServings = sourceUnknown ? FALLBACK_MAX : NORMAL_MAX;
  const [servings, setServings] = useState(sourceServings);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const nav = useNavigate();
  const confirmDialog = useConfirm();

  useEffect(() => {
    if (!open) return;
    setServings(sourceServings);
    setNewTitle(`Einkauf: ${recipe.title}`);
    setSelected(new Set(recipe.ingredients.map((i) => i.id)));
    void (async () => {
      try {
        const all = await ListsApi.list();
        const shopping = all.filter((l) => l.type === 'SHOPPING' && l.is_owner);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recipe]);

  // Mirror the backend's behaviour: factor is 1.0 (no scaling) whenever
  // the source servings is missing — so the preview reflects what actually
  // gets added.
  const factor = useMemo(
    () => (sourceUnknown ? 1 : servings / recipe.servings),
    [sourceUnknown, servings, recipe.servings],
  );

  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (selected.size === 0) return toast.error('Mindestens eine Zutat auswählen');
    if (mode === 'existing' && !selectedListId) return toast.error('Liste wählen');
    if (mode === 'new' && !newTitle.trim()) return toast.error('Titel für neue Liste eingeben');

    setSubmitting(true);
    try {
      const r = await RecipesApi.copyToList(recipe.id, {
        list_id: mode === 'existing' ? selectedListId : null,
        new_list_title: mode === 'new' ? newTitle.trim() : undefined,
        servings,
        ingredient_ids: Array.from(selected),
      });
      onClose();
      toast.success(`${r.items_added} Zutaten zu „${r.list_title}" hinzugefügt`);
      // Offer navigation after a short tick (lets the toast settle).
      setTimeout(async () => {
        if (
          await confirmDialog({
            title: `Zur Liste „${r.list_title}" wechseln?`,
            message: `${r.items_added} Zutaten wurden hinzugefügt.`,
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

  return (
    <Modal open={open} onClose={onClose} title="Zu Einkaufsliste hinzufügen" className="max-w-lg">
      <div className="space-y-4">
        {/* Servings */}
        <div className="flex items-center gap-3">
          <label className="label !mb-0" htmlFor={`${fid}-portionen`}>Portionen</label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setServings((s) => Math.max(1, s - 1))}
              className="size-8 rounded-lg border border-line hover:bg-page"
            >
              −
            </button>
            <input
              id={`${fid}-portionen`}
              type="number"
              min={1}
              max={maxServings}
              value={servings}
              onChange={(e) =>
                setServings(
                  Math.min(maxServings, Math.max(1, Number(e.target.value) || 1)),
                )
              }
              className="input w-20 text-center py-1.5"
            />
            <button
              type="button"
              onClick={() => setServings((s) => Math.min(maxServings, s + 1))}
              className="size-8 rounded-lg border border-line hover:bg-page"
            >
              +
            </button>
          </div>
          <span className="text-xs text-muted">
            {sourceUnknown
              ? 'Original: unbekannt — Mengen werden 1:1 übernommen'
              : (
                <>
                  Original: {recipe.servings}
                  {factor !== 1 && ` · Faktor ${fmtQty(factor)}×`}
                </>
              )}
          </span>
        </div>

        {/* Ingredients */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="label !mb-0">Zutaten</div>
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => setSelected(new Set(recipe.ingredients.map((i) => i.id)))}
              >
                alle
              </button>
              <span className="text-muted/60">|</span>
              <button
                type="button"
                className="text-muted hover:underline"
                onClick={() => setSelected(new Set())}
              >
                keine
              </button>
            </div>
          </div>
          <div className="border border-line rounded-xl divide-y divide-line max-h-56 overflow-auto">
            {recipe.ingredients.map((ing) => {
              const scaled = scaleQty(ing.quantity, factor);
              return (
                <label
                  key={ing.id}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-page"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(ing.id)}
                    onChange={() => toggle(ing.id)}
                    className="size-4 accent-brand"
                  />
                  <span className="flex-1 text-sm">{ing.name}</span>
                  <span className="text-xs text-muted tabular-nums">
                    {scaled !== null && fmtQty(scaled)} {ing.unit ?? ''}
                  </span>
                </label>
              );
            })}
            {recipe.ingredients.length === 0 && (
              <div className="px-3 py-4 text-sm text-muted/70 text-center">Keine Zutaten</div>
            )}
          </div>
        </div>

        {/* Target list */}
        <div>
          <div className="label">Ziel</div>
          <div role="group" aria-label="Ziel" className="flex gap-1 bg-surface border border-line rounded-xl p-1 mb-2">
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
              aria-label="Titel der neuen Liste"
              className="input"
              placeholder="Titel der neuen Liste"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={submitting} onClick={submit}>
            {submitting ? 'Hinzufügen…' : `Hinzufügen (${selected.size})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
