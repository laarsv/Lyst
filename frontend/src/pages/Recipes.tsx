import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Heart, Plus, Share2, ShoppingCart, Sparkles } from 'lucide-react';
import { RecipesApi } from '@/api/endpoints';
import type { RecipeSummary } from '@/types';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { ImportRecipeModal } from '@/components/recipes/ImportRecipeModal';
import { SuggestRecipesModal } from '@/components/recipes/SuggestRecipesModal';
import { ShareRecipeBookPanel } from '@/components/recipes/ShareRecipeBookPanel';
import { MergeToListModal } from '@/components/recipes/MergeToListModal';
import { IconAction } from '@/components/IconAction';
import { useOverviewQuery } from '@/hooks/useOverviewQuery';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { MEAL_TYPE_TAGS } from '@/data/recipeTags';

/** Filter state — kept as a plain string so the chip bar can show
 *  user-defined tags too. 'ALL' is the sentinel for "no tag filter".
 *  'SHARED' is a client-side filter that only shows recipes someone
 *  else shared with the current user (share_source != null). */
type Filter = 'ALL' | 'SHARED' | 'FAVORITES' | string;

/** Client-side sort over the loaded summaries (the payload already carries
 *  rating / is_favorite / cooked_count / last_cooked_at). 'recent' mirrors
 *  the server's default updated_at-desc order. */
type SortKey = 'recent' | 'alpha' | 'rating' | 'favorites' | 'cooked' | 'frequency';

export function RecipesPage() {
  const nav = useNavigate();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<SortKey>('recent');
  const [importOpen, setImportOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [bookShareOpen, setBookShareOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // 'SHARED' is a client-side narrowing — fetch the full set, then
      // filter below. Tag filters go to the server.
      const r = await RecipesApi.list({
        q: q || undefined,
        tag:
          filter === 'ALL' ||
          filter === 'SHARED' ||
          filter === 'FAVORITES' ||
          filter === 'ORIGINALS' ||
          filter === 'AI_ONLY' ||
          filter === 'DIRECT_ONLY'
            ? undefined
            : filter,
      });
      setRecipes(r);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  // Network-first: refetches on mount, on focus, on filter change, and
  // whenever invalidateOverview('recipes') fires from a detail-page
  // mutation (delete, duplicate, leave-share, edit save).
  useOverviewQuery(`recipes:${filter}`, () => load());

  // True iff at least one recipe in the loaded set was shared with the
  // current user — drives whether the "Mit mir geteilt" chip even renders.
  const hasSharedRecipes = useMemo(
    () => recipes.some((r) => r.share_source !== null),
    [recipes],
  );
  const hasFavorites = useMemo(() => recipes.some((r) => r.is_favorite), [recipes]);
  const hasVariants = useMemo(() => recipes.some((r) => r.source === 'ai_variant'), [recipes]);
  const hasAi = useMemo(
    () => recipes.some((r) => r.origin === 'ai_variant' || r.origin === 'ai_import'),
    [recipes],
  );
  const hasDirect = useMemo(() => recipes.some((r) => r.origin === 'structured_import'), [recipes]);

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
    let rows = recipes;
    if (filter === 'SHARED') rows = rows.filter((r) => r.share_source !== null);
    if (filter === 'FAVORITES') rows = rows.filter((r) => r.is_favorite);
    if (filter === 'ORIGINALS') rows = rows.filter((r) => r.source !== 'ai_variant');
    if (filter === 'AI_ONLY')
      rows = rows.filter((r) => r.origin === 'ai_variant' || r.origin === 'ai_import');
    if (filter === 'DIRECT_ONLY') rows = rows.filter((r) => r.origin === 'structured_import');
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(needle) ||
          r.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }
    const recent = (a: RecipeSummary, b: RecipeSummary) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    const cookedAt = (r: RecipeSummary) =>
      r.last_cooked_at ? new Date(r.last_cooked_at).getTime() : -Infinity;
    const sorted = [...rows];
    switch (sort) {
      case 'alpha':
        sorted.sort((a, b) => a.title.localeCompare(b.title, 'de'));
        break;
      case 'rating':
        sorted.sort((a, b) => b.rating - a.rating || recent(a, b));
        break;
      case 'favorites':
        sorted.sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite) || recent(a, b));
        break;
      case 'cooked':
        sorted.sort((a, b) => cookedAt(b) - cookedAt(a) || recent(a, b));
        break;
      case 'frequency':
        sorted.sort((a, b) => b.cooked_count - a.cooked_count || recent(a, b));
        break;
      case 'recent':
      default:
        sorted.sort(recent);
    }
    return sorted;
  }, [recipes, q, filter, sort]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Rezepte</h1>
        <div className="flex flex-wrap gap-1.5 items-center">
          <IconAction
            label="Einkaufsliste aus Rezepten"
            icon={ShoppingCart}
            onClick={() => setMergeOpen(true)}
          />
          <IconAction
            label="Rezeptbuch teilen"
            icon={Share2}
            onClick={() => setBookShareOpen(true)}
          />
          <IconAction
            label="Was kann ich kochen? (KI)"
            icon={Sparkles}
            onClick={() => setSuggestOpen(true)}
          />
          <IconAction
            label="Importieren"
            icon={Download}
            onClick={() => setImportOpen(true)}
          />
          <IconAction
            label="Neues Rezept"
            icon={Plus}
            onClick={() => nav('/recipes/new')}
            variant="primary"
          />
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
        <select
          className="input w-auto"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sortierung"
        >
          <option value="recent">Neueste</option>
          <option value="alpha">A–Z</option>
          <option value="rating">Bewertung</option>
          <option value="favorites">Favoriten zuerst</option>
          <option value="cooked">Zuletzt gekocht</option>
          <option value="frequency">Häufigkeit</option>
        </select>
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
          {hasSharedRecipes && (
            <button
              onClick={() => setFilter('SHARED')}
              className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap ${
                filter === 'SHARED'
                  ? 'bg-surface shadow-sm font-medium text-brand-700'
                  : 'text-muted'
              }`}
            >
              Mit mir geteilt
            </button>
          )}
          {(hasFavorites || filter === 'FAVORITES') && (
            <button
              onClick={() => setFilter('FAVORITES')}
              className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap inline-flex items-center gap-1 ${
                filter === 'FAVORITES'
                  ? 'bg-surface shadow-sm font-medium text-danger'
                  : 'text-muted'
              }`}
            >
              <Heart size={13} className={filter === 'FAVORITES' ? 'fill-danger' : ''} />
              Favoriten
            </button>
          )}
          {(hasVariants || filter === 'ORIGINALS') && (
            <button
              onClick={() => setFilter('ORIGINALS')}
              className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap ${
                filter === 'ORIGINALS' ? 'bg-surface shadow-sm font-medium' : 'text-muted'
              }`}
            >
              Nur Originale
            </button>
          )}
          {(hasAi || filter === 'AI_ONLY') && (
            <button
              onClick={() => setFilter('AI_ONLY')}
              className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap ${
                filter === 'AI_ONLY' ? 'bg-surface shadow-sm font-medium' : 'text-muted'
              }`}
            >
              Nur KI
            </button>
          )}
          {(hasDirect || filter === 'DIRECT_ONLY') && (
            <button
              onClick={() => setFilter('DIRECT_ONLY')}
              className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap ${
                filter === 'DIRECT_ONLY' ? 'bg-surface shadow-sm font-medium' : 'text-muted'
              }`}
            >
              Nur Direktimport
            </button>
          )}
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
      <MergeToListModal open={mergeOpen} onClose={() => setMergeOpen(false)} />
    </div>
  );
}
