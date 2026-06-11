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

/** Owner-side share summary for the small share icon on overview
 *  cards. `null` on rows the viewer doesn't own (shared-with-me) so
 *  the frontend can distinguish "not loaded" from "owner-side count
 *  = 0". `internal_count` is collaborators/recipients; `public` is
 *  the anyone-with-URL token. */
export interface ShareState {
  internal_count: number;
  public: boolean;
  /** Recipe-only: true when the owner has any active recipe-book
   *  share. Every recipe they own is then reachable to those book
   *  recipients, independent of per-recipe RecipeShare rows. */
  via_book?: boolean;
}

/** Row of GET /me/share-suggestions — people the current user has
 *  shared anything with before, deduped + ordered by recency. */
export interface ShareSuggestion {
  id: number;
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
  share_state: ShareState | null;
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
  // Task layer (alembic 0018). Any of (assignee_id, due_at, reminder_at)
  // being non-null means the user has upgraded this item to a task —
  // the per-item popover and the /tasks aggregator key on that.
  assignee_id: number | null;
  assignee_name: string | null;
  due_at: string | null;
  reminder_at: string | null;
  reminder_sent: boolean;
}

/** Backend `task_items` row — one per <li data-type="taskItem"> in a
 *  note's TipTap doc. Surfaced via /notes/{id}/tasks + the global
 *  /tasks aggregator. */
export interface NoteTask {
  id: number;
  note_id: number;
  text: string;
  is_done: boolean;
  position: number;
  assignee_id: number | null;
  assignee_name: string | null;
  due_at: string | null;
  reminder_at: string | null;
  reminder_sent: boolean;
  created_at: string;
  updated_at: string;
}

/** Wire shape of GET /tasks. `source` discriminates whether `id`
 *  refers to a list_items row or a task_items row. */
export interface AggregatedTask {
  id: number;
  source: 'list' | 'note';
  source_id: number;
  source_title: string;
  owner_id: number;
  text: string;
  is_done: boolean;
  assignee_id: number | null;
  assignee_name: string | null;
  due_at: string | null;
  reminder_at: string | null;
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
  /** Backend-computed plain-text preview of `content`. Used by the
   *  notes overview card (NoteCard) so the frontend doesn't have to
   *  parse HTML. ~120 chars with an ellipsis when truncated. */
  snippet: string;
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
  /** Owner-side share summary. Null on shared-with-me rows. */
  share_state: ShareState | null;
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

export type NutritionSource = 'usda' | 'off' | 'ai' | 'manual';

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
  fiber_per_100g: number | null;
  sugar_per_100g: number | null;
  salt_per_100g: number | null;
  /** Provenance of the seven per-100g fields. null = no values yet
   *  (distinct from "manual" = user filled by hand). The source badge
   *  on each ingredient row reads this. */
  nutrition_source: NutritionSource | null;
  /** OFF barcode the row was filled from. Only set when
   *  nutrition_source === "off". Used by "Werte aktualisieren" to
   *  re-fetch the same product. */
  off_product_code: string | null;
  /** USDA FoodData Central food id. Only set when
   *  nutrition_source === "usda". Parallel role to off_product_code
   *  but for the raw-ingredient source. */
  usda_fdc_id: string | null;
}

export interface NutritionTotalsValues {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
  salt: number | null;
}

export interface NutritionCoverage {
  /** Number of ingredients that actually contributed to the totals
   *  (have nutrition values AND a convertible quantity/unit). */
  counted: number;
  /** Total number of ingredients on the recipe. counted < total
   *  drives the "Basiert auf X von Y Zutaten" hint with edit link. */
  total: number;
}

export interface NutritionAggregate {
  per_serving: NutritionTotalsValues;
  total: NutritionTotalsValues;
  coverage: NutritionCoverage;
  /** True iff any contributing ingredient uses source="ai". The
   *  recipe-detail card appends "(geschätzt)" to the heading. */
  is_estimate: boolean;
  servings: number;
}

// ---------- Nutrition lookup (v1.3.0) ----------

export interface NutritionValues {
  calories_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  fiber_per_100g: number | null;
  sugar_per_100g: number | null;
  salt_per_100g: number | null;
}

