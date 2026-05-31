/** Default tag suggestions for the plant-edit "Bereich" picker.
 *
 *  Mirrors recipeTags.ts: HINTS, not enforced — users freely create custom
 *  tags. Reuses the same SuggestedTagGroup shape so the shared TagInput
 *  component renders them identically. "Bereich" groups the physical area a
 *  plant lives in (distinct from the light enum "Lichtverhältnisse"). */
import type { SuggestedTagGroup } from '@/data/recipeTags';

export const SUGGESTED_PLANT_TAGS: SuggestedTagGroup[] = [
  {
    label: 'Bereich',
    tags: ['Wohnung', 'Balkon', 'Garten', 'Terrasse', 'Küche', 'Büro', 'Bad'],
  },
];

/** Flat list of all suggestions — used for filter-bar default chips when no
 *  plant yet carries any tag. */
export const ALL_SUGGESTED_PLANT_TAGS: string[] = SUGGESTED_PLANT_TAGS.flatMap(
  (g) => g.tags,
);

/** Bereich tags specifically — used to order the filter chip bar so they
 *  lead (mirrors MEAL_TYPE_TAGS on the recipes overview). */
export const BEREICH_TAGS: string[] = SUGGESTED_PLANT_TAGS[0]?.tags ?? [];
