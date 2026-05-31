import { api } from './client';
import type {
  AdminUser,
  AggregatedTask,
  AiGeneratedList,
  AiMissingItem,
  AiSuggestedIngredient,
  AiSuggestedStep,
  AuthResponse,
  CategorizationMode,
  Collaborator,
  CollaboratorPermission,
  CopyToListResponse,
  GenerateListResponse,
  ImportedRecipe,
  ListItem,
  ListSnapshot,
  LlmProvider,
  LlmSettings,
  OllamaStatus,
  ListSummary,
  ListType,
  MealPlan,
  MealPlanEntry,
  MealType,
  Note,
  NoteFolder,
  NoteTask,
  NoteVersionFull,
  NoteVersionListItem,
  NutritionEstimateResponse,
  NutritionFillAllResponse,
  NutritionSearchResponse,
  NutritionSource,
  Plant,
  PlantDue,
  PlantLocation,
  PublicListData,
  PublicNoteData,
  InternalShare,
  Recipe,
  PublicRecipeBookData,
  PublicRecipeData,
  RecipeIngredient,
  RecipeStep,
  RecipeSummary,
  Reminder,
  RestoreSnapshotResponse,
  ShareByEmailResponse,
  ShareInfo,
  ShareSuggestion,
  Tag,
  User,
} from '@/types';

const unwrap = <T,>(r: { data: { data: T } }): T => r.data.data;

export const AuthApi = {
  login: (email: string, password: string) =>
    api.post<{ data: AuthResponse }>('/auth/login', { email, password }).then(unwrap),
  logout: () => api.post('/auth/logout'),
  refresh: () =>
    api.post<{ data: { access_token: string } }>('/auth/refresh').then(unwrap),
  resetRequest: (email: string) =>
    api.post('/auth/reset-password/request', { email }),
  resetConfirm: (token: string, new_password: string) =>
    api.post('/auth/reset-password/confirm', { token, new_password }),
  acceptInvite: (token: string, name: string, password: string) =>
    api.post('/auth/accept-invite', { token, name, password }),
};

export const MeApi = {
  get: () => api.get<{ data: User }>('/me').then(unwrap),
  update: (payload: {
    name?: string;
    email?: string;
    current_password?: string;
    new_password?: string;
  }) => api.patch<{ data: User }>('/me', payload).then(unwrap),
  /** People the current user has shared anything with before, deduped
   *  and ordered by recency. Powers the "Zuletzt geteilt mit" chips
   *  in the share panels. */
  shareSuggestions: () =>
    api.get<{ data: ShareSuggestion[] }>('/me/share-suggestions').then(unwrap),
};

export const AdminApi = {
  listUsers: (q?: string) =>
    api.get<{ data: AdminUser[] }>('/admin/users', { params: q ? { q } : {} }).then(unwrap),
  createUser: (payload: { email: string; name: string; password: string; role: 'admin' | 'user' }) =>
    api
      .post<{ data: { user: User; temp_password: string } }>('/admin/users', payload)
      .then(unwrap),
  inviteUser: (payload: { email: string; name: string; role: 'admin' | 'user' }) =>
    api.post<{ data: User }>('/admin/users/invite', payload).then(unwrap),
  updateUser: (id: number, payload: Partial<{ name: string; email: string; is_active: boolean; role: 'admin' | 'user' }>) =>
    api.patch<{ data: User }>(`/admin/users/${id}`, payload).then(unwrap),
  resetPassword: (id: number) => api.post(`/admin/users/${id}/reset-password`),
  deleteUser: (id: number) => api.delete(`/admin/users/${id}`),
  getLlmSettings: () =>
    api.get<{ data: LlmSettings }>('/admin/llm').then(unwrap),
  setLlmProvider: (provider: LlmProvider) =>
    api.put<{ data: { provider: LlmProvider } }>('/admin/llm/provider', { provider }).then(unwrap),
  setOllamaModel: (model: string | null) =>
    api
      .put<{ data: { selected: string; is_override: boolean } }>('/admin/llm/ollama-model', { model })
      .then(unwrap),
  setAnthropicModel: (model: string | null) =>
    api
      .put<{ data: { selected: string; is_override: boolean } }>('/admin/llm/anthropic-model', { model })
      .then(unwrap),
  sendTestEmail: (to?: string) =>
    api
      .post<{ data: { to: string; message: string } }>('/admin/test-email', { to: to || null })
      .then(unwrap),
  getOllamaStatus: () =>
    api.get<{ data: OllamaStatus }>('/admin/ollama-status').then(unwrap),
};

