import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftRight, ChefHat, ChevronDown, Copy, Heart, Loader2, LogOut, Pencil, RefreshCw, Share2, ShoppingCart, Sparkles, Trash2, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BulkNutritionFill } from '@/components/recipes/BulkNutritionFill';
import { fmtDe } from '@/lib/format';
import { SharedChip } from '@/components/SharedChip';
import { Modal } from '@/components/Modal';
import { ShareRecipePanel } from '@/components/recipes/ShareRecipePanel';
import { NutritionBadge } from '@/components/recipes/NutritionBadge';
import { RecipesApi } from '@/api/endpoints';
import type { CookLog, Recipe, RecipeIngredient, VariantOut, VariantTarget } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { CopyToListModal } from '@/components/recipes/CopyToListModal';
import { CookMode } from '@/components/recipes/CookMode';
import { StarRating } from '@/components/recipes/StarRating';
import { IngredientSubstituteSheet } from '@/components/recipes/IngredientSubstituteSheet';
import { relativeDe } from '@/lib/relativeTime';
import { useConfirm } from '@/components/Dialogs';
import { BackLink } from '@/components/BackLink';
import { IconAction } from '@/components/IconAction';
import { invalidateOverview, useResourceQuery } from '@/hooks/useOverviewQuery';
import { fmtQty } from '@/lib/format';

