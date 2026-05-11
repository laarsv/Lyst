import { Link } from 'react-router-dom';
import type { RecipeCategory, RecipeSummary } from '@/types';

const CATEGORY_LABEL: Record<RecipeCategory, string> = {
  BREAKFAST: 'Frühstück',
  LUNCH: 'Mittag',
  DINNER: 'Abend',
  SNACK: 'Snack',
  DESSERT: 'Dessert',
  DRINK: 'Getränk',
  OTHER: 'Sonstiges',
};

const CATEGORY_COLOR: Record<RecipeCategory, string> = {
  BREAKFAST: 'bg-amber-50 text-amber-700',
  LUNCH: 'bg-emerald-50 text-emerald-700',
  DINNER: 'bg-violet-50 text-violet-700',
  SNACK: 'bg-sky-50 text-sky-700',
  DESSERT: 'bg-pink-50 text-pink-700',
  DRINK: 'bg-cyan-50 text-cyan-700',
  OTHER: 'bg-zinc-100 text-zinc-700',
};

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const totalTime = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);
  return (
    <Link to={`/recipes/${recipe.id}`} className="card p-5 hover:shadow-md transition flex flex-col gap-3 group">
      {recipe.image_url ? (
        <div
          className="-mx-5 -mt-5 mb-1 h-32 bg-cover bg-center rounded-t-2xl"
          style={{ backgroundImage: `url(${recipe.image_url})` }}
        />
      ) : (
        <div className="-mx-5 -mt-5 mb-1 h-32 bg-gradient-to-br from-zinc-100 to-zinc-200 rounded-t-2xl flex items-center justify-center text-3xl">
          🍽️
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="font-semibold text-zinc-900 truncate flex-1">{recipe.title}</div>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${CATEGORY_COLOR[recipe.category]}`}>
            {CATEGORY_LABEL[recipe.category]}
          </span>
        </div>
        <div className="text-xs text-zinc-500 flex flex-wrap gap-x-3 gap-y-1">
          {totalTime > 0 && <span>⏱ {totalTime} Min</span>}
          <span>🍴 {recipe.servings} Pers.</span>
          <span>{recipe.ingredient_count} Zutaten</span>
        </div>
        {recipe.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {recipe.tags.slice(0, 4).map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export { CATEGORY_LABEL, CATEGORY_COLOR };
