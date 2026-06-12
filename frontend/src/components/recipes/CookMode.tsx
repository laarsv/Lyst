import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Heart, Timer, Volume2, VolumeX, X } from 'lucide-react';
import type { Recipe } from '@/types';
import { fmtQty, scaleQty } from '@/lib/format';
import {
  formatClock,
  formatDuration,
  segmentStepText,
  type StepTimer,
} from '@/lib/stepTimers';
import { mentionedIngredientIds } from '@/lib/ingredientMatch';
import { RecipesApi } from '@/api/endpoints';
import { invalidateOverview } from '@/hooks/useOverviewQuery';
import { toast } from '@/components/Toast';
import { BottomSheet } from '@/components/BottomSheet';
import { StarRating } from '@/components/recipes/StarRating';

interface Props {
  recipe: Recipe;
  servings: number;
  onClose: () => void;
  /** Called with the refreshed recipe after a post-cook save so the detail
   *  page reflects the new rating / "Zuletzt gekocht" without a re-fetch. */
  onCooked?: (updated: Recipe) => void;
}

interface RunningTimer {
  id: string;
  label: string;
  total: number;
  maxSeconds: number | null;
  endsAt: number;
  done: boolean;
}

const RESUME_KEY = 'cookResume';
const RESUME_WINDOW_MS = 60 * 60 * 1000;
const VOICE_KEY = 'cookVoice';

