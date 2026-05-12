/** Tiny German-relative-time formatter. */
export function relativeDe(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const sec = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (sec < 30) return 'gerade eben';
  if (sec < 60) return `vor ${sec} Sek.`;
  const min = Math.round(sec / 60);
  if (min < 60) return `vor ${min} Min.`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `vor ${hr} Std.`;
  const day = Math.round(hr / 24);
  if (day < 7) return `vor ${day} Tg.`;
  return then.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
