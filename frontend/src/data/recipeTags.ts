/** Default tag suggestions surfaced in the recipe-edit tag picker.
 *
 *  These are HINTS, not enforced — users freely create custom tags. The
 *  groups exist so the UI can show them with subtle separators in the
 *  suggestion dropdown. The first six (meal types) double as the default
 *  filter chips on the Recipes overview when a recipe library is empty
 *  enough that no other tags are in use yet.
 *
 *  Migration note: alembic 0011 turned the old RecipeCategory enum
 *  values into recipe tags using these German labels — keep the meal-type
 *  group in sync with that mapping to avoid orphaned tags. */

export interface SuggestedTagGroup {
  label: string;
  tags: string[];
}

export const SUGGESTED_RECIPE_TAGS: SuggestedTagGroup[] = [
  {
    label: 'Mahlzeit',
    tags: ['Frühstück', 'Mittagessen', 'Abendessen', 'Snack', 'Dessert', 'Getränk'],
  },
  {
    label: 'Ernährung',
    tags: ['Vegetarisch', 'Vegan'],
  },
  {
    label: 'Praktisch',
    tags: ['Schnell', 'Meal Prep', 'Gäste'],
  },
];

/** Flat list of all suggestions — handy for the datalist fallback and for
 *  the filter-bar "default chips" when no recipe yet uses any tag. */
export const ALL_SUGGESTED_RECIPE_TAGS: string[] = SUGGESTED_RECIPE_TAGS.flatMap(
  (g) => g.tags,
);

/** The meal-type tags specifically — used to order the filter chip bar so
 *  these always come first (matching the old fixed enum's UX). */
export const MEAL_TYPE_TAGS: string[] =
  SUGGESTED_RECIPE_TAGS[0]?.tags ?? [];
