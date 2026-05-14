import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import { RecipesApi } from '@/api/endpoints';
import type { RecipeSummary } from '@/types';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { ImportRecipeModal } from '@/components/recipes/ImportRecipeModal';
import { SuggestRecipesModal } from '@/components/recipes/SuggestRecipesModal';
import { ShareRecipeBookPanel } from '@/components/recipes/ShareRecipeBookPanel';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { MEAL_TYPE_TAGS } from '@/data/recipeTags';

/** Filter state — kept as a plain string so the chip bar can show
 *  user-defined tags too. 'ALL' is the sentinel for "no tag filter". */
type Filter = 'ALL' | string;

export function RecipesPage() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [importOpen, setImportOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [bookShareOpen, setBookShareOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await RecipesApi.list({
        q: q || undefined,
        tag: filter === 'ALL' ? undefined : filter,
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

  // Filter chips: meal-type tags first (matching the old fixed enum's UX),
  // then any other tags actually in use across the user's recipes —
  // deduped and sorted by frequency. We compute this from the FULL recipe
  // list (not the filtered one) so the bar stays stable as the user clicks.
  const allRecipes = useMemo(() => recipes, [recipes]);
  const filterChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of allRecipes) {
      for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    // Meal-type tags lead the list, even when not currently in use — gives
    // the user a stable starting set to filter by.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const t of MEAL_TYPE_TAGS) {
      if (counts.has(t) || filter === t) {
        ordered.push(t);
        seen.add(t);
      }
    }
    // Then anything else, sorted by usage descending then alpha.
    const others = [...counts.entries()]
      .filter(([t]) => !seen.has(t))
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([t]) => t);
    return [...ordered, ...others];
  }, [allRecipes, filter]);

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
        <div className="flex gap-2 flex-wrap items-center">
          <button
            type="button"
            onClick={() => setBookShareOpen(true)}
            title="Rezeptbuch teilen"
            aria-label="Rezeptbuch teilen"
            className="size-10 inline-flex items-center justify-center rounded-ctl border border-line text-muted hover:text-brand-700 hover:bg-page transition"
          >
            <Share2 size={18} />
          </button>
          <button className="btn-secondary" onClick={() => setSuggestOpen(true)}>
            Was kann ich kochen?
          </button>
          <button className="btn-secondary" onClick={() => setImportOpen(true)}>
            Importieren
          </button>
          <Link to="/recipes/new" className="btn-primary">+ Neues Rezept</Link>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Rezept oder Tag suchen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        {/* Tag filter chip bar — visually identical to the old fixed-
            category bar but now driven entirely by the recipes' own tags. */}
        <div className="flex gap-1 bg-surface border border-line rounded-xl p-1 overflow-x-auto">
          <button
            onClick={() => setFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap ${
              filter === 'ALL' ? 'bg-surface shadow-sm font-medium' : 'text-muted'
            }`}
          >
            Alle
          </button>
          {filterChips.map((tag) => (
            <button
              key={tag}
              onClick={() => setFilter(tag)}
              className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap ${
                filter === tag ? 'bg-surface shadow-sm font-medium' : 'text-muted'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="text-muted/70">Lade…</div>
      ) : visible.length === 0 ? (
        <div className="card p-12 text-center text-muted">
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
      <ImportRecipeModal open={importOpen} onClose={() => setImportOpen(false)} />
      <SuggestRecipesModal open={suggestOpen} onClose={() => setSuggestOpen(false)} />
      <ShareRecipeBookPanel open={bookShareOpen} onClose={() => setBookShareOpen(false)} />
    </div>
  );
}
