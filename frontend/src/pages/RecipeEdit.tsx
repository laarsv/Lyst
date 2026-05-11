import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { RecipesApi } from '@/api/endpoints';
import type { Recipe, RecipeCategory, RecipeIngredient, RecipeStep } from '@/types';
import { SortableEditRow } from '@/components/recipes/SortableEditRow';
import { CATEGORY_LABEL } from '@/components/recipes/RecipeCard';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

const CATEGORIES: RecipeCategory[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'DESSERT', 'DRINK', 'OTHER'];

interface DraftIngredient {
  id: number | string;
  persisted: boolean;
  name: string;
  quantity: number | null;
  unit: string | null;
}

interface DraftStep {
  id: number | string;
  persisted: boolean;
  description: string;
}

let tempCounter = 0;
const tempId = () => `tmp-${++tempCounter}`;

export function RecipeEditPage() {
  const { id } = useParams();
  const isNew = !id;
  const recipeId = id ? Number(id) : null;
  const nav = useNavigate();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [servings, setServings] = useState(2);
  const [prep, setPrep] = useState<number | ''>('');
  const [cook, setCook] = useState<number | ''>('');
  const [category, setCategory] = useState<RecipeCategory>('OTHER');
  const [imageUrl, setImageUrl] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const [ingredients, setIngredients] = useState<DraftIngredient[]>([]);
  const [steps, setSteps] = useState<DraftStep[]>([]);

  // Load existing recipe
  useEffect(() => {
    if (isNew) return;
    void (async () => {
      try {
        const r = await RecipesApi.get(recipeId!);
        setTitle(r.title);
        setDescription(r.description ?? '');
        setServings(r.servings);
        setPrep(r.prep_time_minutes ?? '');
        setCook(r.cook_time_minutes ?? '');
        setCategory(r.category);
        setImageUrl(r.image_url ?? '');
        setSourceUrl(r.source_url ?? '');
        setTags(r.tags);
        setIngredients(
          r.ingredients.map((i) => ({
            id: i.id,
            persisted: true,
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
          })),
        );
        setSteps(r.steps.map((s) => ({ id: s.id, persisted: true, description: s.description })));
      } catch (e) {
        toast.error(getApiError(e));
        nav('/recipes');
      } finally {
        setLoading(false);
      }
    })();
  }, [isNew, recipeId, nav]);

  // Tags
  const addTag = () => {
    const v = tagInput.trim().replace(/^#/, '');
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setTagInput('');
  };

  // Ingredients
  const addIngredient = () =>
    setIngredients((cur) => [
      ...cur,
      { id: tempId(), persisted: false, name: '', quantity: null, unit: null },
    ]);
  const updateIngredient = (id: number | string, patch: Partial<DraftIngredient>) =>
    setIngredients((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const removeIngredient = (id: number | string) =>
    setIngredients((cur) => cur.filter((i) => i.id !== id));

  // Steps
  const addStep = () =>
    setSteps((cur) => [...cur, { id: tempId(), persisted: false, description: '' }]);
  const updateStep = (id: number | string, description: string) =>
    setSteps((cur) => cur.map((s) => (s.id === id ? { ...s, description } : s)));
  const removeStep = (id: number | string) =>
    setSteps((cur) => cur.filter((s) => s.id !== id));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd =
    <T extends { id: number | string }>(setter: (fn: (cur: T[]) => T[]) => void) =>
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      setter((cur) => {
        const oldIdx = cur.findIndex((i) => i.id === active.id);
        const newIdx = cur.findIndex((i) => i.id === over.id);
        if (oldIdx === -1 || newIdx === -1) return cur;
        return arrayMove(cur, oldIdx, newIdx);
      });
    };

  const ingredientItems = useMemo(() => ingredients.map((i) => i.id), [ingredients]);
  const stepItems = useMemo(() => steps.map((s) => s.id), [steps]);

  const validate = (): string | null => {
    if (!title.trim()) return 'Titel ist erforderlich';
    if (servings < 1) return 'Portionen muss mindestens 1 sein';
    for (const i of ingredients) if (!i.name.trim()) return 'Alle Zutaten brauchen einen Namen';
    for (const s of steps) if (!s.description.trim()) return 'Alle Schritte brauchen Text';
    return null;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) return toast.error(err);
    setSaving(true);

    const baseFields = {
      title: title.trim(),
      description: description.trim() || null,
      servings,
      prep_time_minutes: prep === '' ? null : Number(prep),
      cook_time_minutes: cook === '' ? null : Number(cook),
      category,
      image_url: imageUrl.trim() || null,
      source_url: sourceUrl.trim() || null,
      tags,
    };

    try {
      if (isNew) {
        const created = await RecipesApi.create({
          ...baseFields,
          ingredients: ingredients.map((i) => ({
            name: i.name.trim(),
            quantity: i.quantity,
            unit: i.unit?.trim() || null,
          })),
          steps: steps.map((s) => ({ description: s.description.trim() })),
        });
        toast.success('Rezept gespeichert');
        nav(`/recipes/${created.id}`);
      } else {
        await RecipesApi.update(recipeId!, baseFields);
        await syncChildren(recipeId!);
        toast.success('Gespeichert');
        nav(`/recipes/${recipeId}`);
      }
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setSaving(false);
    }
  };

  /** Diff and apply ingredient/step changes to an existing recipe. */
  const syncChildren = async (rid: number) => {
    const original = await RecipesApi.get(rid);

    // Ingredients
    const origIngs = new Map<number, RecipeIngredient>(original.ingredients.map((i) => [i.id, i]));
    const seenIngIds = new Set<number>();
    const reorderIng: { id: number; position: number }[] = [];

    for (let i = 0; i < ingredients.length; i++) {
      const draft = ingredients[i];
      if (draft.persisted) {
        const id = draft.id as number;
        seenIngIds.add(id);
        const orig = origIngs.get(id);
        if (
          orig &&
          (orig.name !== draft.name.trim() ||
            (orig.quantity ?? null) !== (draft.quantity ?? null) ||
            (orig.unit ?? null) !== (draft.unit?.trim() || null))
        ) {
          await RecipesApi.updateIngredient(rid, id, {
            name: draft.name.trim(),
            quantity: draft.quantity,
            unit: draft.unit?.trim() || null,
          });
        }
        reorderIng.push({ id, position: i });
      } else {
        const created = await RecipesApi.addIngredient(rid, {
          name: draft.name.trim(),
          quantity: draft.quantity,
          unit: draft.unit?.trim() || null,
        });
        reorderIng.push({ id: created.id, position: i });
      }
    }
    for (const id of origIngs.keys()) {
      if (!seenIngIds.has(id)) await RecipesApi.removeIngredient(rid, id);
    }
    if (reorderIng.length) await RecipesApi.reorderIngredients(rid, reorderIng);

    // Steps
    const origSteps = new Map<number, RecipeStep>(original.steps.map((s) => [s.id, s]));
    const seenStepIds = new Set<number>();
    const reorderSt: { id: number; position: number }[] = [];

    for (let i = 0; i < steps.length; i++) {
      const draft = steps[i];
      if (draft.persisted) {
        const id = draft.id as number;
        seenStepIds.add(id);
        const orig = origSteps.get(id);
        if (orig && orig.description !== draft.description.trim()) {
          await RecipesApi.updateStep(rid, id, draft.description.trim());
        }
        reorderSt.push({ id, position: i });
      } else {
        const created = await RecipesApi.addStep(rid, draft.description.trim());
        reorderSt.push({ id: created.id, position: i });
      }
    }
    for (const id of origSteps.keys()) {
      if (!seenStepIds.has(id)) await RecipesApi.removeStep(rid, id);
    }
    if (reorderSt.length) await RecipesApi.reorderSteps(rid, reorderSt);
  };

  if (loading) return <div className="text-zinc-400">Lade…</div>;

  return (
    <form onSubmit={save} className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{isNew ? 'Neues Rezept' : 'Rezept bearbeiten'}</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => nav(isNew ? '/recipes' : `/recipes/${recipeId}`)}
          >
            Abbrechen
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>

      <section className="card p-5 space-y-3">
        <div>
          <label className="label">Titel</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label className="label">Beschreibung</label>
          <textarea
            className="input min-h-[80px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="label">Portionen</label>
            <input
              type="number"
              min={1}
              className="input"
              value={servings}
              onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div>
            <label className="label">Vorbereitung (Min)</label>
            <input
              type="number"
              min={0}
              className="input"
              value={prep}
              onChange={(e) => setPrep(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Kochen (Min)</label>
            <input
              type="number"
              min={0}
              className="input"
              value={cook}
              onChange={(e) => setCook(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Kategorie</label>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as RecipeCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Bild-URL</label>
            <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <label className="label">Quelle (URL)</label>
            <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <div>
          <label className="label">Tags</label>
          <div className="flex flex-wrap items-center gap-1 input min-h-[42px] py-2">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 text-xs bg-zinc-100 px-2 py-1 rounded-full">
                #{t}
                <button
                  type="button"
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                  className="text-zinc-400 hover:text-red-500"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="flex-1 min-w-[100px] outline-none text-sm"
              placeholder="+ tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
            />
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Zutaten</h2>
          <button type="button" className="btn-secondary text-sm" onClick={addIngredient}>
            + Zutat
          </button>
        </div>
        {ingredients.length === 0 ? (
          <p className="text-sm text-zinc-400">Noch keine Zutaten.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(setIngredients)}>
            <SortableContext items={ingredientItems} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {ingredients.map((ing) => (
                  <SortableEditRow key={ing.id} id={ing.id} onDelete={() => removeIngredient(ing.id)}>
                    <div className="flex flex-wrap gap-2">
                      <input
                        className="input flex-1 min-w-[160px] py-1.5"
                        placeholder="z.B. Mehl"
                        value={ing.name}
                        onChange={(e) => updateIngredient(ing.id, { name: e.target.value })}
                      />
                      <input
                        className="input w-20 py-1.5"
                        placeholder="Menge"
                        inputMode="decimal"
                        value={ing.quantity ?? ''}
                        onChange={(e) =>
                          updateIngredient(ing.id, {
                            quantity: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                      <input
                        className="input w-24 py-1.5"
                        placeholder="Einheit"
                        value={ing.unit ?? ''}
                        onChange={(e) => updateIngredient(ing.id, { unit: e.target.value })}
                      />
                    </div>
                  </SortableEditRow>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Schritte</h2>
          <button type="button" className="btn-secondary text-sm" onClick={addStep}>
            + Schritt
          </button>
        </div>
        {steps.length === 0 ? (
          <p className="text-sm text-zinc-400">Noch keine Schritte.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(setSteps)}>
            <SortableContext items={stepItems} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <SortableEditRow key={step.id} id={step.id} onDelete={() => removeStep(step.id)}>
                    <div className="flex gap-2">
                      <span className="size-7 rounded-full bg-brand-50 text-brand-700 font-semibold text-sm flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <textarea
                        className="input flex-1 min-h-[60px] py-1.5"
                        placeholder="Schritt beschreiben…"
                        value={step.description}
                        onChange={(e) => updateStep(step.id, e.target.value)}
                      />
                    </div>
                  </SortableEditRow>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => nav(isNew ? '/recipes' : `/recipes/${recipeId}`)}
        >
          Abbrechen
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Speichern…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
