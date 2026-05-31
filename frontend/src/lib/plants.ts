import type { PlantLocation } from '@/types';

/** German labels for the location enum dropdown. Order = dropdown order. */
export const PLANT_LOCATION_LABELS: Record<PlantLocation, string> = {
  SONNIG: 'Sonnig',
  HALBSCHATTEN: 'Halbschatten',
  SCHATTEN: 'Schatten',
};

export const PLANT_LOCATION_OPTIONS: PlantLocation[] = [
  'SONNIG',
  'HALBSCHATTEN',
  'SCHATTEN',
];

/** dd.mm.yyyy for a backend ISO timestamp. Returns "—" for null. */
export function fmtPlantDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Today as YYYY-MM-DD in local time — the default for the "Zuletzt
 *  gegossen/gedüngt" date inputs. */
export function todayInputValue(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Human "fällig in/seit"-label for a due timestamp, rounded to whole days.
 *  overdue=true also covers "today" so the UI nags on the due day itself. */
export function dueLabel(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(new Date())) / 86_400_000);
  const word = (n: number) => (n === 1 ? 'Tag' : 'Tagen');
  if (days < 0) return { text: `überfällig seit ${-days} ${word(-days)}`, overdue: true };
  if (days === 0) return { text: 'heute fällig', overdue: true };
  if (days === 1) return { text: 'morgen fällig', overdue: false };
  return { text: `fällig in ${days} ${word(days)}`, overdue: false };
}

/** German month names, index 0 = Januar. */
export const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
] as const;

/** Month number (1–12) → German name. "—" for null/out-of-range. */
export function monthLabel(m: number | null | undefined): string {
  return m && m >= 1 && m <= 12 ? MONTHS[m - 1] : '—';
}

/** A month range → "Mai–Juli". Single bound → that month. "—" if both unset. */
export function monthRangeLabel(a: number | null | undefined, b: number | null | undefined): string {
  if (a && b) return `${MONTHS[a - 1]}–${MONTHS[b - 1]}`;
  if (a || b) return monthLabel(a || b);
  return '—';
}

/** "heute" / "gestern" / "vor X Tagen" for a past timestamp. "—" for null.
 *  Used for "Zuletzt gegossen" in the details card. */
export function relativePast(iso: string | null): string {
  if (!iso) return '—';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  return `vor ${days} Tagen`;
}
