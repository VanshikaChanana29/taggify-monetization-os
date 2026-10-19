import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

Month = str  # "YYYY-MM"


def parse_month(value: str) -> date:
    try:
        year, month = (int(p) for p in value.split("-"))
        return date(year, month, 1)
    except (ValueError, TypeError) as exc:
        raise ValueError("Month must look like 2026-10") from exc


class _MonthField(BaseModel):
    month: str

    @field_validator("month")
    @classmethod
    def valid_month(cls, value: str) -> str:
        parse_month(value)
        return value


# ---- Revenue -------------------------------------------------------------------------------


class RevenueImportOut(BaseModel):
    id: uuid.UUID
    file_name: str
    uploaded_by: str | None
    rows_total: int
    rows_created: int
    rows_updated: int
    rows_failed: int
    errors: list[dict[str, Any]]
    created_at: datetime


class RevenueFactOut(BaseModel):
    id: uuid.UUID
    day: date
    channel_id: uuid.UUID
    channel_name: str
    platform: str
    cms_name: str | None
    gross_amount: Decimal
    currency: str
    views: int | None
    state: str
    source: str


# ---- FX ------------------------------------------------------------------------------------


class FxRateIn(_MonthField):
    currency: str = Field(min_length=3, max_length=3)
    rate: Decimal = Field(gt=0, max_digits=18, decimal_places=6)

    @field_validator("currency")
    @classmethod
    def upper(cls, value: str) -> str:
        return value.upper()


class FxRateOut(BaseModel):
    id: uuid.UUID
    month: str
    currency: str
    rate: Decimal


# ---- CMS fee schedules -----------------------------------------------------------------------


class Tier(BaseModel):
    from_amount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    rate_pct: Decimal = Field(ge=0, le=100, decimal_places=2)


class FeeScheduleIn(BaseModel):
    effective_from: date
    tier_type: Literal["whole", "marginal"]
    currency: str = Field(min_length=3, max_length=3)
    tiers: list[Tier] = Field(min_length=1, max_length=20)
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def rules(self) -> Self:
        self.currency = self.currency.upper()
        self.effective_from = self.effective_from.replace(day=1)
        self.tiers = sorted(self.tiers, key=lambda t: t.from_amount)
        if self.tiers[0].from_amount != 0:
            raise ValueError("The first tier must start at 0")
        starts = [t.from_amount for t in self.tiers]
        if len(set(starts)) != len(starts):
            raise ValueError("Two tiers start at the same amount")
        return self


class FeeScheduleOut(BaseModel):
    id: uuid.UUID
    effective_from: date
    tier_type: Literal["whole", "marginal"]
    currency: str
    tiers: list[Tier]
    notes: str | None


# ---- Settlement ------------------------------------------------------------------------------


class CmsMonthOut(BaseModel):
    cms_id: uuid.UUID | None
    cms_name: str
    currency: str | None
    gross: Decimal
    tax: Decimal = Decimal("0.00")
    fee: Decimal | None
    net: Decimal | None
    fee_rule: str | None
    fx_rate: Decimal | None
    gross_base: Decimal | None
    tax_base: Decimal | None = None
    fee_base: Decimal | None
    net_base: Decimal | None
    statement_net: Decimal | None
    variance: Decimal | None
    adjustments: Decimal
    received: Decimal
    received_credited: Decimal
    fx_difference: Decimal
    outstanding: Decimal | None
    channel_count: int
    warnings: list[str]


class FinanceMonthOut(BaseModel):
    month: str
    base_currency: str
    gross: Decimal
    fee: Decimal
    net_receivable: Decimal
    received: Decimal
    fx_difference: Decimal
    outstanding: Decimal
    incomplete: bool
    rows: list[CmsMonthOut]


class ChannelLineOut(BaseModel):
    channel_id: uuid.UUID
    channel_name: str
    platform: str
    deals: list[str]
    gross: Decimal
    tax: Decimal = Decimal("0.00")
    fee_share: Decimal | None
    net_share: Decimal | None
    views: int | None


class StatementOut(BaseModel):
    id: uuid.UUID
    currency: str
    gross_amount: Decimal
    tax_amount: Decimal | None = None
    fee_amount: Decimal
    net_amount: Decimal
    reference: str | None
    notes: str | None
    source: Literal["manual", "file"] = "manual"
    file_name: str | None = None
    version: int = 1
    uploaded_by: str | None = None
    updated_at: datetime | None = None
    line_count: int = 0


