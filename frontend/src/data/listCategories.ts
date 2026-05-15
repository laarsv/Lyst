/** Per-type list category sets — single source of truth for the
 *  category grouping headers, manual-override dropdown, and icon map.
 *
 *  Keep these strings byte-identical with
 *  `backend/app/services/category_service.py` (CATEGORIES_SHOPPING /
 *  CATEGORIES_PACKING) — the categorizer writes the German labels
 *  straight into the DB column and the frontend looks them up here
 *  to pick an icon. Any drift breaks the grouping.
 *
 *  CHECKLIST has no fixed taxonomy (categories come from the AI list
 *  generator at creation time), and CUSTOM lists have no categorization
 *  at all — `categoriesForType` returns null for both, and the
 *  ListSettingsPanel / SortableItem render branches handle that.
 */
import {
  Apple,
  Beef,
  Cookie,
  Droplet,
  Dumbbell,
  FileText,
  Footprints,
  Luggage,
  Milk,
  MoreHorizontal,
  Package,
  Pill,
  Shirt,
  Smartphone,
  Snowflake,
  Sparkles,
  Wheat,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import type { ListType } from '@/types';

const SHOPPING_ICONS: Record<string, LucideIcon> = {
  'Obst & Gemüse': Apple,
  Milchprodukte: Milk,
  Tiefkühl: Snowflake,
  Backwaren: Wheat,
  'Fleisch & Fisch': Beef,
  Getränke: Wine,
  Trockenwaren: Package,
  Süßes: Cookie,
  Hygiene: Sparkles,
  Sonstiges: MoreHorizontal,
};

const PACKING_ICONS: Record<string, LucideIcon> = {
  Kleidung: Shirt,
  Schuhe: Footprints,
  'Hygiene & Pflege': Droplet,
  Elektronik: Smartphone,
  Dokumente: FileText,
  Medikamente: Pill,
  'Sport & Freizeit': Dumbbell,
  Reiseausstattung: Luggage,
  Sonstiges: MoreHorizontal,
};

/** Display order matches the backend's CATEGORIES_* lists. The icon map
 *  preserves insertion order in modern JS so `Object.keys(...)` is the
 *  canonical order for both grouping headers and the dropdown. */
export const CATEGORIES_SHOPPING = Object.keys(SHOPPING_ICONS);
export const CATEGORIES_PACKING = Object.keys(PACKING_ICONS);

/** Return the fixed category set for the list type, or null if the type
 *  doesn't carry one. UI branches: hide the override dropdown / Settings
 *  toggle when this returns null. */
export function categoriesForType(t: ListType | null | undefined): string[] | null {
  if (t === 'SHOPPING') return CATEGORIES_SHOPPING;
  if (t === 'PACKING') return CATEGORIES_PACKING;
  return null;
}

/** Per-type icon lookup. The fallback `MoreHorizontal` catches any
 *  category the backend writes that we don't yet have an icon for —
 *  shouldn't happen in normal operation but keeps the UI from crashing
 *  on an unknown string. */
export function iconForCategory(t: ListType | null | undefined, category: string): LucideIcon {
  if (t === 'PACKING') return PACKING_ICONS[category] ?? MoreHorizontal;
  return SHOPPING_ICONS[category] ?? MoreHorizontal;
}

/** Convenience: full icon map for a list type, used by CategoryGroupedList
 *  to drive both the order AND the icon in one pass. Returns null for
 *  types that don't categorize. */
export function categoryIconMapForType(
  t: ListType | null | undefined,
): Record<string, LucideIcon> | null {
  if (t === 'SHOPPING') return SHOPPING_ICONS;
  if (t === 'PACKING') return PACKING_ICONS;
  return null;
}
