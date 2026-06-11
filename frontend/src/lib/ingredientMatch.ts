/**
 * Ingredient ↔ step-text matcher (Cooking Mode, Feature 2).
 *
 * Given the active step's text and the recipe's ingredients, returns the ids
 * of ingredients mentioned in that step so CookMode can highlight them (and
 * mute the rest). Word-based — never a raw substring scan — so an ingredient
 * is matched as a whole word, not inside an unrelated one. German-aware:
 * plural-tolerant ("Zwiebeln" ↔ "Zwiebel") and hyphen-tolerant ("Räucher-Lachs"
 * ↔ "Räucherlachs"). Pure; recompute per active step.
 */

// Common quantity/qualifier words dropped from an ingredient name so matching
// keys off the noun, not the adjective ("Rote Zwiebel" → matches on "Zwiebel").
const QUALIFIERS = new Set([
  'rot', 'rote', 'roter', 'rotes', 'frisch', 'frische', 'frischer', 'frisches',
  'gehackt', 'gehackte', 'gehackter', 'gekocht', 'gekochte', 'getrocknet',
  'getrocknete', 'gemahlen', 'gemahlene', 'gerieben', 'geriebene', 'geriebener',
  'klein', 'kleine', 'kleiner', 'gross', 'grosse', 'grosser', 'fein', 'feine',
  'grob', 'grobe', 'warm', 'kalt', 'weich', 'hart', 'reif', 'bio', 'ganz',
  'ganze', 'halb', 'halbe', 'mittel', 'etwas', 'etwa', 'ca', 'evtl', 'optional',
  'prise', 'prisen', 'stück', 'stücke', 'scheibe', 'scheiben', 'dose', 'dosen',
  'packung', 'packungen', 'bund', 'el', 'tl', 'kg', 'ml',
]);

const WORD_SPLIT = /[^a-zà-ÿ0-9]+/;

function norm(s: string): string {
  return s.toLowerCase().replace(/ß/g, 'ss').trim();
}

/**
 * Strip one common German plural/inflection suffix so singular ↔ plural
 * compare equal. Guarded to never bite into short words (≤4 chars) or leave a
 * stem under 3 chars, which keeps "Salz"/"Ei"/"Öl" intact.
 */
function stem(w: string): string {
  if (w.length <= 4) return w;
  const m = w.match(/^(.*?)(?:nen|en|er|n|e|s)$/);
  if (m && m[1].length >= 3) return m[1];
  return w;
}

function wordMatches(cand: string, word: string): boolean {
  if (cand === word) return true;
  if (stem(cand) === stem(word)) return true;
  // Compound head: a step word that begins with a longer ingredient token
  // ("Knoblauch" → "Knoblauchzehe"). Length gate avoids "Ei" → "Eintopf".
  if (cand.length >= 5 && word.startsWith(cand)) return true;
  return false;
}

function candidates(name: string): string[] {
  const n = norm(name);
  const out = new Set<string>();
  // De-hyphenated / de-spaced whole name catches "Räucherlachs" written solid.
  const collapsed = n.replace(/[\s-]+/g, '');
  if (collapsed.length >= 4) out.add(collapsed);
  for (const w of n.split(WORD_SPLIT)) {
    if (w.length >= 3 && !QUALIFIERS.has(w) && !QUALIFIERS.has(stem(w))) out.add(w);
  }
  return [...out];
}

function stepTokens(text: string): Set<string> {
  const n = norm(text);
  const toks = new Set<string>();
  for (const w of n.split(WORD_SPLIT)) if (w) toks.add(w);
  // Second pass with hyphens removed so "Räucher-Lachs" also yields the solid
  // "räucherlachs" token (and any other hyphenated compound).
  for (const w of n.replace(/-/g, '').split(WORD_SPLIT)) if (w) toks.add(w);
  return toks;
}

/**
 * Ids of the ingredients mentioned in `stepText`. Empty set when nothing
 * matches — the caller then shows the full list un-muted.
 */
export function mentionedIngredientIds<T extends { id: number; name: string }>(
  stepText: string,
  ingredients: T[],
): Set<number> {
  const tokens = stepTokens(stepText);
  const matched = new Set<number>();
  for (const ing of ingredients) {
    for (const cand of candidates(ing.name)) {
      let hit = false;
      for (const w of tokens) {
        if (wordMatches(cand, w)) { hit = true; break; }
      }
      if (hit) { matched.add(ing.id); break; }
    }
  }
  return matched;
}
