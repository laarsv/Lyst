import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RecipesApi } from '@/api/endpoints';
import type { Recipe } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '@/components/recipes/RecipeCard';
import { CopyToListModal } from '@/components/recipes/CopyToListModal';
import { fmtQty } from '@/lib/format';

export function RecipeDetailPage() {
  const { id } = useParams();
  const recipeId = Number(id);
  const nav = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
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

  if (loading || !recipe) return <div className="text-zinc-400">Lade…</div>;

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
              {recipe.description && <p className="text-zinc-600 mt-2">{recipe.description}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 mt-3">
                <span>🍴 {recipe.servings} Pers.</span>
                {recipe.prep_time_minutes !== null && <span>Vorbereitung: {recipe.prep_time_minutes} Min</span>}
                {recipe.cook_time_minutes !== null && <span>Kochen: {recipe.cook_time_minutes} Min</span>}
                {totalTime > 0 && <span className="font-medium">Gesamt: {totalTime} Min</span>}
              </div>
              {recipe.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {recipe.tags.map((t) => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">#{t}</span>
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
              <button className="btn-primary" onClick={() => setCopyOpen(true)}>Zu Einkaufsliste</button>
              <Link to={`/recipes/${recipe.id}/edit`} className="btn-secondary">Bearbeiten</Link>
              <button className="btn-secondary" onClick={duplicate}>Duplizieren</button>
              <button className="btn-ghost text-red-600" onClick={remove}>Löschen</button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <section className="card p-5">
          <h2 className="font-semibold mb-3">Zutaten</h2>
          {recipe.ingredients.length === 0 ? (
            <div className="text-sm text-zinc-400">Keine Zutaten erfasst.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {recipe.ingredients.map((ing) => (
                <li key={ing.id} className="py-2 flex items-baseline gap-2">
                  <span className="text-sm text-zinc-500 tabular-nums w-20 shrink-0">
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
            <div className="text-sm text-zinc-400">Keine Schritte erfasst.</div>
          ) : (
            <ol className="space-y-3">
              {recipe.steps.map((s, i) => (
                <li key={s.id} className="flex gap-3">
                  <span className="size-7 rounded-full bg-brand-50 text-brand-700 font-semibold text-sm flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <p className="text-zinc-700 whitespace-pre-wrap leading-relaxed pt-0.5">{s.description}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <CopyToListModal open={copyOpen} recipe={recipe} onClose={() => setCopyOpen(false)} />
    </div>
  );
}
