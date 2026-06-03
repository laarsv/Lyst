import type { ExerciseLocation, ExerciseType, SetLog, TrackingType } from '@/types';

/** Fixed muscle-group taxonomy — the exercise form uses a dropdown of these,
 *  no free text. */
export const MUSCLE_GROUPS = [
  'Brust', 'Rücken', 'Schultern', 'Bizeps', 'Trizeps', 'Core',
  'Beine', 'Waden', 'Gesäß', 'Ganzkörper', 'Mobilität',
] as const;

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  AUFBAU: 'Aufbau',
  DEHNEN: 'Dehnen',
  PHYSIO: 'Physio',
};
export const EXERCISE_TYPE_OPTIONS: ExerciseType[] = ['AUFBAU', 'DEHNEN', 'PHYSIO'];

export const LOCATION_LABELS: Record<ExerciseLocation, string> = {
  STUDIO: 'Studio',
  HOME: 'Home',
  BEIDES: 'Beides',
};
export const LOCATION_OPTIONS: ExerciseLocation[] = ['STUDIO', 'HOME', 'BEIDES'];

export const TRACKING_LABELS: Record<TrackingType, string> = {
  REPS: 'Wiederholungen',
  WEIGHT_REPS: 'Gewicht × Wdh.',
  TIME: 'Zeit',
};
export const TRACKING_OPTIONS: TrackingType[] = ['REPS', 'WEIGHT_REPS', 'TIME'];

/** Seconds → "m:ss". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A logged set as a short label, depending on the exercise's tracking type. */
export function fmtSet(set: { reps_done: number | null; weight_done: number | null; duration_done: number | null }, tracking: TrackingType): string {
  if (tracking === 'TIME') return fmtDuration(set.duration_done);
  if (tracking === 'WEIGHT_REPS') {
    const reps = set.reps_done ?? '–';
    return set.weight_done != null ? `${set.weight_done} kg × ${reps}` : `${reps} Wdh`;
  }
  return set.reps_done != null ? `${set.reps_done} Wdh` : '—';
}

/** Numeric value of a logged set for the history line, by tracking type. */
export function historyValue(p: { weight: number | null; reps: number | null; duration: number | null }, tracking: TrackingType): number {
  if (tracking === 'TIME') return p.duration ?? 0;
  if (tracking === 'WEIGHT_REPS') return p.weight ?? 0;
  return p.reps ?? 0;
}

export function dateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
