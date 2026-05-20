/** Nährwerte sheet — pick or enter the seven per-100g values for one
 *  ingredient. Three paths in the same surface:
 *
 *    1. OFF candidates (auto-loaded on open) — pick one to fill.
 *    2. "KI-Schätzung anfordern" — falls back to local Ollama for
 *       ingredients OFF doesn't know about ("Tante Käthes …").
 *    3. "Manuell eintragen" — reveals a 7-field inline form prefilled
 *       with whatever's currently on the ingredient.
 *
 *  Mobile (<768px) renders as a BottomSheet — full-width slide-up,
 *  same layout the notes filter / actions menu use. Desktop renders
 *  as a centered Modal. The list of OFF candidates scrolls; the
 *  action footer (KI / Manuell) stays pinned so it's always reachable.
 *
 *  Empty state copy is split:
 *    - `unavailable` (lookup off OR network failure) →
 *      "OFF aktuell nicht erreichbar — KI oder manuell verwenden"
 *    - `!unavailable && results.length === 0` →
 *      "Nichts gefunden. KI-Schätzung anfordern oder manuell …"
 *
 *  onApply receives the seven values + the source enum + the OFF
 *  product code (only set for source='off'). Parent decides whether
 *  to persist immediately or stage the change. */
import { useEffect, useState } from 'react';
import { Apple, Loader2, Sparkles, X } from 'lucide-react';
import { RecipesApi } from '@/api/endpoints';
import { BottomSheet } from '@/components/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type {
  NutritionSearchHit,
  NutritionSource,
  NutritionValues,
} from '@/types';

export interface NutritionPick {
  values: NutritionValues;
  source: NutritionSource;
  off_product_code: string | null;
  /** Brand we surface in the next badge tooltip — only set for OFF picks. */
  off_brand: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Ingredient name to search by. Empty string disables auto-search
   *  (user must type a name first; rare edge — handled by the parent). */
  ingredientName: string;
  /** Current values, used as the manual-form starting point and to
   *  decide which view to show first if the user re-opens after
   *  filling. Pass empty/nulled values for a fresh ingredient. */
  current: NutritionValues;
  onApply: (pick: NutritionPick) => void;
}

type View = 'pick' | 'estimate' | 'manual';

const EMPTY_VALUES: NutritionValues = {
  calories_per_100g: null,
  protein_per_100g: null,
  carbs_per_100g: null,
  fat_per_100g: null,
  fiber_per_100g: null,
  sugar_per_100g: null,
  salt_per_100g: null,
};

const MANUAL_FIELDS: ReadonlyArray<readonly [keyof NutritionValues, string]> = [
  ['calories_per_100g', 'Kalorien (kcal / 100 g)'],
  ['protein_per_100g', 'Eiweiß (g / 100 g)'],
  ['carbs_per_100g', 'Kohlenhydrate (g / 100 g)'],
  ['fat_per_100g', 'Fett (g / 100 g)'],
  ['fiber_per_100g', 'Ballaststoffe (g / 100 g)'],
  ['sugar_per_100g', 'Zucker (g / 100 g)'],
  ['salt_per_100g', 'Salz (g / 100 g)'],
];

function formatSummary(values: NutritionValues): string {
  const parts: string[] = [];
  if (values.calories_per_100g != null) {
    parts.push(`${Math.round(values.calories_per_100g)} kcal`);
  }
  if (values.protein_per_100g != null) {
    parts.push(`${values.protein_per_100g} g Eiweiß`);
  }
  if (values.fat_per_100g != null) {
    parts.push(`${values.fat_per_100g} g Fett`);
  }
  if (values.carbs_per_100g != null) {
    parts.push(`${values.carbs_per_100g} g KH`);
  }
  return parts.join(' · ');
}

