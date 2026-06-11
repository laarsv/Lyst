import { Link } from 'react-router-dom';
import { Heart, Users } from 'lucide-react';
import type { RecipeSummary } from '@/types';
import { SharedChip } from '@/components/SharedChip';
import { StarRating } from '@/components/recipes/StarRating';

/** Recipe summary card. The old fixed `category` enum was migrated into
 *  `tags` in alembic 0011 — the meal-type bucket now renders as the first
 *  tag chip alongside the others, so the card no longer needs a separate
 *  category badge. */
export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const totalTime = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);
  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="card p-5 hover:shadow-md transition flex flex-col gap-3 group relative"
    >
      {recipe.is_favorite && (
        <div className="absolute top-2 right-2 z-[1] size-7 rounded-full bg-surface/90 border border-line flex items-center justify-center shadow-sm">
          <Heart size={15} className="fill-danger text-danger" />
        </div>
      )}
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
        <div className="flex items-center gap-1.5 mb-1">
          <span className="font-semibold text-ink truncate flex-1">{recipe.title}</span>
          {recipe.source === 'ai_variant' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 shrink-0">
              Variante
            </span>
          )}
          {/* Owner-side share chip — internal share recipients + the
              public token rendered as one icon with a combined
              tooltip. Recipient cards (share_source set) hide it. */}
          {!recipe.share_source && (
            <SharedChip state={recipe.share_state} className="shrink-0" />
          )}
        </div>
        {recipe.share_source && recipe.owner_name && (
          <div className="text-[11px] text-brand-700 inline-flex items-center gap-1 mb-1">
            <Users size={11} />
            <span>Geteilt von {recipe.owner_name}</span>
          </div>
        )}
        <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
          {totalTime > 0 && <span>⏱ {totalTime} Min</span>}
          <span>🍴 {recipe.servings} Pers.</span>
          <span>{recipe.ingredient_count} Zutaten</span>
        </div>
        {recipe.rating > 0 && (
          <div className="mt-1.5">
            <StarRating value={recipe.rating} size={13} />
          </div>
        )}
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