export interface NutritionSearchHit {
  name: string;
  brand: string | null;
  /** OFF barcode for OFF hits; empty string on USDA hits (USDA rows
   *  aren't barcoded — `fdc_id` is the identifier instead). */
  code: string;
  image_url: string | null;
  nutrition: NutritionValues;
  /** USDA FoodData Central food id — set only on USDA hits. */
  fdc_id: string | null;
}

export interface NutritionSearchGroup {
  /** 'usda' (Lebensmittel) or 'off' (Markenprodukte). Drives the
   *  per-row badge icon in the picker. */
  source: 'usda' | 'off';
  /** German display heading, ready to render as a section title. */
  label: string;
  results: NutritionSearchHit[];
}

export interface NutritionSearchResponse {
  /** Grouped results — USDA first (raw ingredients), OFF second
   *  (branded products). Empty groups are omitted entirely so the
   *  UI can iterate without length checks. */
  groups: NutritionSearchGroup[];
  /** True iff lookup is disabled by env flag OR every configured
   *  upstream failed — distinct from "found nothing". UI shows
   *  "Aktuell nicht erreichbar, KI oder manuell verwenden". */
  unavailable: boolean;
}

export interface NutritionEstimateResponse {
  nutrition: NutritionValues;
  /** Short German note from the model — surfaced as italic helper
   *  text in the Nährwerte sheet. */
  note: string | null;
}

// ---------- Bulk nutrition fill (v1.5.1) ----------

export interface NutritionFillAllItem {
  ingredient_id: number;
  name: string;
  /** 'filled' / 'not_found' / 'skipped' / 'deferred'. */
  status: 'filled' | 'not_found' | 'skipped' | 'deferred';
  /** Source on a filled row: 'usda' / 'off' / 'ai'. Null otherwise. */
  source: 'usda' | 'off' | 'ai' | null;
}

export interface NutritionFillAllResponse {
  results: NutritionFillAllItem[];
  filled: number;
  not_found: number;
  skipped: number;
  /** Rows that hit the OFF rate-budget — retry shortly. */
  deferred: number;
  total: number;
}

export interface RecipeStep {
  id: number;
  recipe_id: number;
  description: string;
  position: number;
}

/** Provenance bucket (computed server-side from source + source_url) — drives
 *  the source badge and the origin filter. */
export type RecipeOrigin = 'structured_import' | 'ai_variant' | 'ai_import' | 'manual';

export interface RecipeBase {
  title: string;
  description: string | null;
  servings: number;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  image_url: string | null;
  source_url: string | null;
  tags: string[];
  /** Owner-set polish (alembic 0028). 0 = noch nicht bewertet, 1–5 = stars. */
  rating: number;
  is_favorite: boolean;
}

export interface RecipeSummary extends RecipeBase {
  id: number;
  owner_id: number;
  created_at: string;
  updated_at: string;
  ingredient_count: number;
  /** Denormalised cook-history caches (alembic 0028) the overview sorts on. */
  cooked_count: number;
  last_cooked_at: string | null;
  /** AI-variant link (alembic 0029). source === 'ai_variant' on generated
   *  variants — drives the "nur Originale" overview filter. */
  parent_recipe_id: number | null;
  source: string | null;
  /** Computed provenance bucket (see RecipeOrigin). */
  origin: RecipeOrigin;
  /** null when the current user owns the recipe; "individual" or "book"
   *  when the recipe was shared via alembic 0012's internal-share rows. */
  share_source: 'individual' | 'book' | null;
  /** Display name of the owner — only set when share_source is non-null. */
  owner_name: string | null;
  /** Owner-side share summary. Null on shared-with-me rows. */
  share_state: ShareState | null;
}

export interface Recipe extends RecipeBase {
  id: number;
  owner_id: number;
  created_at: string;
  updated_at: string;
  cooked_count: number;
  last_cooked_at: string | null;
  parent_recipe_id: number | null;
  source: string | null;
  origin: RecipeOrigin;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  /** Per-portion + total + coverage block. Replaces the old
   *  `nutrition_per_serving` (v1.5+) so the detail page can toggle
   *  between per-portion and whole-recipe values. */
  nutrition: NutritionAggregate;
  share_enabled: boolean;
  share_token: string | null;
  /** Recipient-perspective fields. share_source drives the "is this
   *  someone else's recipe" check; share_permission decides what a
   *  recipient may DO (view-only vs full edit minus delete-resource and
   *  re-share). Owner-side: share_source=null, share_permission='EDIT'. */
  share_source: 'individual' | 'book' | null;
  owner_name: string | null;
  share_permission: CollaboratorPermission | null;
  /** Owner-side share summary. Null on shared-with-me rows. */
  share_state: ShareState | null;
}

