import type { MealType } from '@/types';

/** German labels for the meal-plan slots. Shared by the meal planner grid and
 *  the "Heute" overview so both name the same slot identically. */
export const MEAL_LABEL: Record<MealType, string> = {
  BREAKFAST: 'Frühstück',
  LUNCH: 'Mittag',
  DINNER: 'Abend',
  SNACK: 'Snack',
};

/** The backend sends the enum NAME (e.g. "DINNER"); fall back to the raw
 *  value if an unknown slot ever shows up rather than rendering nothing. */
export function mealLabel(type: string): string {
  return MEAL_LABEL[type as MealType] ?? type;
}
