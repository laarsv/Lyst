/** Subtle save-state pill for detail pages.
 *
 *  Three visible states (a fourth, "idle", renders nothing):
 *    - saving  → spinner + "Speichern…" (muted)
 *    - saved   → checkmark + "Gespeichert" (brand colour, auto-fades)
 *    - error   → warning + "Nicht gespeichert" + retry icon (danger)
 *
 *  Designed to sit inline next to the title — discoverable without being
 *  noisy, complementing (not replacing) error toasts. The companion
 *  `useSaveIndicator` hook handles the timing and retry plumbing so call
 *  sites just write `save.signalSaved()` after a successful mutation.
 *
 *  Usage:
 *
 *    const save = useSaveIndicator();
 *    const onUpdate = async (patch) => {
 *      save.signalSaving();
 *      try {
 *        await Api.update(id, patch);
 *        save.signalSaved();
 *      } catch (e) {
 *        save.signalError(() => onUpdate(patch));
 *      }
 *    };
 *    return <SaveIndicator state={save.state} onRetry={save.retry} />;
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCw } from 'lucide-react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveIndicatorApi {
  state: SaveState;
  signalSaving: () => void;
  signalSaved: () => void;
  /** `retry` is the action to re-run when the user taps the retry icon —
   *  typically the same callback that just failed. */
  signalError: (retry?: () => void | Promise<unknown>) => void;
  retry: () => void;
}

interface UseOptions {
  /** How long the green "Gespeichert" pill stays visible. Default 2 s. */
  savedTimeoutMs?: number;
}

export function useSaveIndicator({ savedTimeoutMs = 2000 }: UseOptions = {}): SaveIndicatorApi {
  const [state, setState] = useState<SaveState>('idle');
  const retryRef = useRef<(() => void | Promise<unknown>) | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Cancel any pending fade-out on unmount so we don't setState on a
  // dead component (e.g. user navigates away mid-save).
  useEffect(() => clearTimer, []);

  const signalSaving = useCallback(() => {
    clearTimer();
    setState('saving');
  }, []);

  const signalSaved = useCallback(() => {
    clearTimer();
    setState('saved');
    timerRef.current = setTimeout(() => setState('idle'), savedTimeoutMs);
  }, [savedTimeoutMs]);

  const signalError = useCallback((retry?: () => void | Promise<unknown>) => {
    clearTimer();
    retryRef.current = retry;
    setState('error');
  }, []);

  const retry = useCallback(() => {
    const fn = retryRef.current;
    if (!fn) return;
    setState('saving');
    void Promise.resolve(fn());
  }, []);

  return { state, signalSaving, signalSaved, signalError, retry };
}

interface Props {
  state: SaveState;
  onRetry?: () => void;
  className?: string;
}

export function SaveIndicator({ state, onRetry, className = '' }: Props) {
  if (state === 'idle') return null;

  const base =
    'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border transition-opacity duration-150';

  if (state === 'saving') {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`${base} border-line bg-page text-muted ${className}`}
      >
        <Loader2 size={12} className="animate-spin" />
        <span>Speichern…</span>
      </span>
    );
  }

  if (state === 'saved') {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`${base} border-brand/30 bg-brand-50 text-brand-700 ${className}`}
      >
        <Check size={12} />
        <span>Gespeichert</span>
      </span>
    );
  }

  // error
  return (
    <span
      role="alert"
      className={`${base} border-danger/30 bg-danger-50 text-danger ${className}`}
    >
      <AlertTriangle size={12} />
      <span>Nicht gespeichert</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Erneut versuchen"
          className="ml-0.5 inline-flex items-center justify-center size-4 rounded-full hover:bg-danger/10"
        >
          <RotateCw size={11} />
        </button>
      )}
    </span>
  );
}
