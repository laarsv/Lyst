from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.models.recipe import NutritionSource
from app.schemas.share import ShareState


# --- Ingredients ---

class IngredientBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    quantity: float | None = None
    unit: str | None = Field(default=None, max_length=32)
    calories_per_100g: float | None = Field(default=None, ge=0)
    protein_per_100g: float | None = Field(default=None, ge=0)
    carbs_per_100g: float | None = Field(default=None, ge=0)
    fat_per_100g: float | None = Field(default=None, ge=0)
    fiber_per_100g: float | None = Field(default=None, ge=0)
    sugar_per_100g: float | None = Field(default=None, ge=0)
    salt_per_100g: float | None = Field(default=None, ge=0)
    nutrition_source: NutritionSource | None = None
    off_product_code: str | None = Field(default=None, max_length=32)
    usda_fdc_id: str | None = Field(default=None, max_length=32)


class IngredientCreate(IngredientBase):
    pass


class IngredientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    quantity: float | None = None
    unit: str | None = Field(default=None, max_length=32)
    calories_per_100g: float | None = Field(default=None, ge=0)
    protein_per_100g: float | None = Field(default=None, ge=0)
    carbs_per_100g: float | None = Field(default=None, ge=0)
    fat_per_100g: float | None = Field(default=None, ge=0)
    fiber_per_100g: float | None = Field(default=None, ge=0)
    sugar_per_100g: float | None = Field(default=None, ge=0)
    salt_per_100g: float | None = Field(default=None, ge=0)
    nutrition_source: NutritionSource | None = None
    off_product_code: str | None = Field(default=None, max_length=32)
    usda_fdc_id: str | None = Field(default=None, max_length=32)


