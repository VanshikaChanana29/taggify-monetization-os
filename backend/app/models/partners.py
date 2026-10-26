"""Deal partners: people who buy a licence together with Taggify (e.g. Vanshika takes 50% of
the Sony deal).

The content owner (Sony) is unchanged. The partner pays Taggify their % of the licence fee,
runs their own channels under the deal, and is paid those channels' earnings after the CMS
fee once the CMS has paid Taggify, less TDS. Only founders see any of it.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, OrgScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class DealPartner(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    __tablename__ = "deal_partners"
    __table_args__ = (UniqueConstraint("organization_id", "name"),)

    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(30))
    # TDS deducted when paying this partner, in %; empty until the founders set it.
    tds_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")


class DealPartnerShare(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A partner's % of one deal: the same % of the licence fee is theirs to pay."""

    __tablename__ = "deal_partner_shares"
    __table_args__ = (UniqueConstraint("deal_id", "partner_id"),)

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_deals.id", ondelete="CASCADE"), index=True
    )
    partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("deal_partners.id", ondelete="RESTRICT"), index=True
    )
    share_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2))

    partner: Mapped[DealPartner] = relationship(lazy="joined")


class PartnerContribution(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Money the partner paid Taggify towards their share of a licence fee."""

    __tablename__ = "partner_contributions"

    partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("deal_partners.id", ondelete="CASCADE"), index=True
    )
    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_deals.id", ondelete="CASCADE"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))  # base currency
    received_on: Mapped[date] = mapped_column(Date)
    reference: Mapped[str | None] = mapped_column(String(120))


class PartnerPayout(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A payment Taggify made to the partner for one month's earnings."""

    __tablename__ = "partner_payouts"

    partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("deal_partners.id", ondelete="CASCADE"), index=True
    )
    month: Mapped[date] = mapped_column(Date, index=True)  # first of the month it pays for
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))  # paid to the partner, base currency
    tds_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"))
    paid_on: Mapped[date] = mapped_column(Date)
    reference: Mapped[str | None] = mapped_column(String(120))
