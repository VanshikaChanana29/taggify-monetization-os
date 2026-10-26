import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


def _blank(value: str | None) -> str | None:
    return value.strip() or None if isinstance(value, str) else value


class PartnerIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=30)
    tds_pct: Decimal | None = Field(default=None, ge=0, le=100, decimal_places=2)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def name_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("This field is required")
        return value.strip()

    @field_validator("email", "phone", "notes", mode="before")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return _blank(value)


class PartnerDealRef(BaseModel):
    deal_id: uuid.UUID
    title: str
    share_pct: Decimal


class PartnerOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str | None
    phone: str | None
    tds_pct: Decimal | None
    notes: str | None
    is_active: bool
    created_at: datetime
    deals: list[PartnerDealRef] = []
    channel_count: int = 0
    earned: Decimal = Decimal("0.00")
    paid: Decimal = Decimal("0.00")
    outstanding: Decimal = Decimal("0.00")
    waiting: Decimal = Decimal("0.00")


class PartnerMonthOut(BaseModel):
    month: str
    currency: str | None
    channels: int
    gross: Decimal
    tax: Decimal
    cms_fee: Decimal
    share: Decimal
    share_base: Decimal | None
    tds: Decimal | None
    to_pay: Decimal | None
    paid: Decimal
    tds_paid: Decimal
    balance: Decimal | None
    cms_paid: bool
    status: str


class PartnerDealOut(BaseModel):
    deal_id: uuid.UUID
    title: str
    owner: str
    share_pct: Decimal
    licence_share: Decimal | None
    contributed: Decimal
    contribution_due: Decimal | None


class PartnerChannelOut(BaseModel):
    id: uuid.UUID
    name: str
    platform: str
    external_id: str
    cms_name: str | None
    status: str


class ContributionOut(BaseModel):
    id: uuid.UUID
    deal_id: uuid.UUID
    deal_title: str
    amount: Decimal
    received_on: date
    reference: str | None


class PayoutOut(BaseModel):
    id: uuid.UUID
    month: str
    amount: Decimal
    tds_amount: Decimal
    paid_on: date
    reference: str | None


class PartnerDetail(BaseModel):
    partner: PartnerOut
    base_currency: str
    months: list[PartnerMonthOut]
    deals: list[PartnerDealOut]
    channels: list[PartnerChannelOut]
    contributions: list[ContributionOut]
    payouts: list[PayoutOut]
    warnings: list[str]


class ShareIn(BaseModel):
    partner_id: uuid.UUID
    share_pct: Decimal = Field(gt=0, lt=100, decimal_places=2)


class DealPartnersIn(BaseModel):
    partners: list[ShareIn] = Field(max_length=10)


class DealPartnerOut(BaseModel):
    partner_id: uuid.UUID
    name: str
    share_pct: Decimal


class ContributionIn(BaseModel):
    deal_id: uuid.UUID
    amount: Decimal = Field(gt=0, decimal_places=2)
    received_on: date
    reference: str | None = Field(default=None, max_length=120)

    @field_validator("reference", mode="before")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return _blank(value)


class PayoutIn(BaseModel):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    amount: Decimal = Field(gt=0, decimal_places=2)
    tds_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    paid_on: date
    reference: str | None = Field(default=None, max_length=120)

    @field_validator("reference", mode="before")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return _blank(value)


class PartnerMonthSummary(BaseModel):
    id: uuid.UUID
    name: str
    channels: int
    gross: Decimal