class IngredientOut(IngredientBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    position: int


class NutritionTotalsValues(BaseModel):
    """Absolute (not per-100g) macros for either the whole recipe or
    a single serving. Each field is None until at least one ingredient
    contributed a value for that macro — partial coverage still
    renders sensibly."""
    calories: float | None = None
    protein: float | None = None
    carbs: float | None = None
    fat: float | None = None
    fiber: float | None = None
    sugar: float | None = None
    salt: float | None = None


class NutritionCoverage(BaseModel):
    """How many ingredients actually contributed to the totals.

    `counted < total` means some rows were excluded — either they have
    no nutrition values yet, or their quantity/unit couldn't be
    converted to grams (e.g. "1 Bund Petersilie" without a per-Bund
    weight in our table). The frontend shows a "Basiert auf X von Y
    Zutaten" line that links to edit mode."""
    counted: int = 0
    total: int = 0


class NutritionAggregate(BaseModel):
    """Recipe-level nutrition summary derived from ingredient rows.

    Returned on RecipeOut so the detail page can render both
    per-portion and total values plus the coverage hint — the UI
    toggles between the two without a second request.

    `is_estimate` flips true when any contributing ingredient was
    filled from an AI estimate — the heading then shows "(geschätzt)"
    so the user knows the totals carry uncertainty."""
    per_serving: NutritionTotalsValues = Field(default_factory=NutritionTotalsValues)
    total: NutritionTotalsValues = Field(default_factory=NutritionTotalsValues)
    coverage: NutritionCoverage = Field(default_factory=NutritionCoverage)
    is_estimate: bool = False
    servings: int = 1


# --- Steps ---

class StepBase(BaseModel):
    description: str = Field(min_length=1)


class StepCreate(StepBase):
    pass


class StepUpdate(BaseModel):
    description: str | None = Field(default=None, min_length=1)


class StepOut(StepBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    position: int


# --- Reorder ---

class ReorderItem(BaseModel):
    id: int
    position: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


# --- Recipe ---

class RecipeBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    servings: int = Field(default=2, ge=1, le=999)
    prep_time_minutes: int | None = Field(default=None, ge=0)
    cook_time_minutes: int | None = Field(default=None, ge=0)
    image_url: str | None = Field(default=None, max_length=1024)
    source_url: str | None = Field(default=None, max_length=1024)
    tags: list[str] = Field(default_factory=list)
    # Owner-set polish — 0 = noch nicht bewertet.
    rating: int = Field(default=0, ge=0, le=5)
    is_favorite: bool = False


class RecipeCreate(RecipeBase):
    ingredients: list[IngredientCreate] = Field(default_factory=list)
    steps: list[StepCreate] = Field(default_factory=list)


# --- Bulk structured import (no AI) ---

class BulkImportRequest(BaseModel):
    """POST /recipes/bulk-import — already-structured recipes written straight
    to the DB (no Ollama). Reuses RecipeCreate per item; FastAPI validates the
    whole list before the handler runs, so a malformed entry rejects the batch
    (422 names the offending index) and nothing is imported."""
    recipes: list[RecipeCreate] = Field(min_length=1, max_length=500)


class BulkImportResponse(BaseModel):
    imported: int
    recipe_ids: list[int] = Field(default_factory=list)


def recipe_origin(source: str | None, source_url: str | None) -> str:
    """Provenance bucket driving the origin badge:
      structured_import — POST /recipes/bulk-import (no AI)
      ai_variant        — generated variant (source="ai_variant")
      ai_import         — came through the AI import flow (has a source_url)
      manual            — typed in by hand
    """
    if source == "structured_import":
        return "structured_import"
    if source == "ai_variant":
        return "ai_variant"
    if source_url:
        return "ai_import"
    return "manual"


class RecipeUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    servings: int | None = Field(default=None, ge=1, le=999)
    prep_time_minutes: int | None = Field(default=None, ge=0)
    cook_time_minutes: int | None = Field(default=None, ge=0)
    image_url: str | None = Field(default=None, max_length=1024)
    source_url: str | None = Field(default=None, max_length=1024)
    tags: list[str] | None = None
    rating: int | None = Field(default=None, ge=0, le=5)
    is_favorite: bool | None = None


class RecipeSummary(RecipeBase):
    """List view — without ingredients/steps."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    ingredient_count: int = 0
    # Denormalised cook-history caches (alembic 0028) — the overview sorts
    # "zuletzt gekocht / Häufigkeit" on these without a join.
    cooked_count: int = 0
    last_cooked_at: datetime | None = None
    # AI-variant link (alembic 0029) — parent_recipe_id set on variants,
    # source "ai_variant". Drives the "nur Originale" overview filter.
    parent_recipe_id: int | None = None
    source: str | None = None
    # Recipient-perspective fields (alembic 0012). null/empty when the
    # current user owns the row.
    owner_name: str | None = None
    share_source: str | None = None  # "individual" | "book" | None
    # Owner-side share summary. None on shared-with-me rows.
    share_state: ShareState | None = None

    @computed_field
    @property
    def origin(self) -> str:
        return recipe_origin(self.source, self.source_url)


class RecipeOut(RecipeBase):
    """Detail view — with ingredients, steps, and per-serving nutrition totals."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    cooked_count: int = 0
    last_cooked_at: datetime | None = None
    parent_recipe_id: int | None = None
    source: str | None = None
    ingredients: list[IngredientOut] = Field(default_factory=list)
    steps: list[StepOut] = Field(default_factory=list)
    # Renamed from `nutrition_per_serving` in v1.5. The new aggregate
    # carries both per-portion AND total values plus a coverage block
    # (how many ingredients contributed) — the detail page renders a
    # toggle between the two and a "X von Y Zutaten"-hint.
    nutrition: NutritionAggregate = Field(default_factory=NutritionAggregate)
    share_enabled: bool = False
    share_token: str | None = None
    # Recipient-perspective fields. share_source drives the "is this mine?"
    # check; share_permission decides what a recipient may DO (view-only vs
    # full edit minus delete-resource and re-share).
    owner_name: str | None = None
    share_source: str | None = None  # "individual" | "book" | None
    share_permission: "CollaboratorPermission | None" = None
    # Owner-side share summary, mirrors RecipeSummary. Null on rows
    # the viewer doesn't own (a recipient doesn't need to see how
    # many other people have access to the owner's recipe).
    share_state: ShareState | None = None

    @computed_field
    @property
    def origin(self) -> str:
        return recipe_origin(self.source, self.source_url)


# --- Cook history (alembic 0028) ---

class CookLogOut(BaseModel):
    """One row of GET /recipes/{id}/cook-log — the last-N entries panel."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    cooked_at: datetime
    notes: str | None = None


class MarkCookedRequest(BaseModel):
    """POST /recipes/{id}/cook-log — logs a cook and, from the post-cook
    sheet, optionally sets the rating/favorite in the same call."""
    notes: str | None = Field(default=None, max_length=2000)
    rating: int | None = Field(default=None, ge=0, le=5)
    is_favorite: bool | None = None


# --- Public share views (no auth) ---

class PublicRecipe(BaseModel):
    """Recipe payload returned by GET /share/recipe/{token}."""
    title: str
    description: str | None
    servings: int
    prep_time_minutes: int | None
    cook_time_minutes: int | None
    image_url: str | None
    source_url: str | None
    tags: list[str]
    updated_at: datetime
    ingredients: list[IngredientOut]
    steps: list[StepOut]


class PublicRecipeBookEntry(BaseModel):
    """One row in GET /share/recipe-book/{token}'s recipe grid."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    image_url: str | None
    tags: list[str]
    servings: int
    prep_time_minutes: int | None
    cook_time_minutes: int | None
    ingredient_count: int = 0
    # Per-recipe share token so the card can link to the public detail
    # view. Only filled when the recipe itself is also share-enabled —
    # otherwise the recipe-book viewer can see the title but not the
    # detail (matches user expectation that they enable each recipe
    # individually for public deep-linking).
    share_token: str | None = None


class PublicRecipeBook(BaseModel):
    owner_name: str
    recipes: list[PublicRecipeBookEntry]


class RecipeDuplicate(BaseModel):
    title: str | None = None


# --- Copy to shopping list ---

class CopyToListRequest(BaseModel):
    list_id: int | None = None
    new_list_title: str | None = Field(default=None, max_length=255)
    servings: int = Field(ge=1, le=999)
    ingredient_ids: list[int] | None = None


class CopyToListResponse(BaseModel):
    list_id: int
    list_title: str
    items_added: int


# --- Multi-recipe shopping merge ---

class MergeRecipeSelection(BaseModel):
    recipe_id: int
    servings: int = Field(ge=1, le=999)


class MergePreviewRequest(BaseModel):
    recipes: list[MergeRecipeSelection] = Field(min_length=1, max_length=20)


class MergeToListRequest(MergePreviewRequest):
    list_id: int | None = None
    new_list_title: str | None = Field(default=None, max_length=255)


class MergeSubQuantity(BaseModel):
    quantity: float | None = None
    unit: str | None = None


class MergePreviewItem(BaseModel):
    name: str
    aisle: str
    lines: list[MergeSubQuantity] = Field(default_factory=list)
    # Contributing recipe titles — shown as provenance in the preview only
    # (not persisted on the saved list items).
    recipes: list[str] = Field(default_factory=list)


class MergePreviewSection(BaseModel):
    aisle: str
    items: list[MergePreviewItem] = Field(default_factory=list)


class MergePreviewResponse(BaseModel):
    sections: list[MergePreviewSection] = Field(default_factory=list)
    item_count: int = 0


# --- URL import ---

class ImportUrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


# --- Suggest "Was kann ich kochen?" ---

class SuggestRequest(BaseModel):
    available_ingredients: list[str] = Field(min_length=1, max_length=50)


class SuggestionOut(BaseModel):
    recipe_id: int
    title: str
    reason: str


class SuggestResponse(BaseModel):
    suggestions: list[SuggestionOut]


# ---------- AI assist (Feature 1: ingredient/step suggestions) ----------

class AiAssistRequest(BaseModel):
    """Free-text request the user types in the AI suggestion modal."""
    request: str = Field(min_length=1, max_length=500)


class AiSuggestedIngredient(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    quantity: float | None = None
    unit: str | None = Field(default=None, max_length=32)


class AiSuggestedStep(BaseModel):
    description: str = Field(min_length=1)
    suggested_position: int | None = Field(default=None, ge=1)


# ---------- AI variation (Feature 3) ----------

# ---------- AI ingredient substitutions ----------

SubstitutionContext = Literal[
    "vegan", "glutenfrei", "laktosefrei", "nussfrei", "milder", "günstiger"
]


class SubstitutionRequest(BaseModel):
    """Optional dietary/quality lens. null = just good, common substitutes."""
    context: SubstitutionContext | None = None


class SubstitutionItem(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    quantity: float | None = None
    unit: str | None = Field(default=None, max_length=32)
    # Short German rationale (~20 words) — why this swap works.
    rationale: str = Field(default="", max_length=300)


class SubstitutionResponse(BaseModel):
    substitutions: list[SubstitutionItem] = Field(default_factory=list)
    # Friendly note when there's no sensible swap (e.g. "Wasser").
    note: str | None = None


# ---------- AI recipe variants ----------

VariantTarget = Literal["vegan", "glutenfrei", "laktosefrei", "nussfrei", "light", "schnell"]


class VariantRequest(BaseModel):
    targets: list[VariantTarget] = Field(default_factory=list, max_length=6)
    adjustment: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _need_target_or_adjustment(self):
        # The free-text "Sonst noch was?" alone is a valid request, but an
        # entirely empty one isn't.
        if not self.targets and not (self.adjustment and self.adjustment.strip()):
            raise ValueError("Mindestens ein Ziel oder eine Beschreibung angeben")
        return self


class VariantOut(BaseModel):
    """Compact child-variant row for the detail-page 'Varianten' section."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    image_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    source: str | None = None


# ---------- Nutrition lookup (v1.3.0) ----------

class NutritionValues(BaseModel):
    """Per-100g block returned by the lookup endpoints — same seven
    fields the ingredient row stores. All nullable so partial OFF
    entries (e.g. fiber missing) still come through."""
    calories_per_100g: float | None = None
    protein_per_100g: float | None = None
    carbs_per_100g: float | None = None
    fat_per_100g: float | None = None
    fiber_per_100g: float | None = None
    sugar_per_100g: float | None = None
    salt_per_100g: float | None = None


class NutritionSearchHit(BaseModel):
    """One candidate from USDA or Open Food Facts. Which fields are set
    depends on the source: USDA hits carry `fdc_id` and have `brand`/
    `image_url`/`code` left null (FDC Foundation/SR Legacy entries
    aren't branded products); OFF hits carry `code` (barcode) and
    optional `brand` + `image_url` and leave `fdc_id` null."""
    name: str
    brand: str | None = None
    # OFF barcode for OFF hits — persisted to off_product_code. Empty
    # string ("") on USDA hits since OFF needs *some* code on save but
    # USDA hits write to usda_fdc_id instead.
    code: str = ""
    image_url: str | None = None
    nutrition: NutritionValues
    # USDA FoodData Central food ID — set only on USDA hits, persisted
    # to usda_fdc_id when the user picks this row.
    fdc_id: str | None = None


class NutritionSearchGroup(BaseModel):
    """One result group in the grouped search response. The frontend
    renders the `label` as a section heading and each group's rows
    in order. Empty groups are dropped before serialisation."""
    # Stable machine id — 'usda' or 'off'. Drives the badge icon
    # the picker shows next to each row.
    source: str
    # German display heading: 'Lebensmittel' for USDA (raw ingredients)
    # vs 'Markenprodukte' for OFF (branded packaged products).
    label: str
    results: list[NutritionSearchHit] = Field(default_factory=list)


class NutritionSearchResponse(BaseModel):
    # Grouped results — USDA first (raw ingredients), OFF below
    # (branded products). Empty groups are omitted entirely so the UI
    # can iterate without checking lengths.
    groups: list[NutritionSearchGroup] = Field(default_factory=list)
    # True when NUTRITION_LOOKUP_ENABLED is false OR every configured
    # upstream failed/timed out — the frontend shows "Aktuell nicht
    # erreichbar, KI oder manuell verwenden" instead of an empty
    # state. When at least one upstream succeeded with zero hits we
    # leave this False — that's "found nothing", a different message.
    unavailable: bool = False


class NutritionFillAllRequest(BaseModel):
    """POST /recipes/{id}/ingredients/nutrition-fill-all body.

    Modes:
      - "fill_empty" (default): only rows without nutrition values get touched.
      - "refill_all": every row gets re-fetched and overwritten. The
        frontend confirms before submitting this mode so it's not a
        destructive surprise.

    `use_ai_fallback=True` runs the Ollama estimate for rows that USDA
    AND OFF both missed; off by default so AI is always opt-in. The UI
    re-uses this same endpoint with `ingredient_ids` set when the
    user clicks "KI-Schätzung für die fehlenden" — restricts the AI
    fallback to that subset.
    """
    mode: str = Field(default="fill_empty", pattern=r"^(fill_empty|refill_all)$")
    use_ai_fallback: bool = False
    # Optional subset — when provided, only these ingredient_ids are
    # processed. Drives the post-result "AI for the misses" button.
    ingredient_ids: list[int] | None = None


class NutritionFillAllItem(BaseModel):
    """One row in the bulk-fill summary. `status`:
      - "filled":      values stored, `source` set ('usda' | 'off' | 'ai').
      - "not_found":   no upstream hit and AI fallback was off.
      - "skipped":     row was excluded by the mode (e.g. fill_empty +
                       already has values), so nothing happened.
      - "deferred":    OFF rate budget was exhausted; user should retry
                       in a minute or so.
    """
    ingredient_id: int
    name: str
    status: str
    source: str | None = None


class NutritionFillAllResponse(BaseModel):
    results: list[NutritionFillAllItem] = Field(default_factory=list)
    filled: int = 0
    not_found: int = 0
    skipped: int = 0
    deferred: int = 0
    total: int = 0


class NutritionEstimateRequest(BaseModel):
    """User-typed ingredient name + optional context ('Tante Käthes
    Spezialgewürz, etwa wie Curry') to bias the Ollama estimate."""
    name: str = Field(min_length=1, max_length=255)
    hint: str | None = Field(default=None, max_length=255)


class NutritionEstimateResponse(BaseModel):
    nutrition: NutritionValues
    # Free-text note from the model — surfaced as a small italic line in
    # the Nährwerte sheet so the user knows it's a guess.
    note: str | None = None


# ---------- Internal sharing (alembic 0012, permissions added in 0014) ----

from pydantic import EmailStr

from app.models.collaborator import CollaboratorPermission


class ShareByEmailRequest(BaseModel):
    """POST /recipes/{id}/share/email and POST /recipes/share-book/email."""
    email: EmailStr
    permission: CollaboratorPermission = CollaboratorPermission.VIEW


class ShareByEmailResponse(BaseModel):
    """Either an internal share got created (recipient is a Lyst user) or
    the public link got emailed. The shape lets the UI render the right
    confirmation toast without leaking 'we sent the link' for the internal
    case."""
    type: str  # "internal" | "external"
    user_name: str | None = None


class ShareUpdateRequest(BaseModel):
    """PATCH /recipes/{id}/shares/{user_id} and the recipe-book equivalent."""
    permission: CollaboratorPermission


class InternalShareOut(BaseModel):
    """One row of the "shared with these users" list shown in the panels."""
    user_id: int
    name: str
    email: str
    permission: CollaboratorPermission
    created_at: datetime


# Late-binding so the forward ref on RecipeOut.share_permission resolves
# even though we import CollaboratorPermission below the class definition.
RecipeOut.model_rebuild()
