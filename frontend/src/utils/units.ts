/** Canonical units for shopping/packing/checklist items.
 *
 *  Different from src/lib/units.ts (which serves recipe ingredients with
 *  cooking-specific units like "Msp.", "Tasse", "Zehe"). Keeping them
 *  separate so the recipe-side dropdown doesn't grow noise like "Tüte"
 *  and the shopping-side doesn't need "Zehe" — both lists stay tight.
 *
 *  Alias map is used by the input parser to normalize user-typed unit
 *  words ("dosen" → "Dose", "stück" → "Stk", "kilo" → "kg"). */

export const CANONICAL_UNITS = [
  'g',
  'kg',
  'mg',
  'ml',
  'l',
  'cl',
  'dl',
  'Stk',
  'Pack',
  'Dose',
  'Flasche',
  'Glas',
  'Becher',
  'Bund',
  'Tüte',
  'EL',
  'TL',
  'Prise',
  'Scheibe',
] as const;

export type CanonicalUnit = (typeof CANONICAL_UNITS)[number];

/** UI-facing dropdown options. The empty option goes first. */
export const UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '— ohne —' },
  ...CANONICAL_UNITS.map((u) => ({ value: u, label: u })),
];

/** Lower-case alias → canonical form. Add new spellings here, not in the
 *  parser; the parser only does the lookup. */
const ALIAS_MAP: Record<string, CanonicalUnit> = {
  // mass
  g: 'g',
  gramm: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilogramm: 'kg',
  mg: 'mg',
  // volume
  ml: 'ml',
  milliliter: 'ml',
  l: 'l',
  liter: 'l',
  cl: 'cl',
  dl: 'dl',
  // count
  stk: 'Stk',
  'stk.': 'Stk',
  stück: 'Stk',
  stueck: 'Stk',
  st: 'Stk',
  x: 'Stk',
  // packaging
  pack: 'Pack',
  packung: 'Pack',
  pkg: 'Pack',
  dose: 'Dose',
  dosen: 'Dose',
  flasche: 'Flasche',
  flaschen: 'Flasche',
  fl: 'Flasche',
  glas: 'Glas',
  gläser: 'Glas',
  glaeser: 'Glas',
  becher: 'Becher',
  bund: 'Bund',
  tüte: 'Tüte',
  tueten: 'Tüte',
  tüten: 'Tüte',
  // cooking
  el: 'EL',
  esslöffel: 'EL',
  esslöffeln: 'EL',
  essloeffel: 'EL',
  tl: 'TL',
  teelöffel: 'TL',
  teeloeffel: 'TL',
  prise: 'Prise',
  prisen: 'Prise',
  scheibe: 'Scheibe',
  scheiben: 'Scheibe',
};

/** Normalize a user-typed unit token into the canonical form. Returns null
 *  if the token doesn't look like one of our known aliases — caller decides
 *  whether to keep it as a free-form unit or drop it. */
export function normalizeUnit(raw: string): CanonicalUnit | null {
  const key = raw.trim().toLowerCase();
  return ALIAS_MAP[key] ?? null;
}

const KNOWN = new Set<string>(CANONICAL_UNITS);

export function isCanonicalUnit(unit: string | null | undefined): boolean {
  if (unit === null || unit === undefined || unit === '') return true;
  return KNOWN.has(unit);
}
