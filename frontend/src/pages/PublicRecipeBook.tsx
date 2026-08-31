/** Public read-only recipe-book view (route: /share/recipe-book/:token).
 *  Grid of recipe cards — clicking a card opens the per-recipe public view
 *  if that recipe is also share-enabled (otherwise the card stays inert).
 *  Includes a search box that filters within the book. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { RecipesApi } from '@/api/endpoints';
import type { PublicRecipeBookData, PublicRecipeBookEntry } from '@/types';

export function PublicRecipeBookPage() {
  const { token } = useParams();
  const [data, setData] = useState<PublicRecipeBookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        setData(await RecipesApi.getPublicBook(token));
      } catch {
        setError('Dieses Rezeptbuch ist nicht (mehr) öffentlich.');
      }
    })();
  }, [token]);

  const visible = useMemo(() => {
    if (!data) return [];
    if (!q.trim()) return data.recipes;
    const needle = q.toLowerCase();
    return data.recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [data, q]);

  if (error) {
    return (
      <div className="min-h-full flex items-center justify-center p-6 text-center">
        <div className="card p-8 max-w-sm">
          <div className="wordmark text-3xl mb-2">lyst</div>
          <p className="text-muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-center text-muted/70">Lade…</div>;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="text-center mb-4">
        <a href="/" className="wordmark text-xl">lyst</a>
      </div>

      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Rezeptbuch von {data.owner_name}</h1>
        <p className="text-sm text-muted">{data.recipes.length} Rezepte</p>
      </header>

      <div className="mb-6">
        <input
          aria-label="Rezepte durchsuchen"
          type="search"
          className="input"
          placeholder="Rezept oder Tag suchen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {visible.length === 0 ? (
        <div className="card p-12 text-center text-muted">
          {data.recipes.length === 0 ? 'Noch keine Rezepte.' : 'Keine Treffer.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((r) => (
            <PublicBookCard key={r.id} recipe={r} />
          ))}
        </div>
      )}

      <footer className="text-center text-xs text-muted mt-8 mb-4">
        Erstellt mit{' '}
        <a href="/" className="wordmark text-sm align-baseline">lyst</a>
      </footer>
    </div>
  );
}

function PublicBookCard({ recipe }: { recipe: PublicRecipeBookEntry }) {
  const totalTime = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);
  const meta = (
    <>
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
        <div className="flex items-start gap-2 mb-1">
          <div className="font-semibold text-ink truncate flex-1">{recipe.title}</div>
          {!recipe.share_token && (
            <Lock size={14} className="text-muted shrink-0" aria-label="Detail nicht freigegeben" />
          )}
        </div>
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
    </>
  );

  if (recipe.share_token) {
    return (
      <Link
        to={`/share/recipe/${recipe.share_token}`}
        className="card p-5 hover:shadow-md transition flex flex-col gap-3 group"
      >
        {meta}
      </Link>
    );
  }
  return (
    <div
      className="card p-5 flex flex-col gap-3 cursor-default opacity-80"
      title="Detailansicht ist nicht freigegeben"
    >
      {meta}
    </div>
  );
}