export const ListsApi = {
  list: () => api.get<{ data: ListSummary[] }>('/lists').then(unwrap),
  templates: () => api.get<{ data: ListSummary[] }>('/lists/templates').then(unwrap),
  get: (id: number) => api.get<{ data: ListSummary }>(`/lists/${id}`).then(unwrap),
  create: (payload: { title: string; type: ListType; description?: string; color?: string; icon?: string }) =>
    api.post<{ data: ListSummary }>('/lists', payload).then(unwrap),
  update: (
    id: number,
    payload: Partial<{
      title: string;
      description: string;
      color: string;
      icon: string;
      type: ListType;
      categorization_mode: CategorizationMode;
    }>,
  ) => api.patch<{ data: ListSummary }>(`/lists/${id}`, payload).then(unwrap),
  categorize: (id: number, force = false) =>
    api
      .post<{ data: { queued: number; total: number } }>(
        `/lists/${id}/categorize`,
        null,
        { params: { force } },
      )
      .then(unwrap),
  remove: (id: number) => api.delete(`/lists/${id}`),
  duplicate: (id: number, payload: { title?: string; as_template?: boolean; template_name?: string }) =>
    api.post<{ data: ListSummary }>(`/lists/${id}/duplicate`, payload).then(unwrap),
  reset: (id: number) => api.post(`/lists/${id}/reset`),
};

// AI assist for lists (Features 2, 4) — kept on ListsApi since they belong
// to the lists resource conceptually.
declare module './client' {}

export const AiListsApi = {
  missingItems: (listId: number) =>
    api
      .post<{ data: AiMissingItem[] }>(`/lists/${listId}/ai/missing-items`)
      .then(unwrap),
  generate: (type: ListType, goal: string) =>
    api
      .post<{ data: AiGeneratedList }>('/lists/ai/generate', { type, goal })
      .then(unwrap),
  findDuplicates: (listId: number) =>
    api
      .post<{ data: { item_ids: number[] }[] }>(`/lists/${listId}/ai/find-duplicates`)
      .then(unwrap),
};

export const ItemsApi = {
  list: (listId: number) =>
    api.get<{ data: ListItem[] }>(`/lists/${listId}/items`).then(unwrap),
  create: (
    listId: number,
    text: string,
    extras: Partial<{ quantity: number | null; unit: string | null }> = {},
  ) => api.post<{ data: ListItem }>(`/lists/${listId}/items`, { text, ...extras }).then(unwrap),
  bulk: (listId: number, lines: string[]) =>
    api.post<{ data: ListItem[] }>(`/lists/${listId}/items/bulk`, { lines }).then(unwrap),
  bulkStructured: (
    listId: number,
    items: { text: string; quantity?: number | null; unit?: string | null }[],
  ) =>
    api
      .post<{ data: ListItem[] }>(`/lists/${listId}/items/bulk`, { items })
      .then(unwrap),
  update: (
    listId: number,
    itemId: number,
    payload: Partial<{
      text: string;
      is_checked: boolean;
      quantity: number | null;
      unit: string | null;
      category: string | null;
      assignee_id: number | null;
      due_at: string | null;
      reminder_at: string | null;
    }>,
  ) =>
    api.patch<{ data: ListItem }>(`/lists/${listId}/items/${itemId}`, payload).then(unwrap),
  remove: (listId: number, itemId: number) =>
    api.delete(`/lists/${listId}/items/${itemId}`),
  reorder: (listId: number, items: { id: number; position: number }[]) =>
    api.patch(`/lists/${listId}/items/reorder`, { items }),
};

