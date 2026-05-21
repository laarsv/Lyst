import { useEffect, useRef, useState } from 'react';
import type { Recipe } from '@/types';
import { fmtQty, scaleQty } from '@/lib/format';

interface Props {
  recipe: Recipe;
  servings: number;
  onClose: () => void;
}

export function CookMode({ recipe, servings, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const wakeLockRef = useRef<any>(null);

  // ---- WakeLock: keep the screen on while cooking ----
  useEffect(() => {
    let cancelled = false;
    const acquire = async () => {
      const nav = navigator as any;
      if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') return;
      try {
        const lock = await nav.wakeLock.request('screen');
        if (cancelled) {
          await lock.release();
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener('release', () => { wakeLockRef.current = null; });
      } catch {
        // Permission denied or unsupported — silently ignore
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (lock) lock.release().catch(() => undefined);
    };
  }, []);

  // ---- Keyboard navigation ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ') setStep((s) => Math.min(steps.length - 1, s + 1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Touch swipe ----
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) setStep((s) => Math.min(steps.length - 1, s + 1));
      else setStep((s) => Math.max(0, s - 1));
    }
    touchStartX.current = null;
  };

  const steps = [...recipe.steps].sort((a, b) => a.position - b.position);
  const factor = recipe.servings > 0 ? servings / recipe.servings : 1;

  const kcalPerServing = recipe.nutrition?.per_serving?.calories ?? null;

  if (steps.length === 0) {
    return (
      <FullscreenShell
        onClose={onClose}
        title={recipe.title}
        progress={0}
        kcalPerServing={kcalPerServing}
      >
        <div className="text-center text-muted">Dieses Rezept hat keine Schritte.</div>
      </FullscreenShell>
    );
  }

  const current = steps[step];
  const progress = ((step + 1) / steps.length) * 100;

  return (
    <FullscreenShell
      onClose={onClose}
      title={recipe.title}
      progress={progress}
      onToggleIngredients={() => setShowIngredients((v) => !v)}
      ingredientsOpen={showIngredients}
      kcalPerServing={kcalPerServing}
    >
      <div
        className="flex-1 flex items-center justify-center p-6 sm:p-12"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="max-w-2xl w-full text-center">
          <div className="text-sm text-muted mb-4 tabular-nums">
            Schritt {step + 1} / {steps.length}
          </div>
          <p className="text-2xl sm:text-3xl leading-relaxed whitespace-pre-wrap">
            {current.description}
          </p>
        </div>
      </div>

      {/* Bottom nav */}
      <div className="px-4 sm:px-8 pb-6 pt-3 border-t border-line">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            className="btn-secondary"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            ← Zurück
          </button>
          <div className="text-xs text-muted hidden sm:block">
            ←/→ Pfeile · Wischen · Esc zum Schließen
          </div>
          {step < steps.length - 1 ? (
            <button className="btn-primary" onClick={() => setStep((s) => s + 1)}>
              Weiter →
            </button>
          ) : (
            <button className="btn-primary" onClick={onClose}>
              Fertig ✓
            </button>
          )}
        </div>
      </div>

      {/* Ingredients bottom sheet */}
      {showIngredients && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/40" onClick={() => setShowIngredients(false)}>
          <div
            className="bg-surface w-full max-w-2xl rounded-t-2xl p-5 max-h-[70vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0) + 20px)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Zutaten ({servings} Pers.)</h3>
              <button className="btn-ghost text-sm" onClick={() => setShowIngredients(false)}>Schließen</button>
            </div>
            <ul className="divide-y divide-line">
              {recipe.ingredients.map((i) => {
                const q = scaleQty(i.quantity, factor);
                return (
                  <li key={i.id} className="py-2 flex items-baseline gap-2">
                    <span className="text-sm text-muted tabular-nums w-20 shrink-0">
                      {fmtQty(q)} {i.unit ?? ''}
                    </span>
                    <span>{i.name}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </FullscreenShell>
  );
}

function FullscreenShell({
  title,
  onClose,
  progress,
  children,
  onToggleIngredients,
  ingredientsOpen,
  kcalPerServing,
}: {
  title: string;
  onClose: () => void;
  progress: number;
  children: React.ReactNode;
  onToggleIngredients?: () => void;
  ingredientsOpen?: boolean;
  /** Per-portion kcal — shown next to the title as a compact hint
   *  ("≈ 480 kcal / Portion"). Null hides the chip. */
  kcalPerServing?: number | null;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-page text-ink flex flex-col" role="dialog" aria-modal="true">
      <header className="px-4 sm:px-6 py-3 border-b border-line flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted">Kochansicht</div>
          <div className="font-medium truncate">{title}</div>
        </div>
        {kcalPerServing != null && (
          <div
            className="text-xs text-muted hidden sm:flex items-center px-2 py-1 rounded-ctl bg-page/60 border border-line"
            title="Geschätzte Kalorien pro Portion (siehe Detailseite)"
          >
            ≈ {Math.round(kcalPerServing)} kcal / Portion
          </div>
        )}
        {onToggleIngredients && (
          <button className="btn-secondary text-sm" onClick={onToggleIngredients} aria-pressed={!!ingredientsOpen}>
            Zutaten
          </button>
        )}
        <button className="btn-ghost" onClick={onClose} aria-label="Kochansicht schließen">
          ✕
        </button>
      </header>
      <div className="h-1 bg-line">
        <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
      </div>
      {children}
    </div>
  );
}
