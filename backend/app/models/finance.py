import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, OrgScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.channels import Channel, CmsPartner

# Months are stored as the first day of the month (date(2026, 10, 1)).


class RevenueImport(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """One uploaded revenue CSV and what happened to its rows."""

    __tablename__ = "revenue_imports"

    file_name: Mapped[str] = mapped_column(String(255))
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    rows_total: Mapped[int] = mapped_column(default=0)
    rows_created: Mapped[int] = mapped_column(default=0)
    rows_updated: Mapped[int] = mapped_column(default=0)
    rows_failed: Mapped[int] = mapped_column(default=0)
    errors: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, server_default="[]")


class RevenueFact(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Gross earnings of one channel on one day (PDF slide 16, step 1).

    cms_partner_id is a snapshot of the channel's CMS when the row was imported, so a
    channel moving to another CMS later does not move past revenue with it.
    """

    __tablename__ = "revenue_facts"
    __table_args__ = (UniqueConstraint("channel_id", "day"),)

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="RESTRICT"), index=True
    )
    cms_partner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cms_partners.id", ondelete="RESTRICT"), index=True
    )
    day: Mapped[date] = mapped_column(Date, index=True)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    views: Mapped[int | None] = mapped_column(BigInteger)
    state: Mapped[str] = mapped_column(String(20), default="provisional")  # provisional / final
    source: Mapped[str] = mapped_column(String(40), default="csv")
    import_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("revenue_imports.id", ondelete="SET NULL")
    )

    channel: Mapped[Channel] = relationship(lazy="joined")


class FxRate(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Monthly rate to convert a currency into the company's base currency (e.g. USD→INR)."""

    __tablename__ = "fx_rates"
    __table_args__ = (UniqueConstraint("organization_id", "month", "currency"),)

    month: Mapped[date] = mapped_column(Date)
    currency: Mapped[str] = mapped_column(String(3))
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 6))


class CmsFeeSchedule(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A CMS's commission tiers from a date onward (PDF slide 9, slide 16 step 3).

    tiers: [{"from_amount": "0", "rate_pct": "20"}, {"from_amount": "20000", "rate_pct": "15"}]
    tier_type "whole": the rate of the highest tier reached applies to all of the month's gross.
    tier_type "marginal": each band of gross is charged its own rate (like tax slabs).
    """

    __tablename__ = "cms_fee_schedules"
    __table_args__ = (UniqueConstraint("cms_partner_id", "effective_from"),)

    cms_partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cms_partners.id", ondelete="CASCADE"), index=True
    )
    effective_from: Mapped[date] = mapped_column(Date)
    tier_type: Mapped[str] = mapped_column(String(10))
    currency: Mapped[str] = mapped_column(String(3))
    tiers: Mapped[list[dict[str, str]]] = mapped_column(JSONB)
    notes: Mapped[str | None] = mapped_column(Text)


class CmsStatement(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """What the CMS itself reported for a month, to reconcile against our numbers."""

    __tablename__ = "cms_statements"
    __table_args__ = (UniqueConstraint("cms_partner_id", "month"),)

    cms_partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cms_partners.id", ondelete="CASCADE"), index=True
    )
    month: Mapped[date] = mapped_column(Date)
    currency: Mapped[str] = mapped_column(String(3))
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    fee_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    net_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    reference: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    # "manual" = totals typed in; "file" = the CMS's per-channel breakdown was uploaded.
    source: Mapped[str] = mapped_column(String(10), server_default="manual")
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_data: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # Goes up each time the statement is replaced; earlier versions stay in the activity log.
    version: Mapped[int] = mapped_column(server_default="1")

    lines: Mapped[list["CmsStatementLine"]] = relationship(
        cascade="all, delete-orphan", order_by="CmsStatementLine.line_no"
    )


class CmsStatementLine(UUIDPrimaryKeyMixin, Base):
    """One channel's line on a CMS statement file (working document §3: "match statement
    lines to channel IDs, month, gross, fee …")."""

    __tablename__ = "cms_statement_lines"

    statement_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cms_statements.id", ondelete="CASCADE"), index=True
    )
    line_no: Mapped[int]
    external_id: Mapped[str] = mapped_column(String(100))
    channel_name: Mapped[str | None] = mapped_column(String(200))
    # Our channel with that ID, if there is one.
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("channels.id", ondelete="SET NULL"), index=True
    )
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    fee_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    net_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))


class BankReceipt(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Money that actually reached the bank from a CMS, for a settlement month (slide 10)."""

    __tablename__ = "bank_receipts"

    cms_partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cms_partners.id", ondelete="RESTRICT"), index=True
    )
    month: Mapped[date] = mapped_column(Date, index=True)
    received_on: Mapped[date] = mapped_column(Date)
    # What the CMS paid, in the currency it paid in (USD, AED, INR…).
    currency: Mapped[str] = mapped_column(String(3), server_default="INR")
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    # What the bank actually credited in the company's base currency. The difference from
    # the month's FX valuation is an FX gain/loss, not a change in what the CMS owes.
    amount_base: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    reference: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)

    cms_partner: Mapped[CmsPartner] = relationship(lazy="joined")


class CmsAdjustment(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A correction to what a CMS owes for a month (tax withheld, dispute, revision…)."""

    __tablename__ = "cms_adjustments"

    cms_partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cms_partners.id", ondelete="RESTRICT"), index=True
    )
    month: Mapped[date] = mapped_column(Date, index=True)
    # In base currency; negative reduces what the CMS owes.
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    reason: Mapped[str] = mapped_column(String(300))
