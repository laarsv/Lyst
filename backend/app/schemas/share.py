from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.collaborator import CollaboratorPermission
from app.models.list import ListType


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
