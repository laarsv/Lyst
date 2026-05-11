import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListsApi, RecipesApi } from '@/api/endpoints';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { fmtQty, scaleQty } from '@/lib/format';
import type { ListSummary, Recipe } from '@/types';

interface Props {
  open: boolean;
  recipe: Recipe;
  onClose: () => void;
}

type Mode = 'existing' | 'new';

export function CopyToListModal({ open, recipe, onClose }: Props) {
  const [shoppingLists, setShoppingLists] = useState<ListSummary[]>([]);
  const [mode, setMode] = useState<Mode>('new');
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [servings, setServings] = useState(recipe.servings);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) return;
    setServings(recipe.servings);
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
  }, [open, recipe]);

  const factor = useMemo(
    () => (recipe.servings > 0 ? servings / recipe.servings : 1),
    [servings, recipe.servings],
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
      // Offer navigation after a short tick
      setTimeout(() => {
        if (confirm(`Zur Liste „${r.list_title}" wechseln?`)) nav(`/lists/${r.list_id}`);
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
          <label className="label !mb-0">Portionen</label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setServings((s) => Math.max(1, s - 1))}
              className="size-8 rounded-lg border border-zinc-200 hover:bg-zinc-50"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={999}
              value={servings}
              onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))}
              className="input w-20 text-center py-1.5"
            />
            <button
              type="button"
              onClick={() => setServings((s) => Math.min(999, s + 1))}
              className="size-8 rounded-lg border border-zinc-200 hover:bg-zinc-50"
            >
              +
            </button>
          </div>
          <span className="text-xs text-zinc-500">
            Original: {recipe.servings}
            {factor !== 1 && ` · Faktor ${fmtQty(factor)}×`}
          </span>
        </div>

        {/* Ingredients */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label !mb-0">Zutaten</label>
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => setSelected(new Set(recipe.ingredients.map((i) => i.id)))}
              >
                alle
              </button>
              <span className="text-zinc-300">|</span>
              <button
                type="button"
                className="text-zinc-500 hover:underline"
                onClick={() => setSelected(new Set())}
              >
                keine
              </button>
            </div>
          </div>
          <div className="border border-zinc-100 rounded-xl divide-y divide-zinc-100 max-h-56 overflow-auto">
            {recipe.ingredients.map((ing) => {
              const scaled = scaleQty(ing.quantity, factor);
              return (
                <label
                  key={ing.id}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(ing.id)}
                    onChange={() => toggle(ing.id)}
                    className="size-4 accent-brand"
                  />
                  <span className="flex-1 text-sm">{ing.name}</span>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {scaled !== null && fmtQty(scaled)} {ing.unit ?? ''}
                  </span>
                </label>
              );
            })}
            {recipe.ingredients.length === 0 && (
              <div className="px-3 py-4 text-sm text-zinc-400 text-center">Keine Zutaten</div>
            )}
          </div>
        </div>

        {/* Target list */}
        <div>
          <label className="label">Ziel</label>
          <div className="flex gap-1 bg-zinc-100 rounded-xl p-1 mb-2">
            <button
              type="button"
              onClick={() => setMode('existing')}
              disabled={shoppingLists.length === 0}
              className={`flex-1 px-3 py-1.5 rounded-lg text-sm transition disabled:opacity-50 ${
                mode === 'existing' ? 'bg-white shadow-sm font-medium' : 'text-zinc-600'
              }`}
            >
              Bestehende Liste
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-sm transition ${
                mode === 'new' ? 'bg-white shadow-sm font-medium' : 'text-zinc-600'
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
          <button className="btn-primary" disabled={submitting} onClick={submit}>
            {submitting ? 'Hinzufügen…' : `Hinzufügen (${selected.size})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
