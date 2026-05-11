import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RecipesApi } from '@/api/endpoints';
import type { RecipeCategory, RecipeSummary } from '@/types';
import { RecipeCard, CATEGORY_LABEL } from '@/components/recipes/RecipeCard';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

const CATEGORIES: ('ALL' | RecipeCategory)[] = [
  'ALL', 'BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'DESSERT', 'DRINK', 'OTHER',
];

export function RecipesPage() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'ALL' | RecipeCategory>('ALL');

  const load = async () => {
    setLoading(true);
    try {
      const r = await RecipesApi.list({
        q: q || undefined,
        category: filter === 'ALL' ? undefined : filter,
      });
      setRecipes(r);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const visible = useMemo(() => {
    if (!q) return recipes;
    const needle = q.toLowerCase();
    return recipes.filter(
      (r) => r.title.toLowerCase().includes(needle) || r.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [recipes, q]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Rezepte</h1>
        <Link to="/recipes/new" className="btn-primary">+ Neues Rezept</Link>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Rezept oder Tag suchen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <div className="flex gap-1 bg-zinc-100 rounded-xl p-1 overflow-x-auto">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap ${
                filter === c ? 'bg-white shadow-sm font-medium' : 'text-zinc-600'
              }`}
            >
              {c === 'ALL' ? 'Alle' : CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="text-zinc-400">Lade…</div>
      ) : visible.length === 0 ? (
        <div className="card p-12 text-center text-zinc-500">
          Noch keine Rezepte.{' '}
          <Link to="/recipes/new" className="text-brand hover:underline">Erstes Rezept anlegen</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </div>
      )}
    </div>
  );
}
