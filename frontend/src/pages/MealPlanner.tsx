import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { MealPlansApi, RecipesApi } from '@/api/endpoints';
import type { MealPlan, MealPlanEntry, MealType, RecipeSummary } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { invalidateOverview, useOverviewQuery } from '@/hooks/useOverviewQuery';
import {
  WEEKDAY_LABELS_DE,
  WEEKDAY_LABELS_DE_LONG,
  addDays,
  isoDate,
  isoWeekNumber,
  mondayOf,
} from '@/lib/week';
import { MEAL_LABEL } from '@/lib/meals';

const MEAL_TYPES: MealType[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];

export function MealPlannerPage() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [recipeQ, setRecipeQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const nav = useNavigate();

  const loadPlan = useCallback(async (week: Date) => {
    setLoading(true);
    try {
      setPlan(await MealPlansApi.forWeek(isoDate(week)));
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Network-first refresh for the meal plan; week change re-keys so the
  // hook fires fresh fetches per week. Also picks up
  // invalidateOverview('mealplans') from cross-page mutations.
  useOverviewQuery(`mealplans:${isoDate(weekStart)}`, () => loadPlan(weekStart));

  // Recipe sidebar mirrors the recipes overview — same key so a recipe
  // mutation refreshes both surfaces in sync.
  useOverviewQuery('recipes', async () => {
    try {
      setRecipes(await RecipesApi.list());
    } catch (e) {
      toast.error(getApiError(e));
    }
  });

  const filteredRecipes = useMemo(() => {
    if (!recipeQ) return recipes;
    const n = recipeQ.toLowerCase();
    return recipes.filter(
      (r) => r.title.toLowerCase().includes(n) || r.tags.some((t) => t.toLowerCase().includes(n)),
    );
  }, [recipes, recipeQ]);

  const entriesByCell = useMemo(() => {
    const map = new Map<string, MealPlanEntry[]>();
    for (const e of plan?.entries ?? []) {
      const key = `${e.day_of_week}:${e.meal_type}`;
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [plan]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    if (!plan || !e.over) return;
    const dragData = e.active.data.current as
      | { kind: 'recipe'; recipe: RecipeSummary }
      | { kind: 'entry'; entry: MealPlanEntry }
      | undefined;
    const dropData = e.over.data.current as { day: number; meal: MealType } | undefined;
    if (!dragData || !dropData) return;

    if (dragData.kind === 'recipe') {
      try {
        const created = await MealPlansApi.addEntry(plan.id, {
          recipe_id: dragData.recipe.id,
          day_of_week: dropData.day,
          meal_type: dropData.meal,
          servings: dragData.recipe.servings,
        });
        setPlan((cur) => (cur ? { ...cur, entries: [...cur.entries, created] } : cur));
      } catch (err) {
        toast.error(getApiError(err));
      }
    } else if (dragData.kind === 'entry') {
      const entry = dragData.entry;
      if (entry.day_of_week === dropData.day && entry.meal_type === dropData.meal) return;
      try {
        const upd = await MealPlansApi.updateEntry(plan.id, entry.id, {
          day_of_week: dropData.day,
          meal_type: dropData.meal,
        });
        setPlan((cur) =>
          cur ? { ...cur, entries: cur.entries.map((e) => (e.id === upd.id ? upd : e)) } : cur,
        );
      } catch (err) {
        toast.error(getApiError(err));
      }
    }
  };

  const removeEntry = async (entry: MealPlanEntry) => {
    if (!plan) return;
    try {
      await MealPlansApi.removeEntry(plan.id, entry.id);
      setPlan((cur) =>
        cur ? { ...cur, entries: cur.entries.filter((e) => e.id !== entry.id) } : cur,
      );
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const updateServings = async (entry: MealPlanEntry, servings: number) => {
    if (!plan) return;
    if (servings < 1 || servings > 99) return;
    // Optimistic
    setPlan((cur) =>
      cur ? { ...cur, entries: cur.entries.map((e) => (e.id === entry.id ? { ...e, servings } : e)) } : cur,
    );
    try {
      await MealPlansApi.updateEntry(plan.id, entry.id, { servings });
    } catch (err) {
      toast.error(getApiError(err));
      void loadPlan(weekStart);
    }
  };

  const generate = async () => {
    if (!plan) return;
    setGenerating(true);
    try {
      const r = await MealPlansApi.generateList(plan.id);
      // The generator creates a new shopping list — invalidate the
      // dashboard's lists subscriber so when the user backs out of the
      // new /lists/:id detail page, the overview shows it without a
      // manual reload.
      invalidateOverview('lists');
      toast.success(`${r.items_added} Zutaten in „${r.list_title}"`);
      nav(`/lists/${r.list_id}`);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setGenerating(false);
    }
  };

  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `KW ${isoWeekNumber(weekStart)} · ${weekStart.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}–${weekEnd.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Wochenplanung</h1>
            <p className="text-sm text-muted">{weekLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary text-sm"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              aria-label="Vorherige Woche"
            >
              ←
            </button>
            <button
              className="btn-secondary text-sm"
              onClick={() => setWeekStart(mondayOf(new Date()))}
            >
              Heute
            </button>
            <button
              className="btn-secondary text-sm"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              aria-label="Nächste Woche"
            >
              →
            </button>
            <button
              className="btn-primary text-sm"
              disabled={generating || !plan || plan.entries.length === 0}
              onClick={generate}
            >
              {generating ? 'Generiere…' : 'Einkaufsliste generieren'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-muted/70">Lade Wochenplan…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
            <RecipeSidebar
              recipes={filteredRecipes}
              q={recipeQ}
              onQuery={setRecipeQ}
            />
            <PlannerGrid
              weekStart={weekStart}
              entriesByCell={entriesByCell}
              onUpdateServings={updateServings}
              onRemove={removeEntry}
            />
          </div>
        )}
      </div>
    </DndContext>
  );
}

// ---------- Sidebar ----------

function RecipeSidebar({
  recipes,
  q,
  onQuery,
}: {
  recipes: RecipeSummary[];
  q: string;
  onQuery: (s: string) => void;
}) {
  return (
    <aside className="card p-3 flex flex-col gap-2 max-h-[70vh] overflow-hidden">
      <div className="font-semibold text-sm px-1">Rezepte</div>
      <input
        className="input py-1.5 text-sm"
        placeholder="Suchen…"
        value={q}
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="flex-1 overflow-auto -mx-1 px-1 space-y-1.5">
        {recipes.length === 0 && (
          <div className="text-sm text-muted/70 py-4 text-center">Keine Rezepte.</div>
        )}
        {recipes.map((r) => (
          <DraggableRecipe key={r.id} recipe={r} />
        ))}
      </div>
      <div className="text-[11px] text-muted/70 px-1 pt-2 border-t border-line">
        Tipp: Rezept auf eine Zelle ziehen, um es einzuplanen.
      </div>
    </aside>
  );
}

function DraggableRecipe({ recipe }: { recipe: RecipeSummary }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `recipe-${recipe.id}`,
    data: { kind: 'recipe', recipe },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`p-2 rounded-ctl border border-line bg-surface cursor-grab text-sm ${
        isDragging ? 'opacity-40' : 'hover:border-brand'
      }`}
    >
      <div className="font-medium truncate">{recipe.title}</div>
      <div className="text-[11px] text-muted">
        {recipe.servings} Pers. · {recipe.ingredient_count} Zutaten
      </div>
    </div>
  );
}

// ---------- Grid ----------

function PlannerGrid({
  weekStart,
  entriesByCell,
  onUpdateServings,
  onRemove,
}: {
  weekStart: Date;
  entriesByCell: Map<string, MealPlanEntry[]>;
  onUpdateServings: (e: MealPlanEntry, s: number) => void;
  onRemove: (e: MealPlanEntry) => void;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            <th className="px-2 py-2 text-left text-xs font-medium text-muted w-20"></th>
            {WEEKDAY_LABELS_DE.map((d, i) => {
              const day = addDays(weekStart, i);
              return (
                <th key={i} className="px-2 py-2 text-left font-medium" title={WEEKDAY_LABELS_DE_LONG[i]}>
                  <div className="text-xs text-muted">{d}</div>
                  <div className="text-sm">{day.getDate()}.{day.getMonth() + 1}.</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {MEAL_TYPES.map((meal) => (
            <tr key={meal} className="border-t border-line align-top">
              <td className="px-2 py-2 text-xs text-muted whitespace-nowrap">{MEAL_LABEL[meal]}</td>
              {WEEKDAY_LABELS_DE.map((_, day) => {
                const cell = entriesByCell.get(`${day}:${meal}`) ?? [];
                return (
                  <td key={day} className="p-1.5 align-top">
                    <Cell day={day} meal={meal} entries={cell} onUpdateServings={onUpdateServings} onRemove={onRemove} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  day,
  meal,
  entries,
  onUpdateServings,
  onRemove,
}: {
  day: number;
  meal: MealType;
  entries: MealPlanEntry[];
  onUpdateServings: (e: MealPlanEntry, s: number) => void;
  onRemove: (e: MealPlanEntry) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${day}-${meal}`,
    data: { day, meal },
  });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[78px] rounded-ctl border border-dashed transition flex flex-col gap-1 p-1 ${
        isOver ? 'bg-brand-50 border-brand' : 'border-line'
      }`}
    >
      {entries.length === 0 && !isOver && (
        <div className="text-[11px] text-muted/60 text-center py-3 select-none">+</div>
      )}
      {entries.map((e) => (
        <EntryCard key={e.id} entry={e} onUpdateServings={onUpdateServings} onRemove={onRemove} />
      ))}
    </div>
  );
}

function EntryCard({
  entry,
  onUpdateServings,
  onRemove,
}: {
  entry: MealPlanEntry;
  onUpdateServings: (e: MealPlanEntry, s: number) => void;
  onRemove: (e: MealPlanEntry) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `entry-${entry.id}`,
    data: { kind: 'entry', entry },
  });
  return (
    <div
      ref={setNodeRef}
      className={`group rounded-ctl bg-surface border border-line p-1.5 ${isDragging ? 'opacity-40' : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="text-xs font-medium truncate cursor-grab"
        title={entry.recipe_title}
      >
        {entry.recipe_title}
      </div>
      <div className="flex items-center justify-between gap-1 mt-1">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="size-5 rounded text-xs hover:bg-page"
            onClick={() => onUpdateServings(entry, entry.servings - 1)}
            aria-label="weniger Portionen"
          >
            −
          </button>
          <span className="text-[11px] text-muted tabular-nums">{entry.servings} P.</span>
          <button
            type="button"
            className="size-5 rounded text-xs hover:bg-page"
            onClick={() => onUpdateServings(entry, entry.servings + 1)}
            aria-label="mehr Portionen"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={() => onRemove(entry)}
          className="text-[11px] text-muted/70 hover:text-danger opacity-0 group-hover:opacity-100"
          aria-label="Entfernen"
        >
          ×
        </button>
      </div>
    </div>
  );
}