/** CRUD for the task_items table behind every <li data-type="taskItem">
 *  in a note's TipTap doc. The editor's node-view diffs these against
 *  the doc on every save (create new, delete missing, patch text). */
export const NoteTasksApi = {
  list: (noteId: number) =>
    api.get<{ data: NoteTask[] }>(`/notes/${noteId}/tasks`).then(unwrap),
  create: (
    noteId: number,
    payload: Partial<{ text: string; is_done: boolean; position: number }>,
  ) =>
    api.post<{ data: NoteTask }>(`/notes/${noteId}/tasks`, payload).then(unwrap),
  update: (
    noteId: number,
    taskId: number,
    payload: Partial<{
      text: string;
      is_done: boolean;
      position: number;
      assignee_id: number | null;
      due_at: string | null;
      reminder_at: string | null;
    }>,
  ) =>
    api
      .patch<{ data: NoteTask }>(`/notes/${noteId}/tasks/${taskId}`, payload)
      .then(unwrap),
  remove: (noteId: number, taskId: number) =>
    api.delete(`/notes/${noteId}/tasks/${taskId}`),
};

/** Global aggregator. Drives /tasks page. */
export const TasksApi = {
  list: (params?: {
    scope?: 'mine' | 'assigned_to_me' | 'all';
    status?: 'open' | 'done' | 'overdue' | 'today' | 'this_week' | 'all';
  }) =>
    api
      .get<{ data: AggregatedTask[] }>('/tasks', { params })
      .then(unwrap),
};

export const ShareApi = {
  enable: (listId: number) =>
    api.post<{ data: ShareInfo }>(`/lists/${listId}/share/enable`).then(unwrap),
  disable: (listId: number) => api.post(`/lists/${listId}/share/disable`),
  getPublic: (token: string) =>
    api.get<{ data: PublicListData }>(`/share/${token}`).then(unwrap),
  collaborators: (listId: number) =>
    api.get<{ data: Collaborator[] }>(`/lists/${listId}/collaborators`).then(unwrap),
  addCollaborator: (listId: number, email: string, permission: CollaboratorPermission) =>
    api
      .post<{ data: Collaborator }>(`/lists/${listId}/collaborators`, { email, permission })
      .then(unwrap),
  removeCollaborator: (listId: number, userId: number) =>
    api.delete(`/lists/${listId}/collaborators/${userId}`),
};

export const RemindersApi = {
  list: (listId: number) =>
    api.get<{ data: Reminder[] }>(`/lists/${listId}/reminders`).then(unwrap),
  create: (listId: number, remind_at: string, message?: string) =>
    api
      .post<{ data: Reminder }>(`/lists/${listId}/reminders`, { remind_at, message })
      .then(unwrap),
  remove: (listId: number, reminderId: number) =>
    api.delete(`/lists/${listId}/reminders/${reminderId}`),
};

