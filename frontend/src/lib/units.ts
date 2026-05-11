/** Canonical set of cooking units shown in the recipe-ingredient dropdown.
 *  Order matters — most common at the top.
 *  Empty string = "ohne Einheit" (e.g. for "3 Eier"). */
export const UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '— ohne —' },
  { value: 'g', label: 'g (Gramm)' },
  { value: 'kg', label: 'kg' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'l (Liter)' },
  { value: 'Stk.', label: 'Stück' },
  { value: 'EL', label: 'EL (Esslöffel)' },
  { value: 'TL', label: 'TL (Teelöffel)' },
  { value: 'Msp.', label: 'Msp. (Messerspitze)' },
  { value: 'Prise', label: 'Prise' },
  { value: 'Pck.', label: 'Päckchen' },
  { value: 'Bund', label: 'Bund' },
  { value: 'Dose', label: 'Dose' },
  { value: 'Glas', label: 'Glas' },
  { value: 'Tasse', label: 'Tasse' },
  { value: 'Becher', label: 'Becher' },
  { value: 'Scheibe', label: 'Scheibe' },
  { value: 'Zehe', label: 'Zehe' },
  { value: 'cm', label: 'cm' },
];

const KNOWN = new Set(UNIT_OPTIONS.map((u) => u.value));

export function isKnownUnit(unit: string | null | undefined): boolean {
  if (unit === null || unit === undefined) return true; // null = empty option
  return KNOWN.has(unit);
}
