import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

OwnerType = Literal["licensor", "vendor", "owned"]
DealType = Literal["fixed_fee", "revenue_share", "hybrid", "owned"]
Exclusivity = Literal["exclusive", "non_exclusive"]
StoredStatus = Literal["draft", "active", "terminated"]
EffectiveStatus = Literal["draft", "upcoming", "active", "expired", "terminated"]
EpisodeScope = Literal["all", "ranges", "seasons"]
Platform = Literal["youtube", "facebook"]
SlotStatus = Literal["unassigned", "reserved", "pending_whitelist", "active", "replaced"]


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


# ---- Content owners --------------------------------------------------------------------


class OwnerIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    owner_type: OwnerType
    contact_name: str | None = Field(default=None, max_length=120)
    contact_email: EmailStr | None = None
    notes: str | None = Field(default=None, max_length=5000)
    is_active: bool = True

    @field_validator("contact_name", "notes", mode="before")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return _blank_to_none(value)

    @field_validator("contact_email", mode="before")
    @classmethod
    def blank_email(cls, value: str | None) -> str | None:
        return _blank_to_none(value)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name is required")
        return value.strip()


class OwnerOut(BaseModel):
    id: uuid.UUID
    name: str
    owner_type: OwnerType
    contact_name: str | None
    contact_email: str | None
    notes: str | None
    is_active: bool
    deal_count: int
    created_at: datetime


# ---- Deals -----------------------------------------------------------------------------


class EpisodeRange(BaseModel):
    season: int | None = Field(default=None, ge=1, le=1000)
    from_episode: int = Field(ge=1, le=1_000_000)
    to_episode: int = Field(ge=1, le=1_000_000)

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.to_episode < self.from_episode:
            raise ValueError("Episode range must go from a lower to a higher number")
        return self


class DealIn(BaseModel):
    """Create/update payload. Mandatory fields depend on deal type and episode scope."""

    owner_id: uuid.UUID
    title: str = Field(min_length=1, max_length=200)
    deal_type: DealType
    status: StoredStatus = "active"
    fee_amount: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    revenue_share_pct: Decimal | None = Field(default=None, gt=0, le=100, decimal_places=2)
    term_start: date
    term_end: date
    episode_scope: EpisodeScope
    episode_ranges: list[EpisodeRange] = Field(default_factory=list, max_length=200)
    is_worldwide: bool = True
    territories: list[str] = Field(default_factory=list, max_length=250)
    yt_slot_limit: int = Field(ge=0, le=100)
    fb_slot_limit: int = Field(ge=0, le=100)
    contract_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=5000)
    languages: list[str] = Field(default_factory=list, max_length=50)
    exclusivity: Exclusivity | None = None
    renewal_terms: str | None = Field(default=None, max_length=5000)
    notice_period_days: int | None = Field(default=None, ge=0, le=3650)
    clip_restrictions: str | None = Field(default=None, max_length=5000)
    agreement_version: str | None = Field(default=None, max_length=60)

    @field_validator(
        "contract_url",
        "notes",
        "currency",
        "renewal_terms",
        "clip_restrictions",
        "agreement_version",
        mode="before",
    )
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return _blank_to_none(value)

    @model_validator(mode="after")
    def rules(self) -> Self:
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Title is required")
        if self.term_end <= self.term_start:
            raise ValueError("Term end must be after term start")

        if self.deal_type == "fixed_fee":
            if self.fee_amount is None or not self.currency:
                raise ValueError("A fixed-fee deal needs a licence fee and currency")
            self.currency = self.currency.upper()
            self.revenue_share_pct = None
        elif self.deal_type == "hybrid":
            if self.fee_amount is None or not self.currency:
                raise ValueError("A hybrid deal needs a minimum guarantee and currency")
            if self.revenue_share_pct is None:
                raise ValueError("A hybrid deal needs the owner's revenue share percentage")
            self.currency = self.currency.upper()
        elif self.deal_type == "revenue_share":
            if self.revenue_share_pct is None:
                raise ValueError("A revenue-share deal needs a share percentage")
            self.fee_amount = self.currency = None
        else:
            self.fee_amount = self.currency = self.revenue_share_pct = None

        if self.episode_scope == "all":
            self.episode_ranges = []
        elif not self.episode_ranges:
            raise ValueError("Add at least one episode range, or choose All episodes")
        elif self.episode_scope == "seasons":
            if any(r.season is None for r in self.episode_ranges):
                raise ValueError("Each range needs a season when licensing by season")
        else:
            for r in self.episode_ranges:
                r.season = None

        if self.is_worldwide:
            self.territories = []
        else:
            codes = {t.strip().upper() for t in self.territories if t.strip()}
            if not codes:
                raise ValueError("Choose at least one territory, or mark the deal Worldwide")
            if any(len(c) != 2 or not c.isalpha() for c in codes):
                raise ValueError("Territories must be 2-letter country codes")
            self.territories = sorted(codes)

        seen: dict[str, str] = {}
        for lang in self.languages:
            name = " ".join(lang.split())[:40]
            if name:
                seen.setdefault(name.lower(), name)
        self.languages = list(seen.values())

        if self.yt_slot_limit + self.fb_slot_limit == 0:
            raise ValueError("Allow at least one YouTube or Facebook slot")
        if self.contract_url and not self.contract_url.startswith(("https://", "http://")):
            raise ValueError("Contract link must start with https://")
        return self