export const NotesApi = {
  list: (params?: {
    q?: string;
    tag?: string;
    folder_id?: number;
    uncategorized?: boolean;
    archived?: boolean;
  }) => api.get<{ data: Note[] }>('/notes', { params }).then(unwrap),
  get: (id: number) => api.get<{ data: Note }>(`/notes/${id}`).then(unwrap),
  create: (payload: {
    title: string;
    content?: string;
    tags?: string[];
    folder_id?: number | null;
    is_pinned?: boolean;
  }) => api.post<{ data: Note }>('/notes', payload).then(unwrap),
  update: (
    id: number,
    payload: Partial<{
      title: string;
      content: string;
      tags: string[];
      folder_id: number | null;
      is_pinned: boolean;
      is_archived: boolean;
    }>,
  ) => api.patch<{ data: Note }>(`/notes/${id}`, payload).then(unwrap),
  remove: (id: number) => api.delete(`/notes/${id}`),
  versions: (id: number) =>
    api.get<{ data: NoteVersionListItem[] }>(`/notes/${id}/versions`).then(unwrap),
  version: (id: number, versionId: number) =>
    api
      .get<{ data: NoteVersionFull }>(`/notes/${id}/versions/${versionId}`)
      .then(unwrap),
  restoreVersion: (id: number, versionId: number) =>
    api
      .post<{ data: Note }>(`/notes/${id}/versions/${versionId}/restore`)
      .then(unwrap),

  // ----- AI assist (Features 6, 7, 8) -----
  aiSummarize: (id: number) =>
    api.post<{ data: { summary: string } }>(`/notes/${id}/ai/summarize`).then(unwrap),
  aiTitle: (id: number) =>
    api.post<{ data: { title: string } }>(`/notes/${id}/ai/title`).then(unwrap),
  aiTags: (id: number) =>
    api.post<{ data: { tags: string[] } }>(`/notes/${id}/ai/tags`).then(unwrap),

  // ----- Sharing (alembic 0013, permission added in 0014) -----
  shareEnable: (id: number) =>
    api.post<{ data: ShareInfo }>(`/notes/${id}/share/enable`).then(unwrap),
  shareDisable: (id: number) =>
    api.post(`/notes/${id}/share/disable`),
  shareByEmail: (id: number, email: string, permission: CollaboratorPermission = 'VIEW') =>
    api
      .post<{ data: ShareByEmailResponse }>(`/notes/${id}/share/email`, { email, permission })
      .then(unwrap),
  listShares: (id: number) =>
    api.get<{ data: InternalShare[] }>(`/notes/${id}/shares`).then(unwrap),
  /** Owner: flip a recipient between VIEW and EDIT. */
  patchShare: (id: number, userId: number, permission: CollaboratorPermission) =>
    api.patch(`/notes/${id}/shares/${userId}`, { permission }),
  revokeShare: (id: number, userId: number) =>
    api.delete(`/notes/${id}/shares/${userId}`),
  /** Recipient leaves a share that was granted to them. */
  leaveShare: (id: number) =>
    api.delete(`/notes/${id}/shares/me`),
  /** Users the current viewer can @-mention in this note (owner + share
   *  recipients, minus self). Drives the "Personen" half of the
   *  @-popover. Permission filter is enforced server-side. */
  mentionableUsers: (id: number, q?: string) =>
    api
      .get<{ data: MentionableUser[] }>(`/notes/${id}/mentionable_users`, {
        params: q ? { q } : {},
      })
      .then(unwrap),
  // Public read (no auth — same path scheme as recipes).
  getPublic: (token: string) =>
    api.get<{ data: PublicNoteData }>(`/share/note/${token}`).then(unwrap),
};

export interface MentionableUser {
  id: number;
  name: string;
  email: string;
}

export interface NoteTitleResult {
  id: number;
  title: string;
}
export interface SearchResults {
  query: string;
  notes: Array<{
    id: number;
    title: string;
    snippet: string;
    folder_id: number | null;
    is_pinned: boolean;
    tags: string[];
  }>;
  lists: Array<{
    id: number;
    title: string;
    icon: string | null;
    color: string | null;
    type: string;
    matched_item: string | null;
  }>;
  recipes: Array<{
    id: number;
    title: string;
    image_url: string | null;
    snippet: string | null;
    matched_ingredient: string | null;
    tags: string[];
  }>;
}

export const SearchApi = {
  global: (q: string) =>
    api.get<{ data: SearchResults }>('/search', { params: { q } }).then(unwrap),
  noteTitles: (q: string, limit = 8) =>
    api
      .get<{ data: NoteTitleResult[] }>('/notes/search', { params: { q, limit } })
      .then(unwrap),
  noteBacklinks: (noteId: number) =>
    api
      .get<{ data: NoteTitleResult[] }>(`/notes/${noteId}/backlinks`)
      .then(unwrap),
};

