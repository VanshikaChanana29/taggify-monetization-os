import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.core.security import MIN_PASSWORD_LENGTH


class LoginRequest(BaseModel):
    # Not EmailStr: login only looks the address up, so any typo gets the same
    # "Invalid email or password" answer instead of a validation error.
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    base_currency: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    is_superadmin: bool


class MeOut(BaseModel):
    user: UserOut
    # None only for a super admin who is not a member of any company.
    organization: OrganizationOut | None
    organizations: list[OrganizationOut]


class SwitchOrganizationRequest(BaseModel):
    organization_id: uuid.UUID


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=256)