class SlotOut(BaseModel):
    id: uuid.UUID
    platform: Platform
    number: int
    code: str
    status: SlotStatus
    notes: str | None
    # The channel holding the slot now (Part 3), with its CMS and manager.
    channel_id: uuid.UUID | None = None
    channel_name: str | None = None
    channel_external_id: str | None = None
    cms_name: str | None = None
    manager_name: str | None = None
    since: date | None = None


class SlotUpdate(BaseModel):
    status: SlotStatus
    notes: str | None = Field(default=None, max_length=500)


class DealListItem(BaseModel):
    id: uuid.UUID
    title: str
    owner_id: uuid.UUID
    owner_name: str
    deal_type: DealType
    status: EffectiveStatus
    fee_amount: Decimal | None
    currency: str | None
    revenue_share_pct: Decimal | None
    term_start: date
    term_end: date
    episode_scope: EpisodeScope
    episode_ranges: list[EpisodeRange]
    yt_slot_limit: int
    fb_slot_limit: int
    yt_slots_used: int
    fb_slots_used: int


class DealOut(DealListItem):
    stored_status: StoredStatus
    is_worldwide: bool
    territories: list[str]
    contract_url: str | None
    notes: str | None
    languages: list[str]
    exclusivity: Exclusivity | None
    renewal_terms: str | None
    notice_period_days: int | None
    # term_end − notice period: the last day to tell the owner about renewal.
    notice_deadline: date | None
    clip_restrictions: str | None
    agreement_version: str | None
    episode_count: int
    document_count: int
    owner_contact_name: str | None
    owner_contact_email: str | None
    slots: list[SlotOut]
    created_at: datetime
    updated_at: datetime


class CurrencyAmount(BaseModel):
    currency: str
    amount: Decimal


class DealsSummary(BaseModel):
    active_deals: int
    expiring_soon: int
    slots_used: int
    slots_total: int
    licence_value: list[CurrencyAmount]


class RightsCheckIn(BaseModel):
    platform: Platform
    on_date: date | None = None
    episode: int | None = Field(default=None, ge=1)
    season: int | None = Field(default=None, ge=1)
    territory: str | None = Field(default=None, min_length=2, max_length=2)
    # Optional destination: the channel/page the clip would go on (slide 4 critical control).
    channel_id: uuid.UUID | None = None


class RightsCheckOut(BaseModel):
    allowed: bool
    reasons: list[str]
    checked_on: date
    # From the deal's episode list, when that episode has details.
    episode_title: str | None = None
