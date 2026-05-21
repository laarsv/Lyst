import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftRight, ChefHat, Copy, Loader2, LogOut, Pencil, RefreshCw, Share2, ShoppingCart, Sparkles, Trash2, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SharedChip } from '@/components/SharedChip';
import { Modal } from '@/components/Modal';
import { ShareRecipePanel } from '@/components/recipes/ShareRecipePanel';
import { NutritionBadge } from '@/components/recipes/NutritionBadge';
import { RecipesApi } from '@/api/endpoints';
import type { ImportedRecipe, Recipe } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { CopyToListModal } from '@/components/recipes/CopyToListModal';
import { CookMode } from '@/components/recipes/CookMode';
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

  if (loading || !recipe) return <div className="text-muted/70">Lade…</div>;

  const totalTime = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);

  return (
    <div className="space-y-6">
      <BackLink to="/recipes" label="zu Rezepten" />
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

      <NutritionCard recipe={recipe} onChanged={fetchRecipe} />

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

function NutritionCard({
  recipe,
  onChanged,
}: {
  recipe: Recipe;
  onChanged: () => void;
}) {
  // v1.5 aggregate carries per-serving, total, and coverage in one
  // block. The toggle below switches the rendered numbers without a
  // re-fetch — same data, two views.
  const n = recipe.nutrition;
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<'per_serving' | 'total'>('per_serving');

  // If no ingredient contributed AT ALL (no data OR no convertible
  // unit), show an actionable empty hint instead of hiding. The link
  // jumps to edit mode where the user can fill quantities/units.
  if (n.coverage.counted === 0) {
    return (
      <section className="card p-4 text-sm text-muted flex items-start gap-3">
        <div className="flex-1">
          <p>
            Nährwerte noch nicht verfügbar — Zutaten mit Nährwerten und
            Mengenangaben ergänzen, damit Lyst die Werte pro Portion
            berechnen kann.
          </p>
        </div>
        <Link
          to={`/recipes/${recipe.id}/edit`}
          className="btn-secondary text-xs whitespace-nowrap"
        >
          Zutaten bearbeiten
        </Link>
      </section>
    );
  }

  const values = mode === 'per_serving' ? n.per_serving : n.total;
  const cells: { label: string; value: number | null; unit: string }[] = [
    { label: 'Kalorien', value: values.calories, unit: 'kcal' },
    { label: 'Eiweiß', value: values.protein, unit: 'g' },
    { label: 'Kohlenhydrate', value: values.carbs, unit: 'g' },
    { label: 'Fett', value: values.fat, unit: 'g' },
    { label: 'Ballaststoffe', value: values.fiber, unit: 'g' },
    { label: 'Zucker', value: values.sugar, unit: 'g' },
    { label: 'Salz', value: values.salt, unit: 'g' },
  ];

  /** Re-pull nutrition values for every ingredient that has a stored
   *  USDA / OFF source, *or* has no source yet but a name we can
   *  search by. We deliberately don't override 'ai'/'manual' rows —
   *  the user owns those choices. The grouped search response gives
   *  us USDA first, OFF as fallback — we take the first hit of the
   *  first group so the raw-ingredient match wins over a branded
   *  product when both exist. PATCH happens one ingredient at a
   *  time; the per-upstream rate gates on the backend serialise
   *  outgoing calls so client-side concurrency is fine. */
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
          // Defensive: a stale service-worker payload from v1.3 may
          // still surface here with `{results: [...]}` and no
          // `groups` — coerce both shapes into one local list.
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
          // single-ingredient failures don't abort the whole pass —
          // the rest of the recipe may still pick up fresh values.
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

  // "~" prefix per cell + "(geschätzt)" suffix on the heading when any
  // contributing ingredient is AI-sourced. Keeping both signals makes
  // the uncertainty obvious whether the user scans the heading first
  // or the numbers first.
  const prefix = n.is_estimate ? '~ ' : '';
  const headingLabel =
    mode === 'per_serving'
      ? `Nährwerte pro Portion${n.is_estimate ? ' (geschätzt)' : ''}`
      : `Nährwerte gesamtes Rezept${n.is_estimate ? ' (geschätzt)' : ''}`;
  const partial = n.coverage.counted < n.coverage.total;

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold">{headingLabel}</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setMode((m) => (m === 'per_serving' ? 'total' : 'per_serving'))
            }
            className="text-xs text-muted hover:text-brand-700 inline-flex items-center gap-1 px-2 py-1 rounded-ctl hover:bg-page transition"
            title={
              mode === 'per_serving'
                ? 'Gesamtes Rezept anzeigen'
                : 'Pro Portion anzeigen'
            }
            aria-label="Pro Portion / gesamt umschalten"
          >
            <ArrowLeftRight size={12} aria-hidden />
            {mode === 'per_serving' ? 'Gesamt anzeigen' : 'Pro Portion'}
          </button>
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            title="Werte aus USDA / Open Food Facts neu abrufen"
            className="size-7 inline-flex items-center justify-center rounded-ctl text-muted hover:text-brand-700 hover:bg-page transition disabled:opacity-50"
            aria-label="Werte aktualisieren"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded-card border border-line p-3">
            <div className="text-xs text-muted">{c.label}</div>
            <div className="text-lg font-semibold tabular-nums">
              {c.value != null ? `${prefix}${c.value}` : '—'}
              <span className="text-xs font-normal text-muted ml-1">{c.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-3">
        {mode === 'per_serving' ? (
          <>
            Pro Portion ({n.servings} Portion{n.servings === 1 ? '' : 'en'})
          </>
        ) : (
          <>Gesamtes Rezept ({n.servings} Portion{n.servings === 1 ? '' : 'en'})</>
        )}
        {partial && (
          <>
            {' · '}
            Basiert auf {n.coverage.counted} von {n.coverage.total} Zutaten —{' '}
            <Link
              to={`/recipes/${recipe.id}/edit`}
              className="underline hover:text-brand-700"
            >
              ergänzen
            </Link>
          </>
        )}
      </p>
    </section>
  );
}

