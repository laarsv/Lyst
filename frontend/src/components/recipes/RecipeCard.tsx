import { Link } from 'react-router-dom';
import type { RecipeSummary } from '@/types';

/** Recipe summary card. The old fixed `category` enum was migrated into
 *  `tags` in alembic 0011 — the meal-type bucket now renders as the first
 *  tag chip alongside the others, so the card no longer needs a separate
 *  category badge. */
export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const totalTime = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);
  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="card p-5 hover:shadow-md transition flex flex-col gap-3 group"
    >
      {recipe.image_url ? (
        <div
          className="-mx-5 -mt-5 mb-1 h-32 bg-cover bg-center rounded-t-2xl"
          style={{ backgroundImage: `url(${recipe.image_url})` }}
        />
      ) : (
        <div className="-mx-5 -mt-5 mb-1 h-32 bg-gradient-to-br from-brand-50 to-brand-100/40 rounded-t-2xl flex items-center justify-center text-3xl">
          🍽️
        </div>
      )}
      <div className="min-w-0">
        <div className="font-semibold text-ink truncate mb-1">{recipe.title}</div>
        <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
          {totalTime > 0 && <span>⏱ {totalTime} Min</span>}
          <span>🍴 {recipe.servings} Pers.</span>
          <span>{recipe.ingredient_count} Zutaten</span>
        </div>
        {recipe.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {recipe.tags.slice(0, 4).map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-page text-muted">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
