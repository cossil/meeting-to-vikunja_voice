from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime


class UserBase(BaseModel):
    """Shared user fields."""
    model_config = ConfigDict(extra='forbid')

    username: str = Field(..., min_length=3, max_length=50, description="Unique username")


class UserCreate(UserBase):
    """Schema for creating a new user."""
    password: str = Field(..., min_length=8, max_length=128, description="Plain-text password")
    role: str = Field("user", pattern="^(admin|user)$", description="User role: admin or user")


class UserLogin(BaseModel):
    """Schema for login requests."""
    model_config = ConfigDict(extra='forbid')

    username: str
    password: str


class UserPublic(UserBase):
    """Schema returned to clients — never includes password hash."""
    id: str
    role: str
    created_at: str
    is_active: bool = True


class User(UserBase):
    """Full internal user model stored in users.json."""
    id: str
    hashed_password: str
    role: str = "user"
    is_active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class UserUpdate(BaseModel):
    """Schema for admin-driven user updates (partial)."""
    model_config = ConfigDict(extra='forbid')

    role: Optional[str] = Field(None, pattern="^(admin|user)$", description="New role")
    is_active: Optional[bool] = Field(None, description="Activate / deactivate the account")


class PasswordReset(BaseModel):
    """Schema for admin-driven password reset."""
    model_config = ConfigDict(extra='forbid')

    new_password: str = Field(..., min_length=8, max_length=128, description="New plain-text password")


class TokenResponse(BaseModel):
    """JWT token returned after successful login."""
    access_token: str
    token_type: str = "bearer"
    user: UserPublic
