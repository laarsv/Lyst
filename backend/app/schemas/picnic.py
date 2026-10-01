from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.picnic_service import normalize_term

_PRODUCT_ID = r"^[A-Za-z0-9_-]{1,32}$"


class PicnicStatusOut(BaseModel):
    configured: bool
    connected: bool


class PicnicPreviewIn(BaseModel):
    list_id: int


class PicnicCandidateOut(BaseModel):
    id: str
    name: str
    # None for a remembered product that wasn't in this search's results.
    price_cents: int | None = None
    unit: str | None = None
    bought: int = 0
    # mapping | match_bought | match | other — why it ranks where it does.
    reason: str


class PicnicPreviewItemOut(BaseModel):
    item_id: int
    text: str
    term: str
    count: int
    candidates: list[PicnicCandidateOut]
    # Product id to pre-select, or None when the user has to choose.
    preselected: str | None = None
    error: str | None = None


class PicnicPreviewOut(BaseModel):
    list_id: int
    items: list[PicnicPreviewItemOut]
    # True when the list had more open items than one preview looks up.
    truncated: bool = False


class PicnicCartItemIn(BaseModel):
    product_id: str = Field(pattern=_PRODUCT_ID)
    product_name: str = Field(min_length=1, max_length=255)
    count: int = Field(default=1, ge=1, le=99)
    # The list term this choice answers; required when remember=True.
    term: str | None = Field(default=None, max_length=100)
    remember: bool = False

    @model_validator(mode="after")
    def _remember_needs_term(self):
        if self.remember and not normalize_term(self.term or ""):
            raise ValueError("remember benötigt einen Begriff")
        return self


class PicnicCartIn(BaseModel):
    items: list[PicnicCartItemIn] = Field(min_length=1, max_length=50)


class PicnicCartLineOut(BaseModel):
    id: str
    name: str
    count: int
    price_cents: int | None = None


class PicnicCartSummaryOut(BaseModel):
    lines: list[PicnicCartLineOut]
    total_cents: int


class PicnicCartOut(BaseModel):
    added: int
    remembered: int
    cart: PicnicCartSummaryOut


class PicnicMappingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    term: str
    product_id: str
    product_name: str
    created_at: datetime
