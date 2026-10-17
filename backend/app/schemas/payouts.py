import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.channels import PersonRef

Kind = Literal["manager", "team_lead"]


class IncentiveRateIn(BaseModel):
    kind: Kind
    rate_pct: Decimal = Field(ge=0, le=100, decimal_places=3)
    effective_from: date


class IncentiveRateOut(BaseModel):
    id: uuid.UUID
    kind: Kind
    rate_pct: Decimal
    effective_from: date


class IncentiveLineOut(BaseModel):
    employee: PersonRef
    channel_id: uuid.UUID
    channel_name: str
    kind: Kind
    days: int
    gross: Decimal
    currency: str
    rates: str
    amount: Decimal
    amount_base: Decimal


class IncentivePerson(BaseModel):
    employee: PersonRef
    manager_base: Decimal
    team_lead_base: Decimal
    total_base: Decimal


class IncentiveRunOut(BaseModel):
    month: str
    base_currency: str
    status: Literal["preview", "draft", "approved", "locked"]
    computed_at: datetime | None
    approved_by: str | None
    approved_at: datetime | None
    total_base: Decimal
    warnings: list[str]
    people: list[IncentivePerson]
    lines: list[IncentiveLineOut]


class MonthIn(BaseModel):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")


class CloseIn(MonthIn):
    notes: str | None = Field(default=None, max_length=2000)


class ReopenIn(MonthIn):
    reason: str = Field(min_length=3, max_length=500)


class CloseCheck(BaseModel):
    key: str
    ok: bool
    blocking: bool
    message: str


class CloseStatus(BaseModel):
    month: str
    closed: bool
    closed_by: str | None
    closed_at: datetime | None
    notes: str | None
    checks: list[CloseCheck]
    can_close: bool


class ClosedMonth(BaseModel):
    month: str
    closed_by: str | None
    closed_at: datetime
    gross: Decimal | None
    outstanding: Decimal | None
    incentives: Decimal | None


# ---- Deals ---------------------------------------------------------------------------------


class InstallmentIn(BaseModel):
    due_date: date
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    reference: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)


class InstallmentPaidIn(BaseModel):
    paid_on: date | None
    paid_amount: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=2)
    reference: str | None = Field(default=None, max_length=200)


class InstallmentOut(BaseModel):
    id: uuid.UUID
    due_date: date
    amount: Decimal
    paid_on: date | None
    paid_amount: Decimal | None
    reference: str | None
    notes: str | None
    overdue: bool


class ExpenseIn(BaseModel):
    spent_on: date
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    description: str = Field(min_length=1, max_length=300)

    @field_validator("description")
    @classmethod
    def strip(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Description is required")
        return value.strip()


class ExpenseOut(BaseModel):
    id: uuid.UUID
    spent_on: date
    amount: Decimal
    description: str


class EconomicsMonth(BaseModel):
    month: str
    gross: Decimal
    cms_fee: Decimal
    incentives: Decimal


class EconomicsOut(BaseModel):
    base_currency: str
    deal_type: str
    rights_cost: Decimal | None
    gross: Decimal
    cms_fee: Decimal
    incentives: Decimal
    expenses: Decimal
    owner_share: Decimal
    net_contribution: Decimal
    recovery_pct: Decimal | None
    remaining: Decimal | None
    installments_total: Decimal
    paid: Decimal
    payable: Decimal
    next_due_date: date | None
    next_due_amount: Decimal | None
    by_month: list[EconomicsMonth]
    warnings: list[str]
    installments: list[InstallmentOut]
    expense_items: list[ExpenseOut]
