from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.collaborator import CollaboratorPermission
from app.models.list import ListType


class ShareState(BaseModel):
    """Owner-side summary of a resource's share status. Powers the
    small share icon + tooltip on the overview cards so the owner can
    tell at a glance which of their things are shared.

    `internal_count` is the number of in-app share rows (collaborators
    for lists, share recipients for notes/recipes). `public` is whether
    the anyone-with-URL token is enabled."""

    internal_count: int = 0
    public: bool = False


class ShareSuggestion(BaseModel):
    """One row of GET /users/me/share-suggestions: a person the
    current user has shared anything with before. Frontend renders
    these as click-to-fill chips in the share panels."""

    id: int
    name: str
    email: EmailStr


class ShareEnableResponse(BaseModel):
    share_token: str
    share_url: str
    qr_code_png_base64: str


class CollaboratorInvite(BaseModel):
    email: EmailStr
    permission: CollaboratorPermission = CollaboratorPermission.VIEW


class CollaboratorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: int
    email: EmailStr
    name: str
    permission: CollaboratorPermission


class PublicListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    is_checked: bool
    quantity: float | None
    unit: str | None
    position: int


class PublicList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    title: str
    type: ListType
    description: str | None
    color: str | None
    icon: str | None
    updated_at: datetime
    items: list[PublicListItem]
