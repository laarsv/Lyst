/** Lightweight duplicate-item detection for list items.
 *
 *  Two passes:
 *    1. Normalize each item's text — lowercase, strip leading quantity
 *       fragments ("2 Tomaten" → "tomaten"), drop common plural endings
 *       so "Tomate" / "Tomaten" collapse, and trim punctuation/whitespace.
 *    2. Bucket by Levenshtein distance: items in the same normalized
 *       bucket plus close-but-not-identical neighbors (≤ 2 edits) join
 *       a group.
 *
 *  Designed to be conservative — false negatives are fine, false positives
 *  destroy data. The user always confirms per group before anything is
 *  merged on the server.
 */
import type { ListItem } from '@/types';

export interface DuplicateGroup {
  /** The item we'd keep — picked as the most "complete" of the group
   *  (longest text, most likely to have the user's preferred spelling). */
  primary: ListItem;
  /** Items the user would discard if they confirm — quantities can be
   *  summed into `primary` first. */
  duplicates: ListItem[];
  /** Pre-computed merged values so the modal can preview without doing
   *  the work twice. */
  merged: {
    text: string;
    quantity: number | null;
    unit: string | null;
  };
}

/** Normalise an item's text into a comparison key. */
function normalize(text: string): string {
  let s = text.trim().toLowerCase();
  // Strip leading "200g " / "2 " / "1,5kg " — anything starting with a digit.
  s = s.replace(/^[\d.,]+\s*[a-zäöüß]*\s*/, '');
  // Collapse internal whitespace.
  s = s.replace(/\s+/g, ' ');
  // Drop trailing common plural endings — German + English (cheap heuristic).
  s = s.replace(/(en|er|s|n)$/i, '');
  return s.trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1).fill(0);
  const cur = new Array(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function pickPrimary(items: ListItem[]): ListItem {
  // Longest text wins (more likely the user's preferred form). Tiebreak by
  // having quantity (more "complete"), then by oldest id.
  return [...items].sort((a, b) => {
    if (b.text.length !== a.text.length) return b.text.length - a.text.length;
    if ((b.quantity !== null ? 1 : 0) !== (a.quantity !== null ? 1 : 0)) {
      return (b.quantity !== null ? 1 : 0) - (a.quantity !== null ? 1 : 0);
    }
    return a.id - b.id;
  })[0];
}

function mergeFields(items: ListItem[]): {
  text: string;
  quantity: number | null;
  unit: string | null;
} {
  const primary = pickPrimary(items);
  // Sum quantities where ALL items share the same unit (or all have no
  // unit). Mixing units silently is a footgun — better to drop quantity
  // than to lie about it.
  const units = new Set(items.map((i) => i.unit ?? ''));
  if (units.size === 1) {
    const sum = items.reduce(
      (acc, i) => (i.quantity !== null ? acc + i.quantity : acc),
      0,
    );
    const anyHasQty = items.some((i) => i.quantity !== null);
    return {
      text: primary.text,
      quantity: anyHasQty ? Math.round(sum * 100) / 100 : null,
      unit: primary.unit,
    };
  }
  // Mixed units — keep primary's quantity/unit as-is, don't try to merge.
  return {
    text: primary.text,
    quantity: primary.quantity,
    unit: primary.unit,
  };
}

/** Find groups of likely duplicates in `items`. Items not part of any
 *  group are simply omitted. Each returned group contains ≥ 2 items. */
export function findDuplicateGroups(items: ListItem[]): DuplicateGroup[] {
  if (items.length < 2) return [];

  // First pass: bucket by normalized key.
  const buckets = new Map<string, ListItem[]>();
  for (const it of items) {
    const k = normalize(it.text);
    if (!k) continue;
    const arr = buckets.get(k) ?? [];
    arr.push(it);
    buckets.set(k, arr);
  }

  // Second pass: merge buckets whose keys are within 2 Levenshtein edits.
  // Cheap O(b²) — fine for typical list sizes (< 100 items, < 50 keys).
  const keys = [...buckets.keys()];
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let cur = k;
    while ((parent.get(cur) ?? cur) !== cur) cur = parent.get(cur)!;
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      // Skip the costly distance check when lengths are too different.
      if (Math.abs(keys[i].length - keys[j].length) > 2) continue;
      if (levenshtein(keys[i], keys[j]) <= 2) union(keys[i], keys[j]);
    }
  }

  const merged = new Map<string, ListItem[]>();
  for (const k of keys) {
    const root = find(k);
    const arr = merged.get(root) ?? [];
    arr.push(...buckets.get(k)!);
    merged.set(root, arr);
  }

  const groups: DuplicateGroup[] = [];
  for (const arr of merged.values()) {
    if (arr.length < 2) continue;
    const primary = pickPrimary(arr);
    groups.push({
      primary,
      duplicates: arr.filter((i) => i.id !== primary.id),
      merged: mergeFields(arr),
    });
  }
  // Stable order: groups with the most duplicates first.
  groups.sort((a, b) => b.duplicates.length - a.duplicates.length);
  return groups;
}