/** Feature 3: Recipe variation modal.
 *
 *  Two-phase: pick a preset (or type a custom request) → spinner → preview
 *  with "Als neues Rezept speichern". Saving routes to RecipeEdit's create
 *  form with the variation pre-filled via location state — same channel the
 *  URL/photo importer already uses, so the user can tweak before persisting. */
function RecipeVariationModal({
  open,
  onClose,
  recipe,
}: {
  open: boolean;
  onClose: () => void;
  recipe: Recipe;
}) {
  const [request, setRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const [variant, setVariant] = useState<ImportedRecipe | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) {
      setRequest('');
      setVariant(null);
      setLoading(false);
    }
  }, [open]);

  const run = async (text: string) => {
    setLoading(true);
    setVariant(null);
    try {
      const v = await RecipesApi.aiVariation(recipe.id, text);
      setVariant(v);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const PRESETS = [
    'Vegetarisch machen',
    'Für mehr Personen',
    'Kalorienärmer',
    'Schneller / einfacher',
  ];

  const saveAsNew = () => {
    if (!variant) return;
    onClose();
    // RecipeEdit reads `prefill` from location.state — the same channel
    // ImportRecipeModal uses for URL/photo imports.
    nav('/recipes/new', { state: { prefill: variant } });
  };

  return (
    <Modal open={open} onClose={onClose} title="Variante (KI)" className="max-w-lg">
      <div className="space-y-3">
        {!variant && !loading && (
          <>
            <p className="text-sm text-muted">
              Wähle eine Vorlage oder beschreibe deine eigene Variante.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => run(p)}
                  className="text-sm text-left px-3 py-2 rounded-ctl border border-line hover:bg-page transition"
                >
                  {p}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (request.trim()) void run(request.trim());
              }}
              className="space-y-2 pt-1"
            >
              <textarea
                className="input min-h-[64px] text-sm"
                placeholder="Eigene Variante beschreiben…"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="btn-primary inline-flex items-center gap-2"
                  disabled={!request.trim()}
                >
                  <Sparkles size={14} /> Variante erzeugen
                </button>
              </div>
            </form>
          </>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted py-4">
            <Loader2 size={16} className="animate-spin" />
            <span>KI denkt nach…</span>
          </div>
        )}

        {variant && (
          <>
            <div className="rounded-ctl border border-line p-3 max-h-72 overflow-auto">
              <div className="font-semibold">{variant.title}</div>
              {variant.description && (
                <p className="text-sm text-muted mt-1">{variant.description}</p>
              )}
              <div className="text-xs text-muted mt-2">
                {variant.servings ?? '?'} Portionen · {variant.ingredients.length} Zutaten
                · {variant.steps.length} Schritte
              </div>
              <div className="mt-3">
                <div className="text-[11px] uppercase tracking-wider text-muted mb-1">Zutaten</div>
                <ul className="text-sm space-y-0.5">
                  {variant.ingredients.slice(0, 12).map((i, idx) => (
                    <li key={idx}>
                      • {i.name}
                      {i.quantity !== null && (
                        <span className="text-muted">
                          {' · '}
                          {i.quantity} {i.unit ?? ''}
                        </span>
                      )}
                    </li>
                  ))}
                  {variant.ingredients.length > 12 && (
                    <li className="text-muted text-xs">… und {variant.ingredients.length - 12} weitere</li>
                  )}
                </ul>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Verwerfen
              </button>
              <button type="button" className="btn-primary" onClick={saveAsNew}>
                Als neues Rezept speichern
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

