from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.meal_plan import MealType


class EntryCreate(BaseModel):
    recipe_id: int
    day_of_week: int = Field(ge=0, le=6)
    meal_type: MealType = MealType.DINNER
    servings: int = Field(default=2, ge=1, le=99)


class EntryUpdate(BaseModel):
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    meal_type: MealType | None = None
    servings: int | None = Field(default=None, ge=1, le=99)


class EntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    meal_plan_id: int
    recipe_id: int
    day_of_week: int
    meal_type: MealType
    servings: int
    # Recipe summary fields embedded for the UI
    recipe_title: str
    recipe_category: str
    recipe_image_url: str | None
    recipe_servings: int
    recipe_prep_time_minutes: int | None
    recipe_cook_time_minutes: int | None


class MealPlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    week_start: date
    created_at: datetime
    entries: list[EntryOut] = Field(default_factory=list)


class GenerateListResponse(BaseModel):
    list_id: int
    list_title: str
    items_added: int
