"""Part 4B: incentives, deal economics and month close (PDF slides 11, 12, 13, 16)."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, OrgScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.people import Employee

INCENTIVE_KINDS = ("manager", "team_lead")


class IncentiveRate(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A person's incentive % of channel gross, from a date onward (slide 12).

    kind "manager": on the gross of channels they manage.
    kind "team_lead": on the gross of channels managed by their team's members.
    A newer row for the same person and kind replaces the older one from its date.
    """

    __tablename__ = "incentive_rates"
    __table_args__ = (UniqueConstraint("employee_id", "kind", "effective_from"),)

    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(20))
    rate_pct: Mapped[Decimal] = mapped_column(Numeric(6, 3))
    effective_from: Mapped[date]

    employee: Mapped[Employee] = relationship(lazy="joined")


class IncentiveRun(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A month's incentive calculation: draft → approved → locked (slide 16 step 7)."""

    __tablename__ = "incentive_runs"
    __table_args__ = (UniqueConstraint("organization_id", "month"),)

    month: Mapped[date]
    status: Mapped[str] = mapped_column(String(20), default="draft")
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_base: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    warnings: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")

    lines: Mapped[list["IncentiveLine"]] = relationship(
        cascade="all, delete-orphan", order_by="IncentiveLine.amount_base.desc()"
    )


class IncentiveLine(UUIDPrimaryKeyMixin, Base):
    """One person's incentive from one channel in a run."""

    __tablename__ = "incentive_lines"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("incentive_runs.id", ondelete="CASCADE"), index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), index=True
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(String(20))
    days: Mapped[int]
    gross: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    amount_base: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    rates: Mapped[str] = mapped_column(String(100))  # e.g. "1%" or "1% → 1.5%"


class DealInstallment(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """What is owed to the content owner and when (slide 11: cash payable, not rights cost)."""

    __tablename__ = "deal_installments"

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_deals.id", ondelete="CASCADE"), index=True
    )
    due_date: Mapped[date]
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    paid_on: Mapped[date | None]
    paid_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    reference: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)


class DealExpense(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Operating cost charged to a deal (editing, promotion…), in base currency."""

    __tablename__ = "deal_expenses"

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_deals.id", ondelete="CASCADE"), index=True
    )
    spent_on: Mapped[date]
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    description: Mapped[str] = mapped_column(String(300))


class MonthClose(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A closed (locked) month with a snapshot of its numbers (slide 16 step 8).

    While closed, revenue for the month cannot be changed and fee tiers that would
    re-price it cannot be added; corrections go in as adjustments.
    """

    __tablename__ = "month_closes"
    __table_args__ = (UniqueConstraint("organization_id", "month"),)

    month: Mapped[date]
    closed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    notes: Mapped[str | None] = mapped_column(Text)
