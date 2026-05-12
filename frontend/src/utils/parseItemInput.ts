/** Splits free-form item input ("200g Käse", "2 Pack Butter") into
 *  quantity + unit + text.
 *
 *  Deliberately conservative: if the line doesn't start with a digit, we
 *  return the whole input as text (so "Bio Milch" stays "Bio Milch", not
 *  q=null/u="Bio"/t="Milch").
 *
 *  Order of attempts:
 *    1. number + word + rest  → unit-bearing form
 *    2. number + rest         → quantity-only form ("3 Eier")
 *  If neither matches, no parse — the whole input is the text. */
import { normalizeUnit } from './units';

export interface ParsedItem {
  quantity: number | null;
  unit: string | null;
  text: string;
}

// `\s*` between number and word so "200g Käse" parses the same as "200 g Käse".
// `\s+` between word and rest so "200ml" alone never matches (we need text).
const RE_WITH_UNIT = /^(\d+(?:[.,]\d+)?)\s*([A-Za-zÄÖÜäöüß.]+)\s+(.+)$/;
const RE_QTY_ONLY = /^(\d+(?:[.,]\d+)?)\s+(.+)$/;

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function parseItem(input: string): ParsedItem {
  const raw = input.trim();
  if (!raw) return { quantity: null, unit: null, text: '' };

  // Bail early when there's no leading digit — keeps "Bio Milch" intact.
  if (!/^\d/.test(raw)) {
    return { quantity: null, unit: null, text: raw };
  }

  const m1 = raw.match(RE_WITH_UNIT);
  if (m1) {
    const [, numStr, word, rest] = m1;
    const quantity = Number(numStr.replace(',', '.'));
    if (Number.isFinite(quantity)) {
      const canonical = normalizeUnit(word);
      // Either a known alias → canonical form, or a free-form word → keep
      // capitalized. Spec: "treat the word as a free-form unit (capitalize
      // first letter)".
      const unit = canonical ?? capitalize(word);
      return { quantity, unit, text: rest.trim() };
    }
  }

  const m2 = raw.match(RE_QTY_ONLY);
  if (m2) {
    const [, numStr, rest] = m2;
    const quantity = Number(numStr.replace(',', '.'));
    if (Number.isFinite(quantity)) {
      return { quantity, unit: null, text: rest.trim() };
    }
  }

  // Leading digit but no recognizable shape (e.g. just "200"): no parse.
  return { quantity: null, unit: null, text: raw };
}

/** True when the parser actually extracted something useful from the input —
 *  used by the live preview to decide whether to render. */
export function hasParse(p: ParsedItem): boolean {
  return p.quantity !== null || p.unit !== null;
}

/** Human-readable preview string: "200 g · Käse" / "2 Pack · Butter". */
export function formatPreview(p: ParsedItem): string {
  const left: string[] = [];
  if (p.quantity !== null) left.push(formatQty(p.quantity));
  if (p.unit) left.push(p.unit);
  const leftStr = left.join(' ');
  if (!p.text) return leftStr;
  return leftStr ? `${leftStr} · ${p.text}` : p.text;
}

function formatQty(q: number): string {
  // Show "1,5" not "1.5" — German UI; show "200" not "200.0".
  if (Number.isInteger(q)) return String(q);
  return q.toString().replace('.', ',');
}
