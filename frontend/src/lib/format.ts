/** Format a quantity: max 2 decimals, drop trailing zeros. Returns "" for null/undefined. */
export function fmtQty(q: number | null | undefined): string {
  if (q === null || q === undefined) return '';
  const rounded = Math.round(q * 100) / 100;
  // toFixed(2) → "1.50"; drop trailing zeros and a dangling dot
  return rounded.toFixed(2).replace(/\.?0+$/, '');
}

export function scaleQty(q: number | null, factor: number): number | null {
  if (q === null) return null;
  return Math.round(q * factor * 100) / 100;
}

/** German number formatter — comma decimal separator, trailing-zero
 *  decimals stripped. Used by the compact nutrition info line and
 *  other display surfaces that show raw numbers ("13", "4,3", "1,2").
 *  Returns "—" for null/undefined so the caller doesn't have to. */
export function fmtDe(
  n: number | null | undefined,
  decimals: number = 1,
): string {
  if (n === null || n === undefined) return '—';
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  const s = rounded.toFixed(decimals);
  const [int, frac] = s.split('.');
  if (!frac || /^0+$/.test(frac)) return int;
  return `${int},${frac.replace(/0+$/, '')}`;
}
