from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

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


class NutritionTotals(BaseModel):
    """Per-serving aggregates derived from ingredient nutrition fields.
    All fields are None until at least one ingredient has nutrition data
    for that macro (so partial information still renders sensibly).

    `is_estimate` is true when ANY contributing ingredient was filled
    from an AI estimate — the recipe-detail card renders a "~" prefix
    in that case so the user knows the totals carry uncertainty.

    `ingredients_with_data` / `ingredients_total` drive the "Werte
    basieren auf X von Y Zutaten" hint: lets the UI nudge the user to
    fill the missing rows without hiding the partial totals."""
    calories: float | None = None
    protein: float | None = None
    carbs: float | None = None
    fat: float | None = None
    fiber: float | None = None
    sugar: float | None = None
    salt: float | None = None
    is_estimate: bool = False
    ingredients_with_data: int = 0
    ingredients_total: int = 0


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


class RecipeCreate(RecipeBase):
    ingredients: list[IngredientCreate] = Field(default_factory=list)
    steps: list[StepCreate] = Field(default_factory=list)


class RecipeUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    servings: int | None = Field(default=None, ge=1, le=999)
    prep_time_minutes: int | None = Field(default=None, ge=0)
    cook_time_minutes: int | None = Field(default=None, ge=0)
    image_url: str | None = Field(default=None, max_length=1024)
    source_url: str | None = Field(default=None, max_length=1024)
    tags: list[str] | None = None


class RecipeSummary(RecipeBase):
    """List view — without ingredients/steps."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    ingredient_count: int = 0
    # Recipient-perspective fields (alembic 0012). null/empty when the
    # current user owns the row.
    owner_name: str | None = None
    share_source: str | None = None  # "individual" | "book" | None
    # Owner-side share summary. None on shared-with-me rows.
    share_state: ShareState | None = None


class RecipeOut(RecipeBase):
    """Detail view — with ingredients, steps, and per-serving nutrition totals."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    ingredients: list[IngredientOut] = Field(default_factory=list)
    steps: list[StepOut] = Field(default_factory=list)
    nutrition_per_serving: NutritionTotals = Field(default_factory=NutritionTotals)
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

class AiVariationRequest(BaseModel):
    """The user's desired variation — preset string or free-form."""
    variation: str = Field(min_length=1, max_length=500)


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
