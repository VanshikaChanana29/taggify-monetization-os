import uuid
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


class TotalsOut(BaseModel):
    gross: Decimal
    fee: Decimal
    net: Decimal
    received: Decimal
    outstanding: Decimal
    complete: bool


class TrendPoint(TotalsOut):
    month: str


class AttentionItem(BaseModel):
    key: str
    title: str
    detail: str
    href: str
    severity: Literal["danger", "warning", "info"]
    amount: Decimal | None


class DealRecovery(BaseModel):
    id: uuid.UUID
    title: str
    owner: str
    status: str
    rights_cost: Decimal
    net_contribution: Decimal
    recovery_pct: Decimal | None
    payable: Decimal


class TopChannel(BaseModel):
    id: uuid.UUID
    name: str
    platform: str
    manager: str | None
    gross: Decimal


class AgingOut(BaseModel):
    cms_id: uuid.UUID
    cms_name: str
    buckets: dict[str, Decimal]
    total: Decimal


class TopPerson(BaseModel):
    id: uuid.UUID
    name: str
    channels: int
    gross: Decimal
    incentive: Decimal


class DashboardOut(BaseModel):
    month: str
    base_currency: str
    current: TotalsOut
    previous: TotalsOut
    incentives: Decimal | None
    rights_cost: Decimal
    net_contribution: Decimal
    recovery_pct: Decimal | None
    trend: list[TrendPoint]
    money: list[AttentionItem]
    operations: list[AttentionItem]
    deals: list[DealRecovery]
    channels: list[TopChannel]
    aging: list[AgingOut]
    people: list[TopPerson]


class CompanyRow(TotalsOut):
    organization_id: uuid.UUID
    name: str
    base_currency: str
    closed: bool
    current: bool


class GroupOut(BaseModel):
    month: str
    companies: list[CompanyRow]
    # Only when every company reports in the same currency.
    total: TotalsOut | None
    currency: str | None
