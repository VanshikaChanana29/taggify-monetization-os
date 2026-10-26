import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.deals import Platform

ChannelStatus = Literal["active", "inactive"]
OccupiedStatus = Literal["reserved", "pending_whitelist", "active"]


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class CmsIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    platform: Platform
    notes: str | None = Field(default=None, max_length=5000)
    is_active: bool = True
    # The CMS takes its commission after the tax it withholds (e.g. US tax). Founders' answer:
    # every CMS does, so new ones start with it on.
    fee_after_tax: bool = True

    @field_validator("name")
    @classmethod
    def name_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name is required")
        return value.strip()

    @field_validator("notes", mode="before")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return _blank(value)


class CmsSlab(BaseModel):
    from_amount: Decimal
    rate_pct: Decimal


class CmsSlabs(BaseModel):
    """The fee slabs in force this month (or the next ones, if none apply yet)."""

    effective_from: date
    tier_type: Literal["whole", "marginal"]
    currency: str
    tiers: list[CmsSlab]


class CmsOut(BaseModel):
    id: uuid.UUID
    name: str
    platform: Platform
    notes: str | None
    is_active: bool
    fee_after_tax: bool = False
    has_sheet_mapping: bool = False
    channel_count: int
    created_at: datetime
    slabs: CmsSlabs | None = None


class ChannelIn(BaseModel):
    platform: Platform
    name: str = Field(min_length=1, max_length=200)
    external_id: str = Field(min_length=1, max_length=100)
    url: str | None = Field(default=None, max_length=500)
    cms_partner_id: uuid.UUID | None = None
    status: ChannelStatus = "active"
    notes: str | None = Field(default=None, max_length=5000)
    # A deal partner's own channel (its earnings are paid to the partner).
    partner_id: uuid.UUID | None = None

    @field_validator("name", "external_id")
    @classmethod
    def required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("This field is required")
        return value.strip()

    @field_validator("url", "notes", mode="before")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return _blank(value)

    @field_validator("url")
    @classmethod
    def https(cls, value: str | None) -> str | None:
        if value and not value.startswith(("https://", "http://")):
            raise ValueError("Channel link must start with https://")
        return value


class PersonRef(BaseModel):
    id: uuid.UUID
    name: str


class ChannelSlotRef(BaseModel):
    """A slot this channel currently holds."""

    deal_id: uuid.UUID
    deal_title: str
    owner_name: str
    slot_id: uuid.UUID
    slot_code: str
    slot_status: str
    since: date


class ChannelMetricsOut(BaseModel):
    """The channel's numbers for the chosen period (revenue in USD)."""

    revenue: Decimal
    views: int
    rpm: Decimal | None
    watch_hours: Decimal | None
    subscribers_net: int | None
    previous_revenue: Decimal
    revenue_change_pct: Decimal | None
    estimate_share_pct: Decimal


class ChannelListItem(BaseModel):
    id: uuid.UUID
    platform: Platform
    name: str
    external_id: str
    url: str | None
    status: ChannelStatus
    cms_partner_id: uuid.UUID | None
    cms_name: str | None
    partner: PersonRef | None = None
    slots: list[ChannelSlotRef]
    manager: PersonRef | None
    team_lead: PersonRef | None
    created_at: datetime
    # Filled by the Channels list (period numbers and YouTube connection).
    team: str | None = None
    youtube_status: str = "not_connected"
    subscribers: int | None = None
    metrics: ChannelMetricsOut | None = None


class SlotHistoryItem(BaseModel):
    id: uuid.UUID
    deal_id: uuid.UUID
    deal_title: str
    slot_id: uuid.UUID
    slot_code: str
    channel_id: uuid.UUID
    channel_name: str
    start_date: date
    end_date: date | None
    start_reason: str
    end_reason: str | None
    notes: str | None


class ManagerHistoryItem(BaseModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    channel_name: str
    employee: PersonRef
    start_date: date
    end_date: date | None


class ChannelDetail(ChannelListItem):
    notes: str | None
    slot_history: list[SlotHistoryItem]
    manager_history: list[ManagerHistoryItem]


class AssignIn(BaseModel):
    channel_id: uuid.UUID
    status: OccupiedStatus = "pending_whitelist"
    effective_date: date | None = None
    notes: str | None = Field(default=None, max_length=500)


class UnassignIn(BaseModel):
    effective_date: date | None = None
    notes: str | None = Field(default=None, max_length=500)


class ManagerIn(BaseModel):
    employee_id: uuid.UUID | None
    effective_date: date | None = None


class ImportLineOut(BaseModel):
    line: int
    external_id: str
    name: str
    platform: str
    cms: str | None
    manager: str | None
    partner: str | None = None
    status: str
    result: Literal["new", "exists", "duplicate", "error"]
    notes: list[str]
    channel_id: uuid.UUID | None = None


class ImportOut(BaseModel):
    added: int
    exists: int
    duplicate: int
    errors: int
    with_notes: int
    missing_columns: list[str]
    lines: list[ImportLineOut]