/** One cook-history entry (alembic 0028) — GET /recipes/{id}/cook-log. */
export interface CookLog {
  id: number;
  recipe_id: number;
  cooked_at: string;
  notes: string | null;
}

// ---------- Plants (Pflanzen module, alembic 0023) ----------

export type PlantLocation = 'SONNIG' | 'HALBSCHATTEN' | 'SCHATTEN';

export interface Plant {
  id: number;
  owner_id: number;
  name: string;
  species: string | null;
  location: PlantLocation;
  /** null = tracked but no watering reminder fires. */
  watering_interval_days: number | null;
  watering_note: string | null;
  fertilize: boolean;
  fertilize_interval_days: number | null;
  winterhardy: boolean;
  edible: boolean;
  height_cm: number | null;
  width_cm: number | null;
  image_url: string | null;
  notes: string | null;
  tags: string[];
  /** Seasonal/month-based care (1–12). Fertilizing is season-driven (annual
   *  reminder at fertilize_start_month); prune_month drives an annual reminder;
   *  bloom window is info. */
  fertilize_start_month: number | null;
  fertilize_end_month: number | null;
  prune_month: number | null;
  bloom_start_month: number | null;
  bloom_end_month: number | null;
  last_watered_at: string | null;
  /** Log only ("Zuletzt gedüngt") — fertilizing no longer has an interval. */
  last_fertilized_at: string | null;
  created_at: string;
  updated_at: string;
  /** Computed server-side as last_watered_at + interval; null when unset.
   *  water_due flips true once that moment has passed. */
  next_water_due: string | null;
  water_due: boolean;
  /** fertilize_in_season: current month is inside the fertilize window.
   *  prune_due: current month == prune_month. */
  fertilize_in_season: boolean;
  prune_due: boolean;
}

/** GET /plants/due — plants whose watering is overdue or due within 7 days.
 *  Fertilizing/pruning are annual/seasonal and don't appear here. */
export interface PlantDue {
  water: Plant[];
}

/** POST /plants/prefill — advisory, AI-suggested values for the create form.
 *  `ok=false` means "couldn't determine" (show `note`, stay manual). Edibility
 *  is hint-only via edible_suggestion/edible_note — never the real `edible`. */
export interface PlantPrefill {
  ok: boolean;
  note: string | null;
  species: string | null;
  suggested_name: string | null;
  location: PlantLocation | null;
  watering_interval_days: number | null;
  fertilize: boolean;
  winterhardy: boolean;
  height_cm: number | null;
  width_cm: number | null;
  fertilize_start_month: number | null;
  fertilize_end_month: number | null;
  prune_month: number | null;
  bloom_start_month: number | null;
  bloom_end_month: number | null;
  edible_suggestion: boolean | null;
  edible_note: string | null;
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

// ---------- Multi-recipe shopping merge ----------

export interface MergeSubQuantity {
  quantity: number | null;
  unit: string | null;
}

export interface MergePreviewItem {
  name: string;
  aisle: string;
  /** One line per distinct unit (compatible units already summed). */
  lines: MergeSubQuantity[];
  /** Contributing recipe titles — provenance shown in the preview only. */
  recipes: string[];
}

export interface MergePreviewSection {
  aisle: string;
  items: MergePreviewItem[];
}

export interface MergePreviewResponse {
  sections: MergePreviewSection[];
  item_count: number;
}

// ---------- AI ingredient substitutions ----------

export type SubstitutionContext =
  | 'vegan'
  | 'glutenfrei'
  | 'laktosefrei'
  | 'nussfrei'
  | 'milder'
  | 'günstiger';

export interface SubstitutionItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  rationale: string;
}

export interface SubstitutionResponse {
  substitutions: SubstitutionItem[];
  note: string | null;
}

// ---------- AI recipe variants ----------

export type VariantTarget =
  | 'vegan'
  | 'glutenfrei'
  | 'laktosefrei'
  | 'nussfrei'
  | 'light'
  | 'schnell';

