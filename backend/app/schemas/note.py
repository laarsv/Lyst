from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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