export const NoteFoldersApi = {
  list: () => api.get<{ data: NoteFolder[] }>('/note-folders').then(unwrap),
  create: (name: string, color?: string | null) =>
    api.post<{ data: NoteFolder }>('/note-folders', { name, color }).then(unwrap),
  update: (id: number, payload: Partial<{ name: string; color: string | null }>) =>
    api.patch<{ data: NoteFolder }>(`/note-folders/${id}`, payload).then(unwrap),
  remove: (id: number) => api.delete(`/note-folders/${id}`),
};

export const RecipesApi = {
  list: (params?: { q?: string; tag?: string }) =>
    api.get<{ data: RecipeSummary[] }>('/recipes', { params }).then(unwrap),
  get: (id: number) => api.get<{ data: Recipe }>(`/recipes/${id}`).then(unwrap),
  create: (payload: {
    title: string;
    description?: string | null;
    servings: number;
    prep_time_minutes?: number | null;
    cook_time_minutes?: number | null;
    image_url?: string | null;
    source_url?: string | null;
    tags?: string[];
    ingredients?: Array<{
      name: string;
      quantity?: number | null;
      unit?: string | null;
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
    }>;
    steps?: Array<{ description: string }>;
  }) => api.post<{ data: Recipe }>('/recipes', payload).then(unwrap),
  update: (
    id: number,
    payload: Partial<{
      title: string;
      description: string | null;
      servings: number;
      prep_time_minutes: number | null;
      cook_time_minutes: number | null;
      image_url: string | null;
      source_url: string | null;
      tags: string[];
    }>,
  ) => api.patch<{ data: Recipe }>(`/recipes/${id}`, payload).then(unwrap),
  remove: (id: number) => api.delete(`/recipes/${id}`),
  duplicate: (id: number, title?: string) =>
    api.post<{ data: Recipe }>(`/recipes/${id}/duplicate`, { title }).then(unwrap),

  // ----- AI assist (Features 1, 3) -----
  aiSuggestIngredients: (id: number, request: string) =>
    api
      .post<{ data: AiSuggestedIngredient[] }>(
        `/recipes/${id}/ai/suggest-ingredients`,
        { request },
      )
      .then(unwrap),
  aiSuggestSteps: (id: number, request: string) =>
    api
      .post<{ data: AiSuggestedStep[] }>(`/recipes/${id}/ai/suggest-steps`, { request })
      .then(unwrap),
  aiVariation: (id: number, variation: string) =>
    api
      .post<{ data: ImportedRecipe }>(`/recipes/${id}/ai/variation`, { variation })
      .then(unwrap),
  aiTags: (id: number) =>
    api.post<{ data: { tags: string[] } }>(`/recipes/${id}/ai/tags`).then(unwrap),

  uploadImage: (id: number, file: File, onProgress?: (pct: number) => void) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<{ data: Recipe }>(`/recipes/${id}/image`, fd, {
        // axios sets the multipart boundary automatically when the body is
        // a FormData; explicitly setting Content-Type would strip it.
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        },
      })
      .then(unwrap);
  },
  removeImage: (id: number) =>
    api.delete<{ data: Recipe }>(`/recipes/${id}/image`).then(unwrap),

  // share
  shareEnable: (id: number) =>
    api.post<{ data: ShareInfo }>(`/recipes/${id}/share/enable`).then(unwrap),
  shareDisable: (id: number) =>
    api.post(`/recipes/${id}/share/disable`),
  shareBookEnable: () =>
    api.post<{ data: ShareInfo }>('/recipes/share-book/enable').then(unwrap),
  shareBookDisable: () =>
    api.post('/recipes/share-book/disable'),
  // public reads (no auth)
  getPublic: (token: string) =>
    api.get<{ data: PublicRecipeData }>(`/share/recipe/${token}`).then(unwrap),
  getPublicBook: (token: string) =>
    api.get<{ data: PublicRecipeBookData }>(`/share/recipe-book/${token}`).then(unwrap),

  // ----- Internal sharing by email (alembic 0012, permissions in 0014) -----
  shareByEmail: (id: number, email: string, permission: CollaboratorPermission = 'VIEW') =>
    api
      .post<{ data: ShareByEmailResponse }>(`/recipes/${id}/share/email`, { email, permission })
      .then(unwrap),
  listShares: (id: number) =>
    api.get<{ data: InternalShare[] }>(`/recipes/${id}/shares`).then(unwrap),
  patchShare: (id: number, userId: number, permission: CollaboratorPermission) =>
    api.patch(`/recipes/${id}/shares/${userId}`, { permission }),
  revokeShare: (id: number, userId: number) =>
    api.delete(`/recipes/${id}/shares/${userId}`),
  /** Recipient leaves an individual recipe share. */
  leaveShare: (id: number) =>
    api.delete(`/recipes/${id}/shares/me`),

  shareBookByEmail: (email: string, permission: CollaboratorPermission = 'VIEW') =>
    api
      .post<{ data: ShareByEmailResponse }>('/recipes/share-book/email', { email, permission })
      .then(unwrap),
  listBookShares: () =>
    api.get<{ data: InternalShare[] }>('/recipes/share-book/shares').then(unwrap),
  patchBookShare: (userId: number, permission: CollaboratorPermission) =>
    api.patch(`/recipes/share-book/shares/${userId}`, { permission }),
  revokeBookShare: (userId: number) =>
    api.delete(`/recipes/share-book/shares/${userId}`),
  /** Recipient leaves a whole-book share by the given owner — drops every
   *  recipe shared via that owner's book in one shot. */
  leaveBookShare: (ownerId: number) =>
    api.delete(`/recipes/share-book/shares/me/${ownerId}`),

  // ingredients
  addIngredient: (
    recipeId: number,
    payload: {
      name: string;
      quantity?: number | null;
      unit?: string | null;
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
    },
  ) =>
    api.post<{ data: RecipeIngredient }>(`/recipes/${recipeId}/ingredients`, payload).then(unwrap),
  updateIngredient: (
    recipeId: number,
    ingId: number,
    payload: Partial<{
      name: string;
      quantity: number | null;
      unit: string | null;
      calories_per_100g: number | null;
      protein_per_100g: number | null;
      carbs_per_100g: number | null;
      fat_per_100g: number | null;
      fiber_per_100g: number | null;
      sugar_per_100g: number | null;
      salt_per_100g: number | null;
      nutrition_source: NutritionSource | null;
      off_product_code: string | null;
      usda_fdc_id: string | null;
    }>,
  ) =>
    api
      .patch<{ data: RecipeIngredient }>(`/recipes/${recipeId}/ingredients/${ingId}`, payload)
      .then(unwrap),
  removeIngredient: (recipeId: number, ingId: number) =>
    api.delete(`/recipes/${recipeId}/ingredients/${ingId}`),
  reorderIngredients: (recipeId: number, items: { id: number; position: number }[]) =>
    api.patch(`/recipes/${recipeId}/ingredients/reorder`, { items }),

  // steps
  addStep: (recipeId: number, description: string) =>
    api.post<{ data: RecipeStep }>(`/recipes/${recipeId}/steps`, { description }).then(unwrap),
  updateStep: (recipeId: number, stepId: number, description: string) =>
    api
      .patch<{ data: RecipeStep }>(`/recipes/${recipeId}/steps/${stepId}`, { description })
      .then(unwrap),
  removeStep: (recipeId: number, stepId: number) =>
    api.delete(`/recipes/${recipeId}/steps/${stepId}`),
  reorderSteps: (recipeId: number, items: { id: number; position: number }[]) =>
    api.patch(`/recipes/${recipeId}/steps/reorder`, { items }),

  importFromUrl: (url: string) =>
    api
      .post<{ data: ImportedRecipe }>('/recipes/import-url', { url })
      .then(unwrap),
  importFromPhoto: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<{ data: ImportedRecipe }>('/recipes/import-photo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(unwrap);
  },
  /** Unified import endpoint. Accepts an image / HTML / PDF file or
   *  a free-text body. The backend dispatches on the Content-Type
   *  and the file's own type, returning the same ImportedRecipe
   *  shape as the URL / photo endpoints. */
  importFromFile: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<{ data: ImportedRecipe }>('/recipes/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(unwrap);
  },
  importFromText: (text: string) =>
    api
      .post<{ data: ImportedRecipe }>('/recipes/import', { text })
      .then(unwrap),
  suggest: (available_ingredients: string[]) =>
    api
      .post<{ data: { suggestions: Array<{ recipe_id: number; title: string; reason: string }> } }>(
        '/recipes/suggest',
        { available_ingredients },
      )
      .then(unwrap),

  // killer feature
  copyToList: (
    recipeId: number,
    payload: {
      list_id: number | null;
      new_list_title?: string;
      servings: number;
      ingredient_ids?: number[];
    },
  ) =>
    api
      .post<{ data: CopyToListResponse }>(`/recipes/${recipeId}/copy-to-list`, payload)
      .then(unwrap),

  // ----- Nutrition lookup (v1.3.0) -----
  /** Top 5 Open Food Facts candidates for the query. `unavailable=true`
   *  means OFF is disabled by env flag OR unreachable — distinct from
   *  "found nothing". The Nährwerte sheet shows the right empty-state
   *  copy based on this flag. */
  searchNutrition: (q: string) =>
    api
      .get<{ data: NutritionSearchResponse }>('/recipes/ingredients/nutrition-search', {
        params: { q },
      })
      .then(unwrap),
  /** Local Ollama estimate. Always resolves with a payload — the
   *  model surfaces a German note in `note` when it can't make a
   *  confident guess, so the sheet has something to show before
   *  falling back to manual entry. */
  estimateNutrition: (name: string, hint?: string) =>
    api
      .post<{ data: NutritionEstimateResponse }>('/recipes/ingredients/nutrition-estimate', {
        name,
        ...(hint ? { hint } : {}),
      })
      .then(unwrap),
  /** Bulk-fill nutrition for every (or only empty / only-listed)
   *  ingredient of a recipe. USDA-first, OFF-fallback,
   *  optionally AI for the still-missing. Mirrors the per-ingredient
   *  sheet's logic in one round-trip. */
  fillAllNutrition: (
    recipeId: number,
    payload: {
      mode?: 'fill_empty' | 'refill_all';
      use_ai_fallback?: boolean;
      ingredient_ids?: number[];
    } = {},
  ) =>
    api
      .post<{ data: NutritionFillAllResponse }>(
        `/recipes/${recipeId}/ingredients/nutrition-fill-all`,
        payload,
      )
      .then(unwrap),
};