ReconStatus = Literal[
    "match", "differs", "missing_in_statement", "not_in_our_data", "unknown_channel"
]


class ReconLineOut(BaseModel):
    channel_id: uuid.UUID | None
    channel_name: str
    external_id: str | None
    our_gross: Decimal | None
    their_gross: Decimal | None
    our_tax: Decimal | None = None
    their_tax: Decimal | None = None
    our_fee: Decimal | None
    their_fee: Decimal | None
    our_net: Decimal | None
    their_net: Decimal | None
    difference: Decimal | None
    status: Literal[
        "match", "differs", "missing_in_statement", "not_in_our_data", "unknown_channel"
    ]


class StatementImportOut(BaseModel):
    statement: StatementOut | None
    lines_saved: int
    lines_matched: int
    lines_unknown: int
    errors: list[dict[str, Any]]


class ReceiptOut(BaseModel):
    id: uuid.UUID
    received_on: date
    currency: str
    amount: Decimal
    amount_base: Decimal
    # The amount valued at the month's FX rate (what it clears of the receivable).
    valued_base: Decimal | None = None
    reference: str | None
    notes: str | None


class AdjustmentOut(BaseModel):
    id: uuid.UUID
    amount: Decimal
    reason: str
    created_at: datetime


class CmsMonthDetail(BaseModel):
    month: str
    base_currency: str
    summary: CmsMonthOut
    channels: list[ChannelLineOut]
    statement: StatementOut | None
    receipts: list[ReceiptOut]
    adjustments: list[AdjustmentOut]
    reconciliation: list[ReconLineOut] = []


class StatementIn(_MonthField):
    cms_partner_id: uuid.UUID
    currency: str = Field(min_length=3, max_length=3)
    gross_amount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    fee_amount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    net_amount: Decimal = Field(max_digits=18, decimal_places=2)
    reference: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def consistent(self) -> Self:
        self.currency = self.currency.upper()
        if self.gross_amount - self.fee_amount != self.net_amount:
            raise ValueError("Net must equal gross minus fee")
        return self


class ReceiptIn(_MonthField):
    cms_partner_id: uuid.UUID
    received_on: date
    # What the CMS paid, in the currency it paid in (USD, AED, INR…).
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    # What the bank credited in the base currency; required when paid in another currency.
    amount_base: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=2)
    reference: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("currency")
    @classmethod
    def upper(cls, value: str | None) -> str | None:
        return value.upper() if value else None


class AdjustmentIn(_MonthField):
    cms_partner_id: uuid.UUID
    amount: Decimal = Field(max_digits=18, decimal_places=2)
    reason: str = Field(min_length=1, max_length=300)

    @field_validator("amount")
    @classmethod
    def not_zero(cls, value: Decimal) -> Decimal:
        if value == 0:
            raise ValueError("Amount cannot be zero")
        return value


# ---- CMS sheet upload ------------------------------------------------------------------------


class SheetRoleOut(BaseModel):
    key: str
    label: str
    required: bool
    hint: str


class SheetLineOut(BaseModel):
    line: int
    external_id: str
    channel_name: str | None
    channel_id: uuid.UUID | None
    gross: Decimal
    tax: Decimal
    fee: Decimal | None
    net: Decimal | None
    net_local: Decimal | None


class SheetTotals(BaseModel):
    gross: Decimal
    tax: Decimal
    fee: Decimal | None
    net: Decimal | None
    net_local: Decimal | None


class SheetPreviewOut(BaseModel):
    file_name: str
    headers: list[str]
    roles: list[SheetRoleOut]
    mapping: dict[str, str]
    # "saved" = this CMS's mapping from an earlier upload; "guessed" = read from the headers.
    mapping_source: Literal["saved", "guessed", "chosen"]
    problems: list[str]
    currency: str
    base_currency: str
    sheet_rate: Decimal | None
    company_rate: Decimal | None
    lines: int
    skipped: int
    matched: int
    totals: SheetTotals
    # Gross at the company's monthly rate (what our own numbers will use).
    gross_base: Decimal | None
    sample: list[SheetLineOut]
    unknown: list[SheetLineOut]
    errors: list[dict[str, Any]]
    # Months already holding revenue for these channels, which this upload would replace.
    replaces: int


class SheetImportOut(BaseModel):
    revenue_import: RevenueImportOut
    statement: StatementOut | None
    lines_imported: int
    unknown: list[SheetLineOut]
    errors: list[dict[str, Any]]
    warnings: list[str]
