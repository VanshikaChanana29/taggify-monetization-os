import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.channels import ManagerHistoryItem, PersonRef


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


# ---- Roles --------------------------------------------------------------------------------


class RoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    can_manage_youtube: bool = False
    can_manage_facebook: bool = False
    can_lead_team: bool = False

    @field_validator("name")
    @classmethod
    def required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name is required")
        return value.strip()


class RoleOut(RoleIn):
    id: uuid.UUID
    people_count: int


class RoleRef(BaseModel):
    id: uuid.UUID
    name: str
    can_manage_youtube: bool
    can_manage_facebook: bool
    can_lead_team: bool


# ---- Teams --------------------------------------------------------------------------------


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    is_active: bool = True
    # Only used when creating a team.
    lead_id: uuid.UUID | None = None

    @field_validator("name")
    @classmethod
    def required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name is required")
        return value.strip()

    @field_validator("description", mode="before")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return _blank(value)


class TeamOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_active: bool
    lead: PersonRef | None
    lead_since: date | None
    member_count: int
    channel_count: int
    created_at: datetime


class TeamHistoryItem(BaseModel):
    id: uuid.UUID
    person: PersonRef
    start_date: date
    end_date: date | None


class TeamDetail(TeamOut):
    members: list[PersonRef]
    lead_history: list[TeamHistoryItem]
    member_history: list[TeamHistoryItem]


class TeamLeadIn(BaseModel):
    employee_id: uuid.UUID | None
    effective_date: date | None = None


class TeamRef(BaseModel):
    id: uuid.UUID
    name: str


# ---- People -------------------------------------------------------------------------------


class EmployeeIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    role_id: uuid.UUID
    team_id: uuid.UUID | None = None
    # When the team change (if any) takes effect; defaults to today.
    team_effective_date: date | None = None
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    join_date: date | None = None
    monthly_salary: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=2)
    salary_currency: str = Field(default="INR", min_length=3, max_length=3)
    is_active: bool = True
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("full_name")
    @classmethod
    def name_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name is required")
        return value.strip()

    @field_validator("email", "phone", "notes", mode="before")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return _blank(value)

    @field_validator("salary_currency")
    @classmethod
    def upper(cls, value: str) -> str:
        return value.upper()


class EmployeeOut(BaseModel):
    id: uuid.UUID
    full_name: str
    role: RoleRef
    team: TeamRef | None
    team_lead: PersonRef | None
    leads_teams: list[TeamRef]
    email: str | None
    phone: str | None
    join_date: date | None
    monthly_salary: Decimal | None
    salary_currency: str
    is_active: bool
    notes: str | None
    channel_count: int
    created_at: datetime


class ManagedChannel(BaseModel):
    channel_id: uuid.UUID
    channel_name: str
    platform: Literal["youtube", "facebook"]
    since: date
    deals: list[str]


class TeamMembershipItem(BaseModel):
    id: uuid.UUID
    team: TeamRef
    start_date: date
    end_date: date | None


class EmployeeDetail(EmployeeOut):
    channels: list[ManagedChannel]
    team_members: list[PersonRef]
    history: list[ManagerHistoryItem]
    team_history: list[TeamMembershipItem]
