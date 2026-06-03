import { useEffect, useState } from 'react';
import { Timer, X } from 'lucide-react';
import { fmtDuration } from '@/lib/fitness';

const PRESETS = [60, 90, 120, 180];

/** Client-only rest countdown between sets. No backend state. */
export function RestTimer() {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (remaining == null || remaining <= 0) return;
    const id = window.setTimeout(() => setRemaining((r) => (r == null ? null : r - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [remaining]);

  const running = remaining != null && remaining > 0;
  const done = remaining === 0;

  return (
    <div className="card p-3 flex items-center gap-3">
      <Timer size={18} className="text-brand-700 shrink-0" />
      {remaining == null ? (
        <>
          <span className="text-sm text-muted">Pause:</span>
          <div className="flex gap-1.5 flex-wrap">
            {PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setRemaining(s)}
                className="text-xs px-2.5 py-1 rounded-full border border-brand bg-surface text-brand-700 hover:bg-brand-50"
              >
                {fmtDuration(s)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <span className={`text-2xl font-semibold tabular-nums ${done ? 'text-danger' : 'text-ink'}`}>
            {fmtDuration(Math.max(0, remaining))}
          </span>
          <span className="text-xs text-muted flex-1">{done ? 'Pause vorbei!' : 'läuft…'}</span>
          {running && (
            <button type="button" onClick={() => setRemaining((r) => (r ?? 0) + 30)} className="btn-ghost text-xs">
              +30s
            </button>
          )}
          <button type="button" onClick={() => setRemaining(null)} aria-label="Timer stoppen" className="btn-ghost p-1">
            <X size={16} />
          </button>
        </>
      )}
    </div>
  );
}
