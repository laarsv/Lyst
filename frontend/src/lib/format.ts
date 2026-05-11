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
