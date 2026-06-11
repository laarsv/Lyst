import { useEffect, useState } from 'react';
import { RecipesApi } from '@/api/endpoints';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { fmtQty } from '@/lib/format';
import type { RecipeIngredient, SubstitutionContext, SubstitutionItem } from '@/types';

const CONTEXTS: { value: '' | SubstitutionContext; label: string }[] = [
  { value: '', label: 'Gute Alternativen' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'glutenfrei', label: 'Glutenfrei' },
  { value: 'laktosefrei', label: 'Laktosefrei' },
  { value: 'nussfrei', label: 'Nussfrei' },
  { value: 'milder', label: 'Milder' },
  { value: 'günstiger', label: 'Günstiger' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  recipeId: number;
  ingredient: RecipeIngredient;
  /** Current recipe description — the base for "Als Notiz speichern". */
  description: string | null;
  /** Only owners / EDIT recipients see the Ersetzen / Notiz actions. */
  canEdit: boolean;
  /** Refetch the recipe after a replace / note save. */
  onChanged: () => void;
}

export function IngredientSubstituteSheet({
  open,
  onClose,
  recipeId,
  ingredient,
  description,
  canEdit,
  onChanged,
}: Props) {
  const [context, setContext] = useState<'' | SubstitutionContext>('');
  const [items, setItems] = useState<SubstitutionItem[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset the lens whenever a different ingredient's sheet opens.
  useEffect(() => {
    if (open) setContext('');
  }, [open, ingredient.id]);

  // Fetch on open and whenever the context lens changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setItems(null);
    setNote(null);
    void (async () => {
      try {
        const r = await RecipesApi.substitutions(recipeId, ingredient.id, context || null);
        if (cancelled) return;
        setItems(r.substitutions);
        setNote(r.note);
      } catch (e) {
        if (!cancelled) {
          setItems([]);
          toast.error(getApiError(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, recipeId, ingredient.id, context]);

  const replace = async (s: SubstitutionItem) => {
    setBusy(true);
    try {
      await RecipesApi.updateIngredient(recipeId, ingredient.id, {
        name: s.name,
        quantity: s.quantity,
        unit: s.unit,
      });
      toast.success(`„${ingredient.name}" durch „${s.name}" ersetzt`);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async (s: SubstitutionItem) => {
    setBusy(true);
    const line = `Alternativ zu ${ingredient.name}: ${s.name}`;
    const next = description?.trim() ? `${description.trimEnd()}\n${line}` : line;
    try {
      await RecipesApi.update(recipeId, { description: next });
      toast.success('Als Notiz gespeichert');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Alternativen für „${ingredient.name}"`} className="max-w-md">
      <div className="space-y-3">
        <select
          className="input"
          value={context}
          onChange={(e) => setContext(e.target.value as '' | SubstitutionContext)}
        >
          {CONTEXTS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        {loading ? (
          <div className="py-8 text-center text-muted text-sm">KI sucht Alternativen…</div>
        ) : items && items.length > 0 ? (
          <ul className="space-y-2">
            {items.map((s, i) => (
              <li key={i} className="rounded-xl border border-line p-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium flex-1">{s.name}</span>
                  {(s.quantity != null || s.unit) && (
                    <span className="text-xs text-muted tabular-nums">
                      {s.quantity != null ? fmtQty(s.quantity) : ''} {s.unit ?? ''}
                    </span>
                  )}
                </div>
                {s.rationale && <p className="text-sm text-muted mt-1">{s.rationale}</p>}
                {canEdit && (
                  <div className="flex gap-2 mt-2">
                    <button className="btn-secondary text-sm flex-1" disabled={busy} onClick={() => replace(s)}>
                      Ersetzen
                    </button>
                    <button className="btn-ghost text-sm flex-1" disabled={busy} onClick={() => saveNote(s)}>
                      Als Notiz speichern
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-6 text-center text-muted text-sm">
            {note || 'Keine Alternativen gefunden.'}
          </div>
        )}

        {note && items && items.length > 0 && (
          <p className="text-xs text-muted/80">{note}</p>
        )}
      </div>
    </Modal>
  );
}