export function CookMode({ recipe, servings, onClose, onCooked }: Props) {
  const [step, setStep] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [doneBanner, setDoneBanner] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem(VOICE_KEY) === '1');
  const [speaking, setSpeaking] = useState(false);
  const [postCookOpen, setPostCookOpen] = useState(false);

  const wakeLockRef = useRef<any>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const timersRef = useRef<RunningTimer[]>([]);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const steps = useMemo(
    () => [...recipe.steps].sort((a, b) => a.position - b.position),
    [recipe.steps],
  );
  const hasSteps = steps.length > 0;
  const safeStep = Math.min(step, Math.max(0, steps.length - 1));
  const current = hasSteps ? steps[safeStep] : null;
  const factor = recipe.servings > 0 ? servings / recipe.servings : 1;
  const kcalPerServing = recipe.nutrition?.per_serving?.calories ?? null;
  const isOwner = recipe.share_source == null;

  const highlighted = useMemo(
    () => (current ? mentionedIngredientIds(current.description, recipe.ingredients) : new Set<number>()),
    [current, recipe.ingredients],
  );

  const goNext = () => setStep((s) => Math.min(steps.length - 1, s + 1));
  const goPrev = () => setStep((s) => Math.max(0, s - 1));

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
      if (postCookOpen) return; // sheet handles its own keys
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length, postCookOpen]);

  // ---- Touch swipe ----
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) goNext();
      else goPrev();
    }
    touchStartX.current = null;
  };

  // ========================= Timers =========================
  useEffect(() => { timersRef.current = timers; }, [timers]);

  function ensureAudio() {
    if (!audioRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx) audioRef.current = new Ctx();
    }
    if (audioRef.current?.state === 'suspended') audioRef.current.resume().catch(() => {});
  }

  function beep() {
    const ctx = audioRef.current;
    if (!ctx) return;
    try {
      // Three short rising blips — distinct, no audio asset needed.
      [0, 0.18, 0.36].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 760 + i * 140;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const t0 = ctx.currentTime + offset;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
        osc.start(t0);
        osc.stop(t0 + 0.16);
      });
    } catch {
      // ignore — audio is a nice-to-have
    }
  }

  function fireTimerDone(t: RunningTimer) {
    beep();
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Timer abgelaufen', { body: `${t.label} · ${recipe.title}` });
      } catch {
        // some browsers throw if not triggered from a SW — ignore
      }
    }
    setDoneBanner(`Timer abgelaufen: ${t.label}`);
    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    bannerTimeoutRef.current = setTimeout(() => setDoneBanner(null), 8000);
  }

  // Single 1s tick for the whole component lifetime; reads timers via a ref so
  // the interval never goes stale, and fires completion side-effects exactly
  // once (outside any state updater → StrictMode-safe).
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      const cur = timersRef.current;
      const justDone = cur.filter((t) => !t.done && t.endsAt <= now);
      if (cur.some((t) => !t.done)) setNowTs(now);
      if (justDone.length) {
        setTimers((prev) =>
          prev.map((t) => (!t.done && t.endsAt <= now ? { ...t, done: true } : t)),
        );
        justDone.forEach(fireTimerDone);
      }
    }, 1000);
    return () => {
      clearInterval(iv);
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
      audioRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startTimer(t: StepTimer) {
    ensureAudio();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    setTimers((prev) => [
      ...prev,
      {
        id: `${t.id}-${Date.now()}`,
        label: t.label,
        total: t.seconds,
        maxSeconds: t.maxSeconds,
        endsAt: Date.now() + t.seconds * 1000,
        done: false,
      },
    ]);
  }

  const dismissTimer = (id: string) => setTimers((prev) => prev.filter((t) => t.id !== id));

  // ========================= Voice (speech synthesis) =========================
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  function speak(text: string) {
    if (!speechSupported) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    const de = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith('de'));
    if (de) u.voice = de;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
  }
  function stopSpeak() {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  useEffect(() => {
    localStorage.setItem(VOICE_KEY, voiceOn ? '1' : '0');
  }, [voiceOn]);

  // Warm up the voice list (Chrome populates it async).
  useEffect(() => {
    if (speechSupported) window.speechSynthesis.getVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the active step when navigating / when voice is switched on; stop on
  // step change, toggle-off, and unmount.
  useEffect(() => {
    if (voiceOn && current) speak(current.description);
    else stopSpeak();
    return () => stopSpeak();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeStep, voiceOn]);

  // Pause speech when the tab is hidden / the user leaves.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'hidden') stopSpeak(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========================= Resume within 60 min =========================
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESUME_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { recipeId: number; step: number; ts: number };
      if (
        saved.recipeId === recipe.id &&
        saved.step > 0 &&
        Date.now() - saved.ts < RESUME_WINDOW_MS
      ) {
        const target = Math.min(saved.step, steps.length - 1);
        if (target > 0) {
          toast.action(
            `Bei Schritt ${target + 1} weitermachen?`,
            'Fortsetzen',
            () => setStep(target),
            { durationMs: 8000 },
          );
        }
      }
    } catch {
      // ignore malformed resume state
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({ recipeId: recipe.id, step: safeStep, ts: Date.now() }),
      );
    } catch {
      // ignore quota / private-mode errors
    }
  }, [safeStep, recipe.id]);

  // ========================= Finish / post-cook =========================
  const [pcRating, setPcRating] = useState(recipe.rating || 0);
  const [pcFav, setPcFav] = useState(recipe.is_favorite);
  const [pcNotes, setPcNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const finishedRef = useRef(false);

  function endCook() {
    stopSpeak();
    try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
    onClose();
  }

  function onFinishClick() {
    if (isOwner) setPostCookOpen(true);
    else endCook(); // recipients don't log/rate the owner's recipe
  }

  async function finishCook(withRating: boolean) {
    if (finishedRef.current) { endCook(); return; }
    finishedRef.current = true;
    setSaving(true);
    try {
      const updated = await RecipesApi.markCooked(
        recipe.id,
        withRating
          ? { notes: pcNotes.trim() || null, rating: pcRating, is_favorite: pcFav }
          : {},
      );
      invalidateOverview('recipes');
      onCooked?.(updated);
      toast.success(withRating ? 'Bewertung gespeichert · als gekocht vermerkt' : 'Als gekocht vermerkt');
    } catch {
      toast.error('Konnte nicht gespeichert werden');
    } finally {
      setSaving(false);
      endCook();
    }
  }

  // ========================= Render =========================
  if (!hasSteps) {
    return (
      <FullscreenShell onClose={onClose} title={recipe.title} progress={0} kcalPerServing={kcalPerServing}>
        <div className="flex-1 flex items-center justify-center p-6 text-center text-muted">
          Dieses Rezept hat keine Schritte.
        </div>
      </FullscreenShell>
    );
  }

  const progress = ((safeStep + 1) / steps.length) * 100;
  const prevText = safeStep > 0 ? steps[safeStep - 1].description : null;
  const nextText = safeStep < steps.length - 1 ? steps[safeStep + 1].description : null;
  const segments = segmentStepText(current!.description);

  return (
    <FullscreenShell
      onClose={onClose}
      title={recipe.title}
      progress={progress}
      onToggleIngredients={() => setShowIngredients((v) => !v)}
      ingredientsOpen={showIngredients}
      kcalPerServing={kcalPerServing}
      voice={
        speechSupported
          ? { on: voiceOn, speaking, onToggle: () => setVoiceOn((v) => !v) }
          : undefined
      }
      banner={doneBanner}
    >
      <div
        className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 overflow-auto"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="max-w-2xl w-full text-center">
          <div className="text-sm text-muted mb-3 tabular-nums font-cookmono">
            Schritt {safeStep + 1} von {steps.length}
          </div>

          {prevText && (
            <button
              onClick={goPrev}
              className="block w-full text-sm text-muted/70 mb-4 truncate hover:text-muted transition"
              title={prevText}
            >
              ↑ {prevText}
            </button>
          )}

          <p className="text-2xl sm:text-3xl leading-relaxed font-display">
            {segments.map((seg, i) =>
              seg.kind === 'text' ? (
                <span key={i} className="whitespace-pre-wrap">{seg.text}</span>
              ) : (
                <button
                  key={i}
                  onClick={() => startTimer(seg.timer)}
                  className="inline-flex items-center gap-1 align-middle mx-0.5 px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-lg font-medium hover:bg-brand-100 transition"
                  title={
                    seg.timer.maxSeconds
                      ? `Timer starten (bis ${formatDuration(seg.timer.maxSeconds)} möglich)`
                      : 'Timer starten'
                  }
                >
                  <Timer size={18} />
                  {seg.timer.label}
                </button>
              ),
            )}
          </p>

          {nextText && (
            <button
              onClick={goNext}
              className="block w-full text-sm text-muted/70 mt-4 truncate hover:text-muted transition"
              title={nextText}
            >
              {nextText} ↓
            </button>
          )}
        </div>
      </div>

      {/* Floating active-timer chips */}
      {timers.length > 0 && (
        <div className="px-4 sm:px-8 pb-1">
          <div className="max-w-2xl mx-auto flex flex-wrap gap-2 justify-center">
            {timers.map((t) => (
              <TimerChip
                key={t.id}
                timer={t}
                remaining={Math.max(0, Math.round((t.endsAt - nowTs) / 1000))}
                onDismiss={() => dismissTimer(t.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div className="px-4 sm:px-8 pb-6 pt-3 border-t border-line">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button className="btn-secondary inline-flex items-center gap-1" disabled={safeStep === 0} onClick={goPrev}>
            <ChevronLeft size={18} /> Zurück
          </button>
          <div className="text-xs text-muted hidden sm:block">←/→ · Wischen · Esc</div>
          {safeStep < steps.length - 1 ? (
            <button className="btn-primary inline-flex items-center gap-1" onClick={goNext}>
              Weiter <ChevronRight size={18} />
            </button>
          ) : (
            <button className="btn-primary" onClick={onFinishClick}>
              Fertig ✓
            </button>
          )}
        </div>
      </div>

      {/* Ingredients bottom sheet — with active-step highlighting */}
      {showIngredients && (
        <div
          className="absolute inset-0 z-10 flex items-end justify-center bg-ink/40"
          onClick={() => setShowIngredients(false)}
        >
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
                const isMatch = highlighted.has(i.id);
                const muted = highlighted.size > 0 && !isMatch;
                return (
                  <li
                    key={i.id}
                    className={clsx(
                      'py-2 flex items-baseline gap-2 -mx-2 px-2 rounded-lg transition',
                      isMatch && 'bg-brand-50',
                      muted && 'opacity-40',
                    )}
                  >
                    <span className="text-sm text-muted tabular-nums w-20 shrink-0">
                      {fmtQty(q)} {i.unit ?? ''}
                    </span>
                    <span className={clsx(isMatch && 'font-semibold text-brand-700')}>{i.name}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Post-cook rate + note sheet (owner only) */}
      <BottomSheet open={postCookOpen} onClose={() => finishCook(false)} ariaLabel="Rezept bewerten">
        <div className="px-5 pb-4 overflow-auto">
          <h3 className="text-lg font-semibold text-center mb-1">Wie war's?</h3>
          <p className="text-sm text-muted text-center mb-4">{recipe.title}</p>

          <div className="flex justify-center mb-4">
            <StarRating value={pcRating} onChange={setPcRating} size={34} />
          </div>

          <button
            type="button"
            onClick={() => setPcFav((v) => !v)}
            className={clsx(
              'mx-auto mb-4 flex items-center gap-2 px-4 py-2 rounded-full border transition',
              pcFav ? 'border-danger text-danger bg-danger-50' : 'border-line text-muted',
            )}
          >
            <Heart size={18} className={pcFav ? 'fill-danger' : ''} />
            {pcFav ? 'Favorit' : 'Als Favorit'}
          </button>

          <textarea
            value={pcNotes}
            onChange={(e) => setPcNotes(e.target.value)}
            placeholder="Notiz fürs nächste Mal…"
            rows={3}
            className="input w-full resize-none mb-4"
          />

          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => finishCook(false)} disabled={saving}>
              Ohne Bewertung
            </button>
            <button className="btn-primary flex-1" onClick={() => finishCook(true)} disabled={saving}>
              {saving ? 'Speichern…' : 'Speichern & fertig'}
            </button>
          </div>
        </div>
      </BottomSheet>
    </FullscreenShell>
  );
}

function TimerChip({
  timer,
  remaining,
  onDismiss,
}: {
  timer: RunningTimer;
  remaining: number;
  onDismiss: () => void;
}) {
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full border text-sm',
        timer.done
          ? 'bg-danger-50 border-red-200 text-red-900 animate-pulse'
          : 'bg-brand-50 border-brand-100 text-brand-700',
      )}
    >
      <Timer size={16} />
      {timer.done ? (
        <span className="font-medium">Fertig · {timer.label}</span>
      ) : (
        <>
          <span className="tabular-nums font-semibold font-cookmono">{formatClock(remaining)}</span>
          <span className="text-xs opacity-70">{timer.label}</span>
          {timer.maxSeconds && (
            <span className="text-xs opacity-70">· bis {formatDuration(timer.maxSeconds)}</span>
          )}
        </>
      )}
      <button onClick={onDismiss} className="ml-1 hover:opacity-70" aria-label="Timer entfernen">
        <X size={15} />
      </button>
    </div>
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
  voice,
  banner,
}: {
  title: string;
  onClose: () => void;
  progress: number;
  children: React.ReactNode;
  onToggleIngredients?: () => void;
  ingredientsOpen?: boolean;
  kcalPerServing?: number | null;
  voice?: { on: boolean; speaking: boolean; onToggle: () => void };
  banner?: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-page text-ink flex flex-col cookbook cookbook-cook"
      data-theme="dark"
      role="dialog"
      aria-modal="true"
    >
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
        {voice && (
          <button
            className={clsx(
              'btn-secondary text-sm inline-flex items-center gap-1.5',
              voice.on && 'text-brand-700 border-brand-200',
            )}
            onClick={voice.onToggle}
            aria-pressed={voice.on}
            title={voice.on ? 'Vorlesen aus' : 'Schritt vorlesen'}
          >
            {voice.on ? <Volume2 size={18} /> : <VolumeX size={18} />}
            {voice.speaking && <span className="hidden sm:inline text-xs">spricht…</span>}
          </button>
        )}
        {onToggleIngredients && (
          <button className="btn-secondary text-sm" onClick={onToggleIngredients} aria-pressed={!!ingredientsOpen}>
            Zutaten
          </button>
        )}
        <button className="btn-ghost" onClick={onClose} aria-label="Kochansicht schließen">
          <X size={20} />
        </button>
      </header>
      <div className="h-1 bg-line">
        <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
      </div>
      {banner && (
        <div className="bg-danger-50 border-b border-red-200 text-red-900 px-4 py-2 text-sm flex items-center gap-2 justify-center">
          <Timer size={16} /> {banner}
        </div>
      )}
      {children}
    </div>
  );
}