export function NutritionSheet({
  open,
  onClose,
  ingredientName,
  current,
  onApply,
}: Props) {
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const [view, setView] = useState<View>('pick');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<NutritionSearchHit[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<{
    values: NutritionValues;
    note: string | null;
  } | null>(null);

  const [manual, setManual] = useState<NutritionValues>(EMPTY_VALUES);

  // Reset + auto-search whenever the sheet opens for a fresh ingredient.
  useEffect(() => {
    if (!open) return;
    setView('pick');
    setResults([]);
    setUnavailable(false);
    setEstimate(null);
    setManual({ ...current });
    if (!ingredientName.trim()) return;
    setSearching(true);
    let cancelled = false;
    void (async () => {
      try {
        const resp = await RecipesApi.searchNutrition(ingredientName.trim());
        if (cancelled) return;
        setResults(resp.results);
        setUnavailable(resp.unavailable);
      } catch {
        if (!cancelled) setUnavailable(true);
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ingredientName, current]);

  const requestEstimate = async () => {
    setView('estimate');
    setEstimating(true);
    setEstimate(null);
    try {
      const resp = await RecipesApi.estimateNutrition(ingredientName.trim());
      setEstimate({ values: resp.nutrition, note: resp.note });
    } catch {
      setEstimate({
        values: EMPTY_VALUES,
        note: 'KI-Schätzung gerade nicht erreichbar.',
      });
    } finally {
      setEstimating(false);
    }
  };

  const applyOff = (hit: NutritionSearchHit) => {
    onApply({
      values: hit.nutrition,
      source: 'off',
      off_product_code: hit.code,
      off_brand: hit.brand,
    });
    onClose();
  };

  const applyEstimate = () => {
    if (!estimate) return;
    onApply({
      values: estimate.values,
      source: 'ai',
      off_product_code: null,
      off_brand: null,
    });
    onClose();
  };

  const applyManual = () => {
    onApply({
      values: manual,
      source: 'manual',
      off_product_code: null,
      off_brand: null,
    });
    onClose();
  };

  const setManualField = (key: keyof NutritionValues, raw: string) =>
    setManual((cur) => ({
      ...cur,
      [key]: raw === '' ? null : Number(raw),
    }));

  // ---------- Body ----------

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold leading-tight">
          Nährwerte für{' '}
          <span className="text-brand-700">„{ingredientName || '…'}"</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="size-8 inline-flex items-center justify-center rounded-ctl text-muted hover:text-ink hover:bg-page transition"
          aria-label="Schließen"
        >
          <X size={18} />
        </button>
      </div>

      {view === 'pick' && (
        <>
          <div className="text-xs uppercase tracking-wider text-muted flex items-center gap-1">
            🌍 Aus Open Food Facts
          </div>

          {searching ? (
            <div className="flex items-center gap-2 text-sm text-muted py-4">
              <Loader2 size={16} className="animate-spin" />
              Suche bei Open Food Facts …
            </div>
          ) : unavailable ? (
            <p className="text-sm text-muted py-2">
              OFF aktuell nicht erreichbar — versuche eine KI-Schätzung
              oder gib die Werte manuell ein.
            </p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted py-2">
              Nichts gefunden. KI-Schätzung anfordern oder manuell
              eintragen.
            </p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {results.map((hit) => (
                <li
                  key={hit.code}
                  className="card p-3 flex items-start gap-3 border border-muted/15"
                >
                  {hit.image_url ? (
                    <img
                      src={hit.image_url}
                      alt=""
                      className="size-12 rounded-ctl object-cover bg-page shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="size-12 rounded-ctl bg-page shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{hit.name}</div>
                    {hit.brand && (
                      <div className="text-xs text-muted truncate">
                        {hit.brand}
                      </div>
                    )}
                    <div className="text-xs text-muted mt-0.5">
                      {formatSummary(hit.nutrition) || 'Keine Nährwerte'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyOff(hit)}
                    className="btn-secondary text-xs py-1 px-2 shrink-0 self-center"
                  >
                    Übernehmen
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 pt-3 border-t border-muted/15 flex flex-col gap-2">
            <p className="text-xs text-muted">Nichts dabei?</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={requestEstimate}
                disabled={!ingredientName.trim()}
                className="btn-secondary text-sm inline-flex items-center gap-1.5"
              >
                <Sparkles size={14} /> KI-Schätzung anfordern
              </button>
              <button
                type="button"
                onClick={() => setView('manual')}
                className="btn-secondary text-sm inline-flex items-center gap-1.5"
              >
                <Apple size={14} /> Manuell eintragen
              </button>
            </div>
          </div>
        </>
      )}

      {view === 'estimate' && (
        <>
          <div className="text-xs uppercase tracking-wider text-muted">
            🤖 KI-Schätzung
          </div>
          {estimating ? (
            <div className="flex items-center gap-2 text-sm text-muted py-4">
              <Loader2 size={16} className="animate-spin" />
              KI denkt nach …
            </div>
          ) : estimate ? (
            <div className="card p-3 border border-muted/15 space-y-1">
              <div className="text-sm">{formatSummary(estimate.values) || '—'}</div>
              {estimate.note && (
                <div className="text-xs italic text-muted">{estimate.note}</div>
              )}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-3 border-t border-muted/15">
            <button
              type="button"
              onClick={() => setView('pick')}
              className="btn-ghost text-sm"
            >
              Zurück
            </button>
            <button
              type="button"
              onClick={applyEstimate}
              disabled={
                !estimate ||
                Object.values(estimate.values).every((v) => v == null)
              }
              className="btn-primary text-sm"
            >
              Übernehmen
            </button>
          </div>
        </>
      )}

      {view === 'manual' && (
        <>
          <div className="text-xs uppercase tracking-wider text-muted">
            ✏️ Manuell eintragen (pro 100 g)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MANUAL_FIELDS.map(([key, label]) => (
              <label key={key} className="text-xs text-muted">
                <span className="block mb-0.5">{label}</span>
                <input
                  className="input py-1.5 text-sm w-full"
                  inputMode="decimal"
                  value={manual[key] ?? ''}
                  onChange={(e) => setManualField(key, e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-muted/15">
            <button
              type="button"
              onClick={() => setView('pick')}
              className="btn-ghost text-sm"
            >
              Zurück
            </button>
            <button
              type="button"
              onClick={applyManual}
              className="btn-primary text-sm"
            >
              Speichern
            </button>
          </div>
        </>
      )}
    </div>
  );

  if (!open) return null;

  if (isMobile) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        ariaLabel="Nährwerte"
        maxHeightClass="max-h-[85vh]"
      >
        <div className="p-4">{body}</div>
      </BottomSheet>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Nährwerte"
    >
      <div
        className="w-full max-w-md card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  );
}
