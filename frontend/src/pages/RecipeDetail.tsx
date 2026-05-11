import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RecipesApi } from '@/api/endpoints';
import type { Recipe } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '@/components/recipes/RecipeCard';
import { CopyToListModal } from '@/components/recipes/CopyToListModal';
import { CookMode } from '@/components/recipes/CookMode';
import { fmtQty } from '@/lib/format';

export function RecipeDetailPage() {
  const { id } = useParams();
  const recipeId = Number(id);
  const nav = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [cookOpen, setCookOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copyOpen, setCopyOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setRecipe(await RecipesApi.get(recipeId));
      } catch (e) {
        toast.error(getApiError(e));
        nav('/recipes');
      } finally {
        setLoading(false);
      }
    })();
  }, [recipeId, nav]);

  const remove = async () => {
    if (!recipe || !confirm(`Rezept „${recipe.title}" löschen?`)) return;
    try {
      await RecipesApi.remove(recipe.id);
      toast.success('Rezept gelöscht');
      nav('/recipes');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const duplicate = async () => {
    if (!recipe) return;
    try {
      const dup = await RecipesApi.duplicate(recipe.id);
      toast.success('Dupliziert');
      nav(`/recipes/${dup.id}`);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  if (loading || !recipe) return <div className="text-muted/70">Lade…</div>;

  const totalTime = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        {recipe.image_url && (
          <div className="h-48 sm:h-64 bg-cover bg-center" style={{ backgroundImage: `url(${recipe.image_url})` }} />
        )}
        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold">{recipe.title}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLOR[recipe.category]}`}>
                  {CATEGORY_LABEL[recipe.category]}
                </span>
              </div>
              {recipe.description && <p className="text-muted mt-2">{recipe.description}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted mt-3">
                <span>🍴 {recipe.servings} Pers.</span>
                {recipe.prep_time_minutes !== null && <span>Vorbereitung: {recipe.prep_time_minutes} Min</span>}
                {recipe.cook_time_minutes !== null && <span>Kochen: {recipe.cook_time_minutes} Min</span>}
                {totalTime > 0 && <span className="font-medium">Gesamt: {totalTime} Min</span>}
              </div>
              {recipe.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {recipe.tags.map((t) => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-chip bg-line text-muted">#{t}</span>
                  ))}
                </div>
              )}
              {recipe.source_url && (
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-3 text-xs text-brand hover:underline truncate max-w-full"
                >
                  Quelle: {recipe.source_url}
                </a>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => setCookOpen(true)} disabled={recipe.steps.length === 0}>
                Kochen starten
              </button>
              <button className="btn-secondary" onClick={() => setCopyOpen(true)}>Zu Einkaufsliste</button>
              <Link to={`/recipes/${recipe.id}/edit`} className="btn-secondary">Bearbeiten</Link>
              <button className="btn-secondary" onClick={duplicate}>Duplizieren</button>
              <button className="btn-ghost text-danger" onClick={remove}>Löschen</button>
            </div>
          </div>
        </div>
      </div>

      <NutritionCard recipe={recipe} />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <section className="card p-5">
          <h2 className="font-semibold mb-3">Zutaten</h2>
          {recipe.ingredients.length === 0 ? (
            <div className="text-sm text-muted/70">Keine Zutaten erfasst.</div>
          ) : (
            <ul className="divide-y divide-line">
              {recipe.ingredients.map((ing) => (
                <li key={ing.id} className="py-2 flex items-baseline gap-2">
                  <span className="text-sm text-muted tabular-nums w-20 shrink-0">
                    {fmtQty(ing.quantity)} {ing.unit ?? ''}
                  </span>
                  <span className="text-sm">{ing.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-semibold mb-3">Zubereitung</h2>
          {recipe.steps.length === 0 ? (
            <div className="text-sm text-muted/70">Keine Schritte erfasst.</div>
          ) : (
            <ol className="space-y-3">
              {recipe.steps.map((s, i) => (
                <li key={s.id} className="flex gap-3">
                  <span className="size-7 rounded-full bg-brand-50 text-brand-700 font-semibold text-sm flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <p className="text-ink whitespace-pre-wrap leading-relaxed pt-0.5">{s.description}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <CopyToListModal open={copyOpen} recipe={recipe} onClose={() => setCopyOpen(false)} />
      {cookOpen && (
        <CookMode recipe={recipe} servings={recipe.servings} onClose={() => setCookOpen(false)} />
      )}
    </div>
  );
}

function NutritionCard({ recipe }: { recipe: Recipe }) {
  const n = recipe.nutrition_per_serving;
  // Hide silently if there's no data at all
  if (n.calories == null && n.protein == null && n.carbs == null && n.fat == null) return null;
  const cells: { label: string; value: number | null; unit: string }[] = [
    { label: 'Kalorien', value: n.calories, unit: 'kcal' },
    { label: 'Eiweiß', value: n.protein, unit: 'g' },
    { label: 'Kohlenhydrate', value: n.carbs, unit: 'g' },
    { label: 'Fett', value: n.fat, unit: 'g' },
  ];
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold">Nährwerte pro Portion</h2>
        <span className="text-xs text-muted">
          basiert auf erfassten Zutaten (g/kg)
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded-card border border-line p-3">
            <div className="text-xs text-muted">{c.label}</div>
            <div className="text-lg font-semibold tabular-nums">
              {c.value != null ? `${c.value}` : '—'}
              <span className="text-xs font-normal text-muted ml-1">{c.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