type PlantWritePayload = {
  name: string;
  species?: string | null;
  location: PlantLocation;
  watering_interval_days?: number | null;
  watering_note?: string | null;
  fertilize: boolean;
  fertilize_interval_days?: number | null;
  winterhardy: boolean;
  edible: boolean;
  height_cm?: number | null;
  width_cm?: number | null;
  image_url?: string | null;
  notes?: string | null;
};

export const PlantsApi = {
  list: (params?: { q?: string }) =>
    api.get<{ data: Plant[] }>('/plants', { params }).then(unwrap),
  /** Plants overdue or due within the next 7 days, split water/fertilize. */
  due: () => api.get<{ data: PlantDue }>('/plants/due').then(unwrap),
  get: (id: number) => api.get<{ data: Plant }>(`/plants/${id}`).then(unwrap),
  create: (
    // last_*_at: the optional "Zuletzt gegossen/gedüngt" dates. Omit to let
    // the backend start the cycle at now().
    payload: PlantWritePayload & {
      last_watered_at?: string | null;
      last_fertilized_at?: string | null;
    },
  ) => api.post<{ data: Plant }>('/plants', payload).then(unwrap),
  update: (id: number, payload: Partial<PlantWritePayload>) =>
    api.patch<{ data: Plant }>(`/plants/${id}`, payload).then(unwrap),
  remove: (id: number) => api.delete(`/plants/${id}`),
  /** "Gegossen" — stamps last_watered_at=now and arms the next reminder. */
  water: (id: number) => api.post<{ data: Plant }>(`/plants/${id}/water`).then(unwrap),
  /** "Gedüngt" — stamps last_fertilized_at=now and arms the next reminder. */
  fertilize: (id: number) => api.post<{ data: Plant }>(`/plants/${id}/fertilize`).then(unwrap),
  uploadImage: (id: number, file: File, onProgress?: (pct: number) => void) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<{ data: Plant }>(`/plants/${id}/image`, fd, {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      })
      .then(unwrap);
  },
  removeImage: (id: number) =>
    api.delete<{ data: Plant }>(`/plants/${id}/image`).then(unwrap),
};