/** Compact child-variant row for the detail "Varianten" section. */
export interface VariantOut {
  id: number;
  title: string;
  image_url: string | null;
  tags: string[];
  source: string | null;
}

// ---------- Picnic .eml import ----------

export interface EmlImportResult {
  status: 'created' | 'duplicate' | 'unrecognized' | 'error';
  recipe_id: number | null;
  title: string | null;
  message: string;
}

export interface EmlBatchItem extends EmlImportResult {
  filename: string | null;
}

export interface EmlBatchResponse {
  results: EmlBatchItem[];
  imported: number;
  duplicates: number;
  unrecognized: number;
  errors: number;
}

export interface ImportedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  /** Pre-filled by the backend's post-extraction OFF lookup. Null on
   *  ingredients OFF doesn't know about — user can request a
   *  KI-Schätzung from the ingredient row after the import lands. */
  calories_per_100g?: number | null;
  protein_per_100g?: number | null;
  carbs_per_100g?: number | null;
  fat_per_100g?: number | null;
  fiber_per_100g?: number | null;
  sugar_per_100g?: number | null;
  salt_per_100g?: number | null;
  nutrition_source?: NutritionSource | null;
  off_product_code?: string | null;
  usda_fdc_id?: string | null;
}

export interface ImportedStep {
  description: string;
  position: number | null;
}

// ---------- Fitness (alembic 0027) ----------

export type ExerciseType = 'AUFBAU' | 'DEHNEN' | 'PHYSIO';
export type ExerciseLocation = 'STUDIO' | 'HOME' | 'BEIDES';
export type TrackingType = 'REPS' | 'WEIGHT_REPS' | 'TIME';

export interface Exercise {
  id: number;
  /** null = global seed (read-only for everyone). */
  owner_id: number | null;
  name: string;
  muscle_group: string;
  type: ExerciseType;
  location: ExerciseLocation;
  tracking_type: TrackingType;
  instructions: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  is_global: boolean;
  editable: boolean;
}

export interface WorkoutExercise {
  id: number;
  workout_id: number;
  exercise_id: number;
  position: number;
  target_sets: number | null;
  target_reps: number | null;
  target_weight: number | null;
  notes: string | null;
  exercise: Exercise;
}

export interface WorkoutSummary {
  id: number;
  owner_id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  exercise_count: number;
}

export interface Workout {
  id: number;
  owner_id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  exercises: WorkoutExercise[];
}

export interface SetLog {
  id: number;
  session_id: number;
  exercise_id: number;
  set_number: number;
  reps_done: number | null;
  weight_done: number | null;
  duration_done: number | null;
  completed: boolean;
}

export interface Session {
  id: number;
  owner_id: number;
  workout_id: number | null;
  started_at: string;
  finished_at: string | null;
  notes: string | null;
  sets: SetLog[];
}

export interface SessionSummary {
  id: number;
  workout_id: number | null;
  workout_name: string | null;
  started_at: string;
  finished_at: string | null;
  set_count: number;
}

export interface LastSetValue {
  set_number: number;
  reps_done: number | null;
  weight_done: number | null;
  duration_done: number | null;
}

export interface LastValues {
  session_id: number | null;
  performed_at: string | null;
  sets: LastSetValue[];
}

export interface HistoryPoint {
  date: string;
  weight: number | null;
  reps: number | null;
  duration: number | null;
}

export interface ExerciseHistory {
  tracking_type: TrackingType;
  points: HistoryPoint[];
}

export type LlmProvider = 'ollama' | 'anthropic';

export interface OllamaModel {
  name: string;
  model?: string;
  size?: number;
  modified_at?: string;
  /** Backend-computed vision-capability flag (from /api/tags families). */
  vision?: boolean;
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
  /** Vision model (photo import) — separate selection from the text model. */
  vision_selected: string;
  vision_is_override: boolean;
  vision_env_default: string;
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

export interface ExtractedImage {
  data_base64: string;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
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
  /** Recipe hero image extracted from the source (URL og:image,
   *  JSON-LD, largest <img>, PDF embedded image, or the photo
   *  itself for photo imports). Null when extraction failed or the
   *  source had no usable image (typical free-text path). */
  extracted_image: ExtractedImage | null;
}
