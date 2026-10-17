import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.security import MIN_PASSWORD_LENGTH


class AdminOrganizationOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    base_currency: str
    active_users: int
    created_at: datetime


class CreateOrganizationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=2, max_length=60, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    base_currency: str = Field(default="INR", min_length=3, max_length=3)

    @field_validator("base_currency")
    @classmethod
    def upper_currency(cls, value: str) -> str:
        return value.upper()


class AdminMembershipOut(BaseModel):
    organization_id: uuid.UUID
    organization_name: str
    is_active: bool


class AdminUserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    is_superadmin: bool
    last_login_at: datetime | None
    created_at: datetime
    memberships: list[AdminMembershipOut]


class AdminCreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=256)
    organization_id: uuid.UUID


class AddMembershipRequest(BaseModel):
    organization_id: uuid.UUID


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=256)
