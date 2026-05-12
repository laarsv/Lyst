/** Splits free-form item input ("200g Käse", "2 Pack Butter") into
 *  quantity + unit + text.
 *
 *  Deliberately conservative on two fronts:
 *    1. No leading digit → whole input is the text ("Bio Milch" stays "Bio Milch").
 *    2. The token after the digits is ONLY accepted as a unit if it's in the
 *       canonical list or matches an alias — "200 Bio Milch" therefore parses
 *       as quantity=200 / unit=null / text="Bio Milch", not unit="Bio".
 *
 *  Order of attempts:
 *    1. number directly attached to a unit token ("200g Käse") — only when
 *       the token is a recognized unit.
 *    2. number + space + word + space + rest — only when the word is a
 *       recognized unit; otherwise we fall through.
 *    3. number + rest → quantity-only ("3 Eier", "200 Bio Milch"). */
import { normalizeUnit } from './units';

export interface ParsedItem {
  quantity: number | null;
  unit: string | null;
  text: string;
}

// "200g" — digits glued to a unit token, then a space, then the rest.
const RE_GLUED_UNIT = /^(\d+(?:[.,]\d+)?)([A-Za-zÄÖÜäöüß.]+)\s+(.+)$/;
// "1,5 kg Mehl" — digits, space, a candidate unit token, space, rest.
const RE_SPACED_UNIT = /^(\d+(?:[.,]\d+)?)\s+([A-Za-zÄÖÜäöüß.]+)\s+(.+)$/;
// Fallback: digits, space, rest (no unit at all).
const RE_QTY_ONLY = /^(\d+(?:[.,]\d+)?)\s+(.+)$/;

export function parseItem(input: string): ParsedItem {
  const raw = input.trim();
  if (!raw) return { quantity: null, unit: null, text: '' };

  // Bail early when there's no leading digit — keeps "Bio Milch" intact.
  if (!/^\d/.test(raw)) {
    return { quantity: null, unit: null, text: raw };
  }

  // Glued form: "200g Käse". The token must be a recognized unit, otherwise
  // we don't have a clean way to split (e.g. "200foo Käse" stays unparsed).
  const glued = raw.match(RE_GLUED_UNIT);
  if (glued) {
    const [, numStr, word, rest] = glued;
    const quantity = Number(numStr.replace(',', '.'));
    const canonical = normalizeUnit(word);
    if (Number.isFinite(quantity) && canonical) {
      return { quantity, unit: canonical, text: rest.trim() };
    }
  }

  // Spaced form: "2 Pack Butter". Only treat the word as a unit if it's
  // recognized; "200 Bio Milch" must NOT yield unit="Bio".
  const spaced = raw.match(RE_SPACED_UNIT);
  if (spaced) {
    const [, numStr, word, rest] = spaced;
    const quantity = Number(numStr.replace(',', '.'));
    const canonical = normalizeUnit(word);
    if (Number.isFinite(quantity) && canonical) {
      return { quantity, unit: canonical, text: rest.trim() };
    }
    // Recognized number but unrecognized "unit" word — fall through to the
    // quantity-only branch so the word stays in the item text.
  }

  // Quantity-only: "3 Eier" / "200 Bio Milch".
  const qtyOnly = raw.match(RE_QTY_ONLY);
  if (qtyOnly) {
    const [, numStr, rest] = qtyOnly;
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
