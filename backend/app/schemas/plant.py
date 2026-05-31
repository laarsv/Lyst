from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.plant import PlantLocation


class PlantBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    species: str | None = Field(default=None, max_length=255)
    location: PlantLocation = PlantLocation.HALBSCHATTEN
    # NULL = no watering reminder (plant is just tracked). Same for fertilize.
    watering_interval_days: int | None = Field(default=None, ge=1, le=365)
    watering_note: str | None = None
    fertilize: bool = False
    fertilize_interval_days: int | None = Field(default=None, ge=1, le=365)
    winterhardy: bool = False
    edible: bool = False
    height_cm: int | None = Field(default=None, ge=0, le=10000)
    width_cm: int | None = Field(default=None, ge=0, le=10000)
    image_url: str | None = Field(default=None, max_length=1024)
    notes: str | None = None
    tags: list[str] = Field(default_factory=list)


class PlantCreate(PlantBase):
    # Optional "Zuletzt gegossen / gedüngt" the form pre-fills with today.
    # When omitted, the service falls back to now() so the first reminder
    # fires one interval out. (See plant_service.create_plant.)
    last_watered_at: datetime | None = None
    last_fertilized_at: datetime | None = None


class PlantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    species: str | None = Field(default=None, max_length=255)
    location: PlantLocation | None = None
    watering_interval_days: int | None = Field(default=None, ge=1, le=365)
    watering_note: str | None = None
    fertilize: bool | None = None
    fertilize_interval_days: int | None = Field(default=None, ge=1, le=365)
    winterhardy: bool | None = None
    edible: bool | None = None
    height_cm: int | None = Field(default=None, ge=0, le=10000)
    width_cm: int | None = Field(default=None, ge=0, le=10000)
    image_url: str | None = Field(default=None, max_length=1024)
    notes: str | None = None
    tags: list[str] | None = None


class PlantOut(PlantBase):
    """Used for both the list and the detail view — plants have no
    sub-resources, so one shape covers both."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    last_watered_at: datetime | None = None
    last_fertilized_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    # Computed (last_*_at + interval); null when the matching interval is
    # unset. *_due is true once that moment has passed — drives the "fällig"
    # badges and the "Diese Woche fällig" overview.
    next_water_due: datetime | None = None
    next_fertilize_due: datetime | None = None
    water_due: bool = False
    fertilize_due: bool = False


class PlantDueResponse(BaseModel):
    """GET /plants/due — plants whose next water/fertilize moment is overdue
    or falls within the next 7 days. Each list holds full PlantOut rows so
    the frontend reuses the same card; sorted soonest-first."""
    water: list[PlantOut] = Field(default_factory=list)
    fertilize: list[PlantOut] = Field(default_factory=list)