export const SnapshotsApi = {
  list: (listId: number) =>
    api.get<{ data: ListSnapshot[] }>(`/lists/${listId}/snapshots`).then(unwrap),
  restore: (listId: number, snapshotId: number) =>
    api
      .post<{ data: RestoreSnapshotResponse }>(`/lists/${listId}/snapshots/${snapshotId}/restore`)
      .then(unwrap),
};

export const MealPlansApi = {
  /** Returns the plan for the week containing `weekStart` (auto-creates if missing). */
  forWeek: (weekStart: string) =>
    api
      .get<{ data: MealPlan }>('/meal-plans', { params: { week_start: weekStart } })
      .then(unwrap),
  addEntry: (
    planId: number,
    payload: { recipe_id: number; day_of_week: number; meal_type: MealType; servings: number },
  ) =>
    api
      .post<{ data: MealPlanEntry }>(`/meal-plans/${planId}/entries`, payload)
      .then(unwrap),
  updateEntry: (
    planId: number,
    entryId: number,
    payload: Partial<{ day_of_week: number; meal_type: MealType; servings: number }>,
  ) =>
    api
      .patch<{ data: MealPlanEntry }>(`/meal-plans/${planId}/entries/${entryId}`, payload)
      .then(unwrap),
  removeEntry: (planId: number, entryId: number) =>
    api.delete(`/meal-plans/${planId}/entries/${entryId}`),
  generateList: (planId: number) =>
    api
      .post<{ data: GenerateListResponse }>(`/meal-plans/${planId}/generate-shopping-list`)
      .then(unwrap),
};

export const TagsApi = {
  list: () => api.get<{ data: Tag[] }>('/tags').then(unwrap),
  create: (name: string, color?: string) =>
    api.post<{ data: Tag }>('/tags', { name, color }).then(unwrap),
  remove: (id: number) => api.delete(`/tags/${id}`),
};

// ---------- Notifications (alembic 0019) ----------

export type NotificationKind =
  | 'share_created'
  | 'mention'
  | 'task_assigned'
  | 'task_reminder';

export interface NotificationRow {
  id: number;
  kind: NotificationKind | string;
  // Per-kind shape — see backend notification_service.py docstring.
  // Kept loose here because individual call sites narrow it themselves.
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  items: NotificationRow[];
  unread_count: number;
}

export const NotificationsApi = {
  list: () =>
    api
      .get<{ data: NotificationListResponse }>('/notifications')
      .then(unwrap),
  markRead: (id: number) =>
    api.patch<{ data: { message: string } }>(`/notifications/${id}/read`).then(unwrap),
  markAllRead: () =>
    api.post<{ data: { updated: number } }>('/notifications/mark-all-read').then(unwrap),
};
