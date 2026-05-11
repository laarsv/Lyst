export type Role = 'admin' | 'user';
export type ListType = 'SHOPPING' | 'PACKING' | 'CHECKLIST' | 'CUSTOM';
export type CollaboratorPermission = 'VIEW' | 'EDIT';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  email_verified: boolean;
  last_login: string | null;
  created_at: string;
}

export interface AdminUser extends User {
  list_count: number;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  role: Role;
  user_id: number;
  name: string;
  email: string;
}

export interface ListSummary {
  id: number;
  title: string;
  type: ListType;
  description: string | null;
  color: string | null;
  icon: string | null;
  owner_id: number;
  is_template: boolean;
  template_name: string | null;
  share_enabled: boolean;
  share_token: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
  checked_count: number;
  is_owner: boolean;
  permission: CollaboratorPermission | null;
}

export interface ListItem {
  id: number;
  list_id: number;
  text: string;
  is_checked: boolean;
  quantity: number | null;
  unit: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Collaborator {
  user_id: number;
  email: string;
  name: string;
  permission: CollaboratorPermission;
}

export interface Reminder {
  id: number;
  list_id: number;
  user_id: number;
  remind_at: string;
  message: string | null;
  sent: boolean;
  created_at: string;
}

export interface Note {
  id: number;
  owner_id: number;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  owner_id: number;
  name: string;
  color: string | null;
  created_at: string;
}

export interface ShareInfo {
  share_token: string;
  share_url: string;
  qr_code_png_base64: string;
}

export interface PublicListData {
  title: string;
  type: ListType;
  description: string | null;
  color: string | null;
  icon: string | null;
  updated_at: string;
  items: Array<{
    id: number;
    text: string;
    is_checked: boolean;
    quantity: number | null;
    unit: string | null;
    position: number;
  }>;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
}

export type RecipeCategory =
  | 'BREAKFAST'
  | 'LUNCH'
  | 'DINNER'
  | 'SNACK'
  | 'DESSERT'
  | 'DRINK'
  | 'OTHER';

export interface RecipeIngredient {
  id: number;
  recipe_id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  position: number;
  calories_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
}

export interface NutritionTotals {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface RecipeStep {
  id: number;
  recipe_id: number;
  description: string;
  position: number;
}

export interface RecipeBase {
  title: string;
  description: string | null;
  servings: number;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  category: RecipeCategory;
  image_url: string | null;
  source_url: string | null;
  tags: string[];
}

export interface RecipeSummary extends RecipeBase {
  id: number;
  owner_id: number;
  created_at: string;
  updated_at: string;
  ingredient_count: number;
}

export interface Recipe extends RecipeBase {
  id: number;
  owner_id: number;
  created_at: string;
  updated_at: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  nutrition_per_serving: NutritionTotals;
}

export interface CopyToListResponse {
  list_id: number;
  list_title: string;
  items_added: number;
}

export interface ImportedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface ImportedStep {
  description: string;
  position: number | null;
}

export type LlmProvider = 'ollama' | 'anthropic';

export interface OllamaModel {
  name: string;
  model?: string;
  size?: number;
  modified_at?: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

export interface AnthropicModel {
  id: string;
  name: string;
  description: string;
}

export interface OllamaInfo {
  models: OllamaModel[];
  selected: string;
  is_override: boolean;
  env_default: string;
  base_url: string;
  error: string | null;
}

export interface AnthropicInfo {
  models: AnthropicModel[];
  selected: string;
  is_override: boolean;
  env_default: string;
  has_api_key: boolean;
}

export interface LlmSettings {
  provider: LlmProvider;
  ollama: OllamaInfo;
  anthropic: AnthropicInfo;
}

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

export interface MealPlanEntry {
  id: number;
  meal_plan_id: number;
  recipe_id: number;
  day_of_week: number; // 0=Monday..6=Sunday
  meal_type: MealType;
  servings: number;
  recipe_title: string;
  recipe_category: RecipeCategory;
  recipe_image_url: string | null;
  recipe_servings: number;
  recipe_prep_time_minutes: number | null;
  recipe_cook_time_minutes: number | null;
}

export interface MealPlan {
  id: number;
  owner_id: number;
  week_start: string; // ISO date
  created_at: string;
  entries: MealPlanEntry[];
}

export interface GenerateListResponse {
  list_id: number;
  list_title: string;
  items_added: number;
}

export interface ImportedRecipe {
  title: string;
  description: string | null;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  category: RecipeCategory;
  source_url: string | null;
  ingredients: ImportedIngredient[];
  steps: ImportedStep[];
}
