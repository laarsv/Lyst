from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.user import UserRole


class UserBase(BaseModel):
    email: EmailStr
    name: str


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.USER


class UserInvite(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=255)
    role: UserRole = UserRole.USER


class UserUpdate(BaseModel):
    name: str | None = None
    email: EmailStr | None = None
    is_active: bool | None = None
    role: UserRole | None = None


class UserSelfUpdate(BaseModel):
    name: str | None = None
    email: EmailStr | None = None
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=128)


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    role: UserRole
    is_active: bool
    email_verified: bool
    last_login: datetime | None
    created_at: datetime


class AdminUserOut(UserOut):
    list_count: int = 0


class UserCreateResponse(BaseModel):
    user: UserOut
    temp_password: str
