from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.collaborator import CollaboratorPermission


class NoteBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = ""
    tags: list[str] = Field(default_factory=list)
    folder_id: int | None = None
    is_pinned: bool = False
    is_archived: bool = False


class NoteCreate(NoteBase):
    pass


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = None
    tags: list[str] | None = None
    folder_id: int | None = None
    is_pinned: bool | None = None
    is_archived: bool | None = None


class NoteOut(NoteBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    # Public-share state — alembic 0013. Same shape as Recipe.
    share_enabled: bool = False
    share_token: str | None = None
    # Recipient-perspective fields. share_source="individual" when the
    # current user is viewing a note someone else shared with them; null
    # when they own it. owner_name only set in the recipient case.
    share_source: str | None = None
    owner_name: str | None = None
    # Effective permission of the current viewer. Owner -> EDIT;
    # recipient -> whatever the share row carries. None == no relationship,
    # which only happens before share_source/owner_name fields are set.
    share_permission: CollaboratorPermission | None = None


# --- Public + internal sharing ---

class PublicNote(BaseModel):
    """Payload returned by GET /share/note/{token} — anyone-with-URL."""
    title: str
    content: str
    tags: list[str]
    updated_at: datetime


class NoteShareByEmailRequest(BaseModel):
    """Body for POST /notes/{id}/share/email."""
    email: EmailStr
    permission: CollaboratorPermission = CollaboratorPermission.VIEW


class NoteShareByEmailResponse(BaseModel):
    """Either an internal share got created (recipient is a Lyst user) or
    the public link got emailed. Same shape as the recipe equivalent so
    the frontend reuses the same toast logic."""
    type: str  # "internal" | "external"
    user_name: str | None = None


class NoteShareUpdateRequest(BaseModel):
    """Body for PATCH /notes/{id}/shares/{user_id} — owner can flip a
    recipient between VIEW and EDIT without re-creating the row."""
    permission: CollaboratorPermission


class NoteInternalShareOut(BaseModel):
    """One row of the "geteilt mit" list shown in the share panel."""
    user_id: int
    name: str
    email: str
    permission: CollaboratorPermission
    created_at: datetime


# --- Folders ---

class NoteFolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    color: str | None = Field(default=None, max_length=9)


class NoteFolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    color: str | None = Field(default=None, max_length=9)


class NoteFolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    name: str
    color: str | None
    created_at: datetime
    note_count: int = 0


# --- Versions ---

class NoteVersionListItem(BaseModel):
    id: int
    note_id: int
    title: str
    preview: str
    created_at: datetime


class NoteVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    note_id: int
    title: str
    content: str
    created_at: datetime