export function RecipeDetailPage() {
  const { id } = useParams();
  const recipeId = Number(id);
  const nav = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [cookOpen, setCookOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copyOpen, setCopyOpen] = useState(false);
  const [variationOpen, setVariationOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CookLog[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [subIngredient, setSubIngredient] = useState<RecipeIngredient | null>(null);
  const [variants, setVariants] = useState<VariantOut[]>([]);
  const confirmDialog = useConfirm();

  const fetchRecipe = useCallback(async () => {
    try {
      setRecipe(await RecipesApi.get(recipeId));
    } catch (e) {
      toast.error(getApiError(e));
      nav('/recipes');
    } finally {
      setLoading(false);
    }
  }, [recipeId, nav]);

  // Network-first detail fetch — mount, focus return, cross-tab WS
  // invalidations. Replaces the bare useEffect that fetched once and
  // never reconciled against later remote changes; the page now
  // reflects edits made on other devices as soon as the user comes
  // back to the tab.
  useResourceQuery(`recipe:${recipeId}`, fetchRecipe);

  // Child variants for the "Varianten" section (lazy, independent of the
  // recipe fetch). Reloads when navigating between recipes.
  useEffect(() => {
    let cancelled = false;
    RecipesApi.listVariants(recipeId)
      .then((v) => !cancelled && setVariants(v))
      .catch(() => !cancelled && setVariants([]));
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  const remove = async () => {
    if (!recipe) return;
    if (
      !(await confirmDialog({
        title: `Rezept „${recipe.title}" löschen?`,
        message: 'Inklusive aller Zutaten und Schritte. Kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        variant: 'danger',
      }))
    )
      return;
    try {
      await RecipesApi.remove(recipe.id);
      // Drop the freshness mark so the recipes overview re-fetches on
      // mount instead of showing the just-deleted recipe.
      invalidateOverview('recipes');
      toast.success('Rezept gelöscht');
      nav('/recipes');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  /** Recipient-initiated leave. Individual shares drop just this recipe;
   *  book shares drop the WHOLE book (you can't carve a hole in someone
   *  else's book). The confirm text spells that out so the user doesn't
   *  expect a per-recipe-only effect. */
  const leaveShare = async () => {
    if (!recipe) return;
    const isBook = recipe.share_source === 'book';
    const ownerLabel = recipe.owner_name ?? 'der Person';
    if (
      !(await confirmDialog({
        title: isBook
          ? `Geteiltes Rezeptbuch von ${ownerLabel} verlassen?`
          : 'Diese Freigabe verlassen?',
        message: isBook
          ? `Alle Rezepte aus diesem Rezeptbuch verschwinden aus deiner Ansicht. ${ownerLabel} kann dir das Buch erneut freigeben.`
          : 'Das Rezept verschwindet aus deiner Ansicht. Der Besitzer kann es dir erneut freigeben.',
        confirmLabel: isBook ? 'Rezeptbuch verlassen' : 'Verlassen',
        variant: 'danger',
      }))
    )
      return;
    try {
      if (isBook) {
        await RecipesApi.leaveBookShare(recipe.owner_id);
      } else {
        await RecipesApi.leaveShare(recipe.id);
      }
      invalidateOverview('recipes');
      toast.success('Freigabe verlassen');
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

  // Rating / favorite — owner-set; optimistic with revert on failure so the
  // stars/heart feel instant. invalidateOverview keeps the card grid in sync.
  const patchRecipe = async (patch: { rating?: number; is_favorite?: boolean }) => {
    if (!recipe) return;
    const prev = recipe;
    setRecipe({ ...recipe, ...patch });
    try {
      const updated = await RecipesApi.update(recipe.id, patch);
      setRecipe(updated);
      invalidateOverview('recipes');
    } catch (e) {
      setRecipe(prev);
      toast.error(getApiError(e));
    }
  };

  const toggleHistory = async () => {
    if (!recipe) return;
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history === null) {
      setHistoryLoading(true);
      try {
        setHistory(await RecipesApi.cookLog(recipe.id));
      } catch {
        setHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  if (loading || !recipe) return <div className="text-muted/70">Lade…</div>;

  const totalTime = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <BackLink to="/recipes" label="zu Rezepten" />
        {recipe.parent_recipe_id && (
          <Link
            to={`/recipes/${recipe.parent_recipe_id}`}
            className="text-sm text-brand hover:underline"
          >
            ← Original-Rezept
          </Link>
        )}
      </div>
      <div className="card overflow-hidden">
        {recipe.image_url && (
          <div className="h-48 sm:h-64 bg-cover bg-center" style={{ backgroundImage: `url(${recipe.image_url})` }} />
        )}
        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold">{recipe.title}</h1>
                {/* Owner-side share badge — same icon/tooltip the
                    overview card uses, surfaced again on the detail
                    page so the owner can confirm at a glance who can
                    see this recipe. Recipient-side views (share_source
                    set) keep the existing "Geteilt von …" banner
                    below instead. */}
                {!recipe.share_source && (
                  <SharedChip state={recipe.share_state} />
                )}
              </div>
              {/* Rating + favorite — owner edits inline; recipients see the
                  owner's values read-only (hidden entirely when unrated). */}
              {!recipe.share_source ? (
                <div className="flex items-center gap-3 mt-2">
                  <StarRating value={recipe.rating} onChange={(r) => patchRecipe({ rating: r })} size={22} />
                  <button
                    type="button"
                    onClick={() => patchRecipe({ is_favorite: !recipe.is_favorite })}
                    aria-pressed={recipe.is_favorite}
                    title={recipe.is_favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
                    className="p-1 rounded-md hover:scale-110 transition-transform"
                  >
                    <Heart size={22} className={recipe.is_favorite ? 'fill-danger text-danger' : 'text-muted'} />
                  </button>
                </div>
              ) : (
                (recipe.rating > 0 || recipe.is_favorite) && (
                  <div className="flex items-center gap-2 mt-2">
                    {recipe.rating > 0 && <StarRating value={recipe.rating} size={18} />}
                    {recipe.is_favorite && <Heart size={16} className="fill-danger text-danger" />}
                  </div>
                )
              )}
              {recipe.share_source && recipe.owner_name && (
                <div className="text-xs text-brand-700 mt-1.5 inline-flex items-center gap-1">
                  <Users size={12} />
                  <span>
                    Geteilt von {recipe.owner_name}
                    {recipe.share_permission === 'EDIT'
                      ? ' · Bearbeitung erlaubt'
                      : ' · schreibgeschützt'}
                  </span>
                </div>
              )}
              {recipe.description && <p className="text-muted mt-2">{recipe.description}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted mt-3">
                <span>🍴 {recipe.servings} Pers.</span>
                {recipe.prep_time_minutes !== null && <span>Vorbereitung: {recipe.prep_time_minutes} Min</span>}
                {recipe.cook_time_minutes !== null && <span>Kochen: {recipe.cook_time_minutes} Min</span>}
                {totalTime > 0 && <span className="font-medium">Gesamt: {totalTime} Min</span>}
              </div>
              {recipe.cooked_count > 0 && (
                <div className="text-sm text-muted mt-2">
                  Zuletzt gekocht:{' '}
                  {recipe.last_cooked_at ? relativeDe(recipe.last_cooked_at) : '—'}
                  {' · '}
                  {recipe.cooked_count}× insgesamt
                  <button onClick={toggleHistory} className="ml-2 text-xs text-brand hover:underline">
                    {historyOpen ? 'Verlauf ausblenden' : 'Verlauf'}
                  </button>
                </div>
              )}
              {historyOpen && (
                <div className="mt-2 rounded-xl border border-line bg-page/50 p-3 text-sm max-w-md">
                  {historyLoading ? (
                    <div className="text-muted">Lade…</div>
                  ) : history && history.length > 0 ? (
                    <ul className="space-y-1.5">
                      {history.map((h) => (
                        <li key={h.id} className="flex gap-2">
                          <span className="text-muted tabular-nums shrink-0">
                            {new Date(h.cooked_at).toLocaleDateString('de-DE')}
                          </span>
                          {h.notes && <span className="text-ink">{h.notes}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-muted">Noch keine Einträge.</div>
                  )}
                </div>
              )}
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
              <NutritionCard recipe={recipe} onChanged={fetchRecipe} />
            </div>
            {/* Action row — icon-only. Three permission tiers:
                  - owner (no share_source): everything
                  - EDIT recipient: edit + variation + duplicate (no
                    re-share, no delete-resource); plus "Freigabe verlassen"
                  - VIEW recipient: only the read-friendly subset; plus
                    "Freigabe verlassen"
                Owner-only flags: Teilen, Löschen-des-ganzen-Rezepts. */}
            {(() => {
              const isRecipient = !!recipe.share_source;
              const canEdit = !isRecipient || recipe.share_permission === 'EDIT';
              return (
                <div className="flex flex-wrap gap-1.5">
                  <IconAction
                    label="Kochen starten"
                    icon={ChefHat}
                    onClick={() => setCookOpen(true)}
                    variant="primary"
                    disabled={recipe.steps.length === 0}
                  />
                  <IconAction
                    label="Zu Einkaufsliste hinzufügen"
                    icon={ShoppingCart}
                    onClick={() => setCopyOpen(true)}
                  />
                  {canEdit && (
                    <IconAction
                      label="Bearbeiten"
                      icon={Pencil}
                      onClick={() => nav(`/recipes/${recipe.id}/edit`)}
                    />
                  )}
                  <IconAction
                    label={isRecipient ? 'Eigene Kopie speichern' : 'Duplizieren'}
                    icon={Copy}
                    onClick={duplicate}
                  />
                  {canEdit && (
                    <IconAction
                      label="Variante (KI)"
                      icon={Sparkles}
                      onClick={() => setVariationOpen(true)}
                    />
                  )}
                  {!isRecipient && (
                    <>
                      <IconAction
                        label={recipe.share_enabled ? 'Teilen (aktiv)' : 'Teilen'}
                        icon={Share2}
                        onClick={() => setShareOpen(true)}
                        variant={recipe.share_enabled ? 'primary' : 'default'}
                      />
                      <IconAction
                        label="Löschen"
                        icon={Trash2}
                        onClick={remove}
                        variant="danger"
                      />
                    </>
                  )}
                  {isRecipient && (
                    <IconAction
                      label="Freigabe verlassen"
                      icon={LogOut}
                      onClick={leaveShare}
                      variant="danger"
                    />
                  )}
                </div>
              );
            })()}
            {!recipe.share_source && (
              <ShareRecipePanel
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                recipe={recipe}
                onUpdate={(patch) => setRecipe((cur) => (cur ? { ...cur, ...patch } : cur))}
              />
            )}
            <RecipeVariationModal
              open={variationOpen}
              onClose={() => setVariationOpen(false)}
              recipe={recipe}
            />
          </div>
        </div>
      </div>

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
                  <span className="text-sm flex-1">{ing.name}</span>
                  <NutritionBadge source={ing.nutrition_source} />
                  <button
                    type="button"
                    onClick={() => setSubIngredient(ing)}
                    className="text-muted hover:text-brand-700 shrink-0 self-center p-0.5"
                    title="Alternative finden"
                    aria-label={`Alternative für ${ing.name} finden`}
                  >
                    <ArrowLeftRight size={14} />
                  </button>
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

      {variants.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold mb-3">Varianten</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {variants.map((v) => (
              <Link
                key={v.id}
                to={`/recipes/${v.id}`}
                className="rounded-xl border border-line overflow-hidden hover:shadow-md transition"
              >
                <div
                  className="h-20 bg-cover bg-center bg-brand-50/40 flex items-center justify-center text-2xl"
                  style={v.image_url ? { backgroundImage: `url(${v.image_url})` } : undefined}
                >
                  {!v.image_url && '🍽️'}
                </div>
                <div className="p-2">
                  <div className="text-sm font-medium truncate">{v.title}</div>
                  {v.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {v.tags.slice(0, 2).map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-page text-muted">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <CopyToListModal open={copyOpen} recipe={recipe} onClose={() => setCopyOpen(false)} />
      {cookOpen && (
        <CookMode
          recipe={recipe}
          servings={recipe.servings}
          onClose={() => setCookOpen(false)}
          onCooked={(updated) => {
            setRecipe(updated);
            setHistory(null);
          }}
        />
      )}
      {subIngredient && (
        <IngredientSubstituteSheet
          open
          onClose={() => setSubIngredient(null)}
          recipeId={recipe.id}
          ingredient={subIngredient}
          description={recipe.description}
          canEdit={!recipe.share_source || recipe.share_permission === 'EDIT'}
          onChanged={fetchRecipe}
        />
      )}
    </div>
  );
}

/** Compact, metadata-weight nutrition info — sits below the meta row
 *  next to the tags. Same visual weight as "Vorbereitung: 15 Min".
 *
 *  Collapsed (default):  ≈ 260 kcal · 4,3 g Eiweiß · 13 g KH · 20 g Fett   pro Portion   ⌄
 *  Expanded:              full 7 macros + per-portion/total toggle + coverage line + refresh
 *
 *  Empty state (no ingredient contributed):
 *    A muted single-line hint with an edit link — no card, no border.
 *
 *  Expanded state is persisted to localStorage so a user who always
 *  wants the detail open keeps it that way across navigations.
 */
const NUTRITION_EXPANDED_KEY = 'lyst:nutrition-expanded';

function NutritionCard({
  recipe,
  onChanged,
}: {
  recipe: Recipe;
  onChanged: () => void;
}) {
  const n = recipe.nutrition;
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<'per_serving' | 'total'>('per_serving');
  // bulkOpen drives the inline "Nährwerte ergänzen" panel below the
  // coverage line — triggered when the user clicks "ergänzen". The
  // panel auto-starts the fill on mount and shows the result summary.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NUTRITION_EXPANDED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleExpanded = useCallback(() => {
    setExpanded((cur) => {
      const next = !cur;
      try {
        localStorage.setItem(NUTRITION_EXPANDED_KEY, next ? '1' : '0');
      } catch {
        // localStorage can be disabled (private mode, quota); just
        // skip persistence — the in-memory state still works.
      }
      return next;
    });
  }, []);

  // Empty state: no ingredient contributed AT ALL (no data OR no
  // convertible unit). A one-liner with an edit link, no card.
  if (n.coverage.counted === 0) {
    return (
      <p className="text-sm text-muted mt-3">
        Nährwerte noch nicht verfügbar —{' '}
        <Link
          to={`/recipes/${recipe.id}/edit`}
          className="underline hover:text-brand-700"
        >
          Zutaten ergänzen
        </Link>
        .
      </p>
    );
  }

  const values = mode === 'per_serving' ? n.per_serving : n.total;
  const mark = n.is_estimate ? '≈ ' : '';
  const partial = n.coverage.counted < n.coverage.total;

  /** Re-pull nutrition values for every ingredient that has a stored
   *  USDA / OFF source, *or* has no source yet but a name we can
   *  search by. Skips 'ai'/'manual' rows — those belong to the user. */
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      let touched = 0;
      for (const ing of recipe.ingredients) {
        if (ing.nutrition_source === 'ai' || ing.nutrition_source === 'manual') {
          continue;
        }
        if (!ing.name.trim()) continue;
        try {
          const resp = await RecipesApi.searchNutrition(ing.name.trim());
          const raw = resp as unknown as {
            groups?: Array<{
              source: 'usda' | 'off';
              results?: typeof resp.groups[number]['results'];
            }>;
            results?: typeof resp.groups[number]['results'];
          };
          const groupsList = Array.isArray(raw.groups)
            ? raw.groups
            : Array.isArray(raw.results) && raw.results.length > 0
              ? [{ source: 'off' as const, results: raw.results }]
              : [];
          const group = groupsList[0];
          const groupResults = Array.isArray(group?.results) ? group!.results : [];
          const hit = groupResults[0];
          if (!group || !hit) continue;
          await RecipesApi.updateIngredient(recipe.id, ing.id, {
            calories_per_100g: hit.nutrition.calories_per_100g,
            protein_per_100g: hit.nutrition.protein_per_100g,
            carbs_per_100g: hit.nutrition.carbs_per_100g,
            fat_per_100g: hit.nutrition.fat_per_100g,
            fiber_per_100g: hit.nutrition.fiber_per_100g,
            sugar_per_100g: hit.nutrition.sugar_per_100g,
            salt_per_100g: hit.nutrition.salt_per_100g,
            nutrition_source: group.source,
            off_product_code: group.source === 'off' ? hit.code : null,
            usda_fdc_id: group.source === 'usda' ? hit.fdc_id : null,
          });
          touched += 1;
        } catch {
          /* single-ingredient failure shouldn't abort the pass */
        }
      }
      if (touched > 0) {
        toast.success(`${touched} Zutat${touched === 1 ? '' : 'en'} aktualisiert`);
        onChanged();
      } else {
        toast.info('Keine neuen Treffer gefunden.');
      }
    } finally {
      setRefreshing(false);
    }
  };

  // ------- Collapsed line --------
  // Round to whole grams to keep it tidy; protein gets 1 decimal
  // because the difference between 4 and 4.3 g matters more there
  // than on a 12 → 13 g rounding for fat.
  const summary = (
    <>
      {mark}
      <span className="tabular-nums font-medium text-ink">
        {fmtDe(values.calories, 0)}
      </span>{' '}
      kcal
      <span className="text-muted/60"> · </span>
      <span className="tabular-nums">{fmtDe(values.protein, 1)}</span> g Eiweiß
      <span className="text-muted/60"> · </span>
      <span className="tabular-nums">{fmtDe(values.carbs, 0)}</span> g KH
      <span className="text-muted/60"> · </span>
      <span className="tabular-nums">{fmtDe(values.fat, 0)}</span> g Fett
    </>
  );

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={toggleExpanded}
        className="mt-3 inline-flex items-center gap-2 text-sm text-muted hover:text-ink transition group max-w-full text-left"
        aria-expanded="false"
      >
        <span className="truncate">
          {summary}
          <span className="ml-2 text-muted/70">
            {mode === 'per_serving' ? 'pro Portion' : 'gesamt'}
          </span>
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 text-muted/70 group-hover:text-ink transition-transform"
          aria-hidden
        />
      </button>
    );
  }

  // ------- Expanded view --------
  const rows: { label: string; value: number | null; unit: string; decimals: number }[] = [
    { label: 'Kalorien', value: values.calories, unit: 'kcal', decimals: 0 },
    { label: 'Eiweiß', value: values.protein, unit: 'g', decimals: 1 },
    { label: 'Kohlenhydrate', value: values.carbs, unit: 'g', decimals: 0 },
    { label: 'Fett', value: values.fat, unit: 'g', decimals: 0 },
    { label: 'Ballaststoffe', value: values.fiber, unit: 'g', decimals: 1 },
    { label: 'Zucker', value: values.sugar, unit: 'g', decimals: 0 },
    { label: 'Salz', value: values.salt, unit: 'g', decimals: 1 },
  ];

  return (
    <div className="mt-3 text-sm text-muted">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={toggleExpanded}
          className="inline-flex items-center gap-2 hover:text-ink transition"
          aria-expanded="true"
        >
          <span className="font-medium text-ink">
            Nährwerte{n.is_estimate ? ' (geschätzt)' : ''}
          </span>
          <ChevronDown
            size={14}
            className="text-muted/70 rotate-180 transition-transform"
            aria-hidden
          />
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setMode((m) => (m === 'per_serving' ? 'total' : 'per_serving'))
            }
            className="text-xs text-muted hover:text-ink inline-flex items-center gap-1 px-1.5 py-0.5 rounded-ctl hover:bg-page transition"
            title={
              mode === 'per_serving'
                ? 'Gesamtes Rezept anzeigen'
                : 'Pro Portion anzeigen'
            }
          >
            <ArrowLeftRight size={11} aria-hidden />
            {mode === 'per_serving' ? 'gesamt' : 'pro Portion'}
          </button>
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            title="Werte aus USDA / Open Food Facts neu abrufen"
            className="size-6 inline-flex items-center justify-center rounded-ctl text-muted hover:text-ink hover:bg-page transition disabled:opacity-50"
            aria-label="Werte aktualisieren"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      {/* Compact wrap-row grid — no tiles, no border. Just label+value
          pairs separated by a soft middot. */}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {rows.map((r) => (
          <span key={r.label} className="inline-flex items-baseline gap-1">
            <span className="text-muted">{r.label}</span>
            <span className="tabular-nums text-ink">
              {mark}
              {fmtDe(r.value, r.decimals)}
            </span>
            <span className="text-muted">{r.unit}</span>
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {mode === 'per_serving' ? (
          <>
            Pro Portion · {n.servings} Portion{n.servings === 1 ? '' : 'en'}
          </>
        ) : (
          <>Gesamtes Rezept · {n.servings} Portion{n.servings === 1 ? '' : 'en'}</>
        )}
        {partial && (
          <>
            {' · '}
            Basiert auf {n.coverage.counted} von {n.coverage.total} Zutaten —{' '}
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="underline hover:text-ink"
            >
              ergänzen
            </button>
          </>
        )}
      </p>
      {bulkOpen && (
        <div className="mt-2">
          <BulkNutritionFill
            recipeId={recipe.id}
            variant="compact"
            autoStart
            onComplete={onChanged}
          />
        </div>
      )}
    </div>
  );
}

/** Feature 3: Recipe variation modal.
 *
 *  Two-phase: pick a preset (or type a custom request) → spinner → preview
 *  with "Als neues Rezept speichern". Saving routes to RecipeEdit's create
 *  form with the variation pre-filled via location state — same channel the
 *  URL/photo importer already uses, so the user can tweak before persisting. */
const VARIANT_TARGETS: { value: VariantTarget; label: string }[] = [
  { value: 'vegan', label: 'Vegan' },
  { value: 'glutenfrei', label: 'Glutenfrei' },
  { value: 'laktosefrei', label: 'Laktosefrei' },
  { value: 'nussfrei', label: 'Nussfrei' },
  { value: 'light', label: 'Light' },
  { value: 'schnell', label: 'Schnell (<30 min)' },
];

function RecipeVariationModal({
  open,
  onClose,
  recipe,
}: {
  open: boolean;
  onClose: () => void;
  recipe: Recipe;
}) {
  const [targets, setTargets] = useState<Set<VariantTarget>>(new Set());
  const [adjustment, setAdjustment] = useState('');
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) {
      setTargets(new Set());
      setAdjustment('');
      setLoading(false);
    }
  }, [open]);

  const toggle = (t: VariantTarget) =>
    setTargets((cur) => {
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const canRun = targets.size > 0 || adjustment.trim().length > 0;

  const run = async () => {
    if (!canRun) {
      toast.error('Mindestens ein Ziel oder eine Beschreibung wählen');
      return;
    }
    setLoading(true);
    try {
      // Saves + links the variant; navigate to it for review/edit.
      const v = await RecipesApi.createVariant(recipe.id, {
        targets: Array.from(targets),
        adjustment: adjustment.trim() || null,
      });
      toast.success('Variante erstellt');
      onClose();
      nav(`/recipes/${v.id}`);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Variante erstellen" className="max-w-lg">
      <div className="space-y-4">
        <div>
          <div className="label">Ziel (mehrere möglich)</div>
          <div className="flex flex-wrap gap-1.5">
            {VARIANT_TARGETS.map((t) => {
              const on = targets.has(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => toggle(t.value)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition ${
                    on
                      ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium'
                      : 'border-line text-muted hover:bg-page'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="label">Sonst noch was? (optional)</label>
          <textarea
            className="input min-h-[64px] text-sm"
            placeholder="z. B. halbiere die Kalorien · schärfer machen · fürs Kind ohne Pilze"
            value={adjustment}
            onChange={(e) => setAdjustment(e.target.value)}
          />
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted py-2">
            <Loader2 size={16} className="animate-spin" />
            <span>KI erstellt die Variante…</span>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Abbrechen
            </button>
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              disabled={!canRun}
              onClick={run}
            >
              <Sparkles size={14} /> Variante erzeugen
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

