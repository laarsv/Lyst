/**
 * German cooking-step duration parser (Cooking Mode, Feature 1).
 *
 * Pure and derived-on-render — nothing here is persisted; CookMode recomputes
 * timers from the step text each render. Finds time mentions like "8 Minuten",
 * "30 Sek.", "1,5 Std", "10–15 Minuten" and turns them into inline timer
 * tokens. Vague phrases ("ein paar Minuten") carry no digit and are skipped
 * by construction. Only units (min/Std/Sek …) match, so quantities like
 * "200 g" / "180 Grad" / "2 EL" never become timers.
 */

export interface StepTimer {
  /** Stable id within a step (the match offset) — for React keys. */
  id: string;
  /** Char offsets of the matched duration within the step text. */
  start: number;
  end: number;
  /** The exact matched text, e.g. "10–15 Minuten". */
  text: string;
  /** Seconds to start the timer at — the lower bound of a range. */
  seconds: number;
  /** Upper bound in seconds for a range, else null → drives "bis X möglich". */
  maxSeconds: number | null;
  /** Compact German label for the button, e.g. "8 min", "1:30 Std". */
  label: string;
}

export type StepSegment =
  | { kind: 'text'; text: string }
  | { kind: 'timer'; text: string; timer: StepTimer };

const NUM = '\\d+(?:[.,]\\d+)?';
// Longest-first inside each family so "Minuten" wins over "Min"; the `i`
// flag covers casing. Trailing \b keeps "Sek" out of "Sekt" and "h" out of
// "Hähnchen" / "hat".
const UNIT = '(?:Stunden|Stunde|Std|Minuten|Minute|Min|Sekunden|Sekunde|Sek|h)';
const RANGE = '(?:\\s*(?:bis|-|–|—)\\s*)';
// A range's upper bound is only captured together with its separator, so
// "2-3 EL" (no time unit) never parses as a range.
const TIMER_RE = new RegExp(`(${NUM})(?:${RANGE}(${NUM}))?\\s*(${UNIT})\\b`, 'gi');

const parseNum = (s: string): number => parseFloat(s.replace(',', '.'));

function unitToSeconds(unit: string): number {
  const u = unit.toLowerCase();
  if (u === 'h' || u.startsWith('std') || u.startsWith('stunde')) return 3600;
  if (u.startsWith('min')) return 60;
  return 1; // Sekunde(n) / Sek
}

/** Compact German rendering of a whole-second duration. */
export function formatDuration(totalSec: number): string {
  if (totalSec < 60) return `${Math.round(totalSec)} Sek`;
  if (totalSec % 3600 === 0) return `${totalSec / 3600} Std`;
  if (totalSec < 3600) return `${Math.round(totalSec / 60)} min`;
  const m = Math.round(totalSec / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}:${String(mm).padStart(2, '0')} Std` : `${h} Std`;
}

/** mm:ss countdown rendering for a running timer chip. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function extractTimers(text: string): StepTimer[] {
  const out: StepTimer[] = [];
  TIMER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIMER_RE.exec(text)) !== null) {
    const [full, loStr, hiStr, unit] = m;
    const mult = unitToSeconds(unit);
    const seconds = Math.round(parseNum(loStr) * mult);
    if (seconds <= 0) continue;
    const upper = hiStr ? Math.round(parseNum(hiStr) * mult) : null;
    out.push({
      id: String(m.index),
      start: m.index,
      end: m.index + full.length,
      text: full,
      seconds,
      maxSeconds: upper && upper > seconds ? upper : null,
      label: formatDuration(seconds),
    });
  }
  return out;
}

/**
 * Split a step into alternating text / timer segments so CookMode can render
 * the inline timer button exactly where the duration appears.
 */
export function segmentStepText(text: string): StepSegment[] {
  const timers = extractTimers(text);
  if (timers.length === 0) return [{ kind: 'text', text }];
  const segs: StepSegment[] = [];
  let cursor = 0;
  for (const t of timers) {
    if (t.start > cursor) segs.push({ kind: 'text', text: text.slice(cursor, t.start) });
    segs.push({ kind: 'timer', text: t.text, timer: t });
    cursor = t.end;
  }
  if (cursor < text.length) segs.push({ kind: 'text', text: text.slice(cursor) });
  return segs;
}
