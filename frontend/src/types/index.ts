export type Role = 'admin' | 'user';
export type ListType = 'SHOPPING' | 'PACKING' | 'CHECKLIST' | 'CUSTOM';
export type CategorizationMode = 'OFF' | 'MANUAL' | 'AUTO';
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
  categorization_mode: CategorizationMode;
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
  category: string | null;
  category_locked: boolean;
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

/** Storage format of Note.content. Transitional column added by
 *  alembic 0016. New notes are always 'HTML' (TipTap output);
 *  'MARKDOWN' only appears on rows that haven't yet been processed by
 *  `scripts/migrate_notes_to_html.py`. Frontend branches on this to
 *  pick the right renderer. */
export type NoteContentFormat = 'MARKDOWN' | 'HTML';

export interface Note {
  id: number;
  owner_id: number;
  title: string;
  content: string;
  content_format: NoteContentFormat;
  tags: string[];
  folder_id: number | null;
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  // Public sharing — alembic 0013.
  share_enabled: boolean;
  share_token: string | null;
  // Recipient-perspective fields. share_source="individual" when the
  // current user is viewing a note someone else shared with them.
  share_source: 'individual' | null;
  owner_name: string | null;
  /** Effective permission for the current viewer. Owner -> 'EDIT'; for
   *  recipients it's whatever the share row carries (alembic 0014). */
  share_permission: CollaboratorPermission | null;
}

export interface PublicNoteData {
  title: string;
  content: string;
  content_format: NoteContentFormat;
  tags: string[];
  updated_at: string;
}

export interface NoteFolder {
  id: number;
  owner_id: number;
  name: string;
  color: string | null;
  created_at: string;
  note_count: number;
}

export interface NoteVersionListItem {
  id: number;
  note_id: number;
  title: string;
  preview: string;
  created_at: string;
}

export interface NoteVersionFull {
  id: number;
  note_id: number;
  title: string;
  content: string;
  created_at: string;
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

// Recipe categorisation switched from a fixed enum to free-form tags in
// alembic 0011 — the meal-type buckets were migrated into recipes.tags.
// (RecipeCategory was the old enum type; kept removed here so call sites
// either use string-based tag filters or break loudly at compile time.)

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
  /** null when the current user owns the recipe; "individual" or "book"
   *  when the recipe was shared via alembic 0012's internal-share rows. */
  share_source: 'individual' | 'book' | null;
  /** Display name of the owner — only set when share_source is non-null. */
  owner_name: string | null;
}

export interface Recipe extends RecipeBase {
  id: number;
  owner_id: number;
  created_at: string;
  updated_at: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  nutrition_per_serving: NutritionTotals;
  share_enabled: boolean;
  share_token: string | null;
  /** Recipient-perspective fields. share_source drives the "is this
   *  someone else's recipe" check; share_permission decides what a
   *  recipient may DO (view-only vs full edit minus delete-resource and
   *  re-share). Owner-side: share_source=null, share_permission='EDIT'. */
  share_source: 'individual' | 'book' | null;
  owner_name: string | null;
  share_permission: CollaboratorPermission | null;
}

// ---------- Internal sharing (alembic 0012) ----------

export interface ShareByEmailResponse {
  type: 'internal' | 'external';
  /** Only set when type='internal' — the matched user's display name. */
  user_name: string | null;
}

export interface InternalShare {
  user_id: number;
  name: string;
  email: string;
  /** Granted permission for this recipient (alembic 0014). VIEW for
   *  every share row created before the migration. */
  permission: CollaboratorPermission;
  created_at: string;
}

// ---------- Public share payloads (recipe + recipe-book) ----------

export interface PublicRecipeData {
  title: string;
  description: string | null;
  servings: number;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  image_url: string | null;
  source_url: string | null;
  tags: string[];
  updated_at: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
}

export interface PublicRecipeBookEntry {
  id: number;
  title: string;
  image_url: string | null;
  tags: string[];
  servings: number;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  ingredient_count: number;
  /** null when the individual recipe is not also share-enabled. */
  share_token: string | null;
}

export interface PublicRecipeBookData {
  owner_name: string;
  recipes: PublicRecipeBookEntry[];
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

export interface OllamaLoadedModel {
  name?: string;
  model?: string;
  size?: number;
  size_vram?: number;
  expires_at?: string | null;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

export interface OllamaStatus {
  base_url: string;
  configured: {
    text_model: string;
    vision_model: string;
    text_keep_alive: string;
    vision_keep_alive: string;
  };
  loaded: OllamaLoadedModel[];
  error: string | null;
}

export interface ListSnapshot {
  id: number;
  list_id: number;
  created_at: string;
  item_count: number;
  checked_count: number;
}

export interface RestoreSnapshotResponse {
  list_id: number;
  list_title: string;
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
  recipe_tags: string[];
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

// ---------- AI assist (Features 1-4) ----------

/** Recipe ingredient suggestion returned by /recipes/{id}/ai/suggest-ingredients. */
export interface AiSuggestedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
}

/** Recipe step suggestion returned by /recipes/{id}/ai/suggest-steps. */
export interface AiSuggestedStep {
  description: string;
  /** 1-based position in the existing steps list. null = append at end. */
  suggested_position: number | null;
}

/** "Fehlt was?" missing-item suggestion for SHOPPING/PACKING lists. */
export interface AiMissingItem {
  text: string;
}

/** Per-list-item "checklist" of items to be added in the AI list generator. */
export interface AiGeneratedListItem {
  text: string;
  /** Only present for CHECKLIST type — see lists.ai_generate. */
  category?: string | null;
}

export interface AiGeneratedList {
  title: string;
  items: AiGeneratedListItem[];
}

export interface ImportedRecipe {
  title: string;
  description: string | null;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  tags: string[];
  source_url: string | null;
  ingredients: ImportedIngredient[];
  steps: ImportedStep[];
}
