/** Bulk nutrition lookup — fills nutrition for every (or only the
 *  empty) ingredient of a recipe in one round-trip.
 *
 *  Used in two surfaces:
 *    - RecipeEdit: a "Nährwerte für alle holen" button near the
 *      ingredients section header. Renders inline result summary.
 *    - RecipeDetail: the coverage-line "ergänzen" link expands into
 *      the same component (compact variant) — single click runs
 *      mode='fill_empty', refreshes the recipe.
 *
 *  Two-button result panel:
 *    - "KI-Schätzung für die fehlenden" — re-runs only the not_found
 *      ingredient ids with use_ai_fallback=true. AI is always opt-in.
 *    - "Schließen" — clears the panel; ingredient list / nutrition
 *      summary update via the parent's onComplete() callback.
 *
 *  A "refill_all" path lives behind a confirm dialog — the trigger
 *  variant prop renders an extra button only on the edit page.
 */
import { useState } from 'react';
import { AlertCircle, Database, Loader2, Sparkles } from 'lucide-react';
import { RecipesApi } from '@/api/endpoints';
import { useConfirm } from '@/components/Dialogs';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import type { NutritionFillAllResponse } from '@/types';

interface Props {
  recipeId: number;
  /** 'full' shows both fill-empty and refill-all triggers + summary
   *  panel (edit page). 'compact' shows only a small trigger + the
   *  summary (detail-page coverage line). */
  variant?: 'full' | 'compact';
  /** Called after a successful run — the parent re-loads the recipe so
   *  ingredient rows and the nutrition card see the new values. */
  onComplete: () => void | Promise<void>;
  /** Pre-trigger flag from the parent — runs the empty fill exactly
   *  once on mount when truthy. Used by the detail page's coverage
   *  link, which navigates the user straight into the running panel. */
  autoStart?: boolean;
}

export function BulkNutritionFill({
  recipeId,
  variant = 'full',
  onComplete,
  autoStart = false,
}: Props) {
  const [running, setRunning] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [summary, setSummary] = useState<NutritionFillAllResponse | null>(null);
  const confirm = useConfirm();

  const runFill = async (
    mode: 'fill_empty' | 'refill_all',
    ingredient_ids?: number[],
    use_ai_fallback?: boolean,
  ) => {
    const isAiOnly = !!ingredient_ids && !!use_ai_fallback;
    if (isAiOnly) setAiRunning(true);
    else setRunning(true);
    try {
      const resp = await RecipesApi.fillAllNutrition(recipeId, {
        mode,
        ingredient_ids,
        use_ai_fallback,
      });
      // Merge into the existing summary when running the AI-for-misses
      // pass so the user sees the cumulative state.
      setSummary((prev) => {
        if (!prev) return resp;
        if (!isAiOnly) return resp;
        // Apply each fresh result on top of the previous list — same
        // ingredient_id wins.
        const merged = [...prev.results];
        for (const r of resp.results) {
          const i = merged.findIndex((x) => x.ingredient_id === r.ingredient_id);
          if (i >= 0) merged[i] = r;
          else merged.push(r);
        }
        return {
          ...prev,
          results: merged,
          filled: prev.filled + resp.filled,
          not_found: prev.not_found - resp.filled,
          deferred: prev.deferred,
          skipped: prev.skipped,
        };
      });
      if (resp.filled > 0) {
        toast.success(
          `${resp.filled} von ${resp.total} Zutaten befüllt`,
        );
        await onComplete();
      } else if (resp.deferred > 0) {
        toast.info(
          `${resp.deferred} Zutaten verzögert — in einer Minute erneut versuchen.`,
        );
      } else if (resp.not_found > 0 && !isAiOnly) {
        toast.info(`Keine neuen Treffer (${resp.not_found} nicht gefunden).`);
      }
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setRunning(false);
      setAiRunning(false);
    }
  };

  // autoStart for the detail-page "ergänzen" path. Guarded so it only
  // fires once per mount.
  const [autoFired, setAutoFired] = useState(false);
  if (autoStart && !autoFired && !running && !summary) {
    setAutoFired(true);
    void runFill('fill_empty');
  }

  const onRefillAll = async () => {
    const ok = await confirm({
      title: 'Alle Nährwerte überschreiben?',
      message:
        'Bestehende Werte (auch manuell eingetragene) werden durch die Datenbank-Treffer ersetzt. Fortfahren?',
      confirmLabel: 'Überschreiben',
      cancelLabel: 'Abbrechen',
      variant: 'danger',
    });
    if (!ok) return;
    await runFill('refill_all');
  };

  const notFoundIds =
    summary?.results
      .filter((r) => r.status === 'not_found')
      .map((r) => r.ingredient_id) ?? [];
  const notFoundNames =
    summary?.results
      .filter((r) => r.status === 'not_found')
      .map((r) => r.name) ?? [];
  const deferredCount = summary?.deferred ?? 0;

  return (
    <div className={variant === 'full' ? 'space-y-2' : 'mt-2 space-y-2'}>
      {variant === 'full' && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => runFill('fill_empty')}
            disabled={running || aiRunning}
            className="btn-secondary text-sm inline-flex items-center gap-1.5"
            title="Leere Nährwert-Felder per USDA + OFF füllen"
          >
            {running ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Database size={14} />
            )}
            Nährwerte für alle holen
          </button>
          <button
            type="button"
            onClick={onRefillAll}
            disabled={running || aiRunning}
            className="btn-ghost text-xs"
            title="Auch bereits gefüllte Werte neu abrufen"
          >
            Alle neu abrufen
          </button>
        </div>
      )}

      {variant === 'compact' && running && (
        <p className="text-xs text-muted inline-flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" />
          Nährwerte werden geholt …
        </p>
      )}

      {summary && (
        <div className="rounded-card border border-line bg-page/60 p-3 text-sm">
          <p className="text-ink">
            <span className="font-medium tabular-nums">
              {summary.filled}
            </span>{' '}
            von{' '}
            <span className="tabular-nums">{summary.total}</span> Zutaten
            befüllt
            {summary.skipped > 0 && (
              <span className="text-muted">
                {' '}
                · {summary.skipped} bereits gepflegt
              </span>
            )}
          </p>

          {notFoundNames.length > 0 && (
            <div className="mt-2 text-xs text-muted">
              <p className="inline-flex items-start gap-1">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>
                  Nicht gefunden: {notFoundNames.slice(0, 6).join(', ')}
                  {notFoundNames.length > 6 &&
                    ` · +${notFoundNames.length - 6} weitere`}
                </span>
              </p>
              <button
                type="button"
                onClick={() =>
                  runFill('fill_empty', notFoundIds, true)
                }
                disabled={aiRunning || running}
                className="btn-secondary text-xs mt-2 inline-flex items-center gap-1.5"
              >
                {aiRunning ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                KI-Schätzung für die fehlenden
              </button>
            </div>
          )}

          {deferredCount > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              {deferredCount} Zutaten verzögert (Rate-Limit) — in einer
              Minute erneut „Nährwerte für alle holen" klicken.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
