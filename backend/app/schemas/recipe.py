from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.recipe import RecipeCategory


# --- Ingredients ---

class IngredientBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    quantity: float | None = None
    unit: str | None = Field(default=None, max_length=32)
    calories_per_100g: float | None = Field(default=None, ge=0)
    protein_per_100g: float | None = Field(default=None, ge=0)
    carbs_per_100g: float | None = Field(default=None, ge=0)
    fat_per_100g: float | None = Field(default=None, ge=0)


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


class IngredientOut(IngredientBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    position: int


class NutritionTotals(BaseModel):
    """Per-serving aggregates derived from ingredient nutrition fields.
    All fields are None until at least one ingredient has nutrition data
    for that macro (so partial information still renders sensibly)."""
    calories: float | None = None
    protein: float | None = None
    carbs: float | None = None
    fat: float | None = None


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
    category: RecipeCategory = RecipeCategory.OTHER
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
    category: RecipeCategory | None = None
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
