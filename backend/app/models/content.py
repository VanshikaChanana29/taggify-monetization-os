import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
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

OWNER_TYPES = ("licensor", "vendor", "owned")
# hybrid = a minimum guarantee paid up front, recouped against a revenue share.
DEAL_TYPES = ("fixed_fee", "revenue_share", "hybrid", "owned")
EXCLUSIVITY = ("exclusive", "non_exclusive")
DEAL_STATUSES = ("draft", "active", "terminated")
EPISODE_SCOPES = ("all", "ranges", "seasons")
PLATFORMS = ("youtube", "facebook")
SLOT_STATUSES = ("unassigned", "reserved", "pending_whitelist", "active", "replaced")
SLOT_PREFIX = {"youtube": "YT", "facebook": "FB"}


class ContentOwner(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Who the content comes from: Sony, another vendor, or the company's own IP."""

    __tablename__ = "content_owners"
    __table_args__ = (UniqueConstraint("organization_id", "name"),)

    name: Mapped[str] = mapped_column(String(120))
    owner_type: Mapped[str] = mapped_column(String(20))
    contact_name: Mapped[str | None] = mapped_column(String(120))
    contact_email: Mapped[str | None] = mapped_column(String(254))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")


class ContentDeal(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A licence for one show: what may be published, where, until when, on how many slots."""

    __tablename__ = "content_deals"
    __table_args__ = (
        CheckConstraint("term_end > term_start", name="term_order"),
        CheckConstraint("yt_slot_limit >= 0 AND fb_slot_limit >= 0", name="slot_limits"),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_owners.id", ondelete="RESTRICT"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    deal_type: Mapped[str] = mapped_column(String(20))
    # Stored status; "upcoming"/"expired" are derived from the term dates (services.deals).
    status: Mapped[str] = mapped_column(String(20), default="active")
    fee_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    revenue_share_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    term_start: Mapped[date] = mapped_column(Date)
    term_end: Mapped[date] = mapped_column(Date)
    episode_scope: Mapped[str] = mapped_column(String(10))
    is_worldwide: Mapped[bool] = mapped_column(default=True)
    territories: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    yt_slot_limit: Mapped[int] = mapped_column(default=0)
    fb_slot_limit: Mapped[int] = mapped_column(default=0)
    contract_url: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    # Rights inventory fields from the working document (§1).
    languages: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    exclusivity: Mapped[str | None] = mapped_column(String(20))
    renewal_terms: Mapped[str | None] = mapped_column(Text)
    notice_period_days: Mapped[int | None]
    clip_restrictions: Mapped[str | None] = mapped_column(Text)
    agreement_version: Mapped[str | None] = mapped_column(String(60))

    owner: Mapped[ContentOwner] = relationship(lazy="joined")
    episode_ranges: Mapped[list["DealEpisodeRange"]] = relationship(
        cascade="all, delete-orphan",
        order_by="(DealEpisodeRange.season, DealEpisodeRange.from_episode)",
    )
    slots: Mapped[list["DealSlot"]] = relationship(
        back_populates="deal",
        cascade="all, delete-orphan",
        order_by="(DealSlot.platform.desc(), DealSlot.number)",
    )


class DealEpisodeRange(UUIDPrimaryKeyMixin, Base):
    """Licensed episodes, e.g. 101–180, or S2 E1–20 when the deal counts by season."""

    __tablename__ = "deal_episode_ranges"
    __table_args__ = (CheckConstraint("to_episode >= from_episode", name="episode_order"),)

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_deals.id", ondelete="CASCADE"), index=True
    )
    season: Mapped[int | None]
    from_episode: Mapped[int]
    to_episode: Mapped[int]


class DealSlot(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """One authorised YouTube channel or Facebook page position in a deal (YT-01, FB-03…)."""

    __tablename__ = "deal_slots"
    __table_args__ = (UniqueConstraint("deal_id", "platform", "number"),)

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_deals.id", ondelete="CASCADE"), index=True
    )
    platform: Mapped[str] = mapped_column(String(20))
    number: Mapped[int]
    status: Mapped[str] = mapped_column(String(20), default="unassigned")
    notes: Mapped[str | None] = mapped_column(String(500))

    deal: Mapped[ContentDeal] = relationship(back_populates="slots")

    @property
    def code(self) -> str:
        return f"{SLOT_PREFIX[self.platform]}-{self.number:02d}"


class DealEpisode(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Metadata for one licensed episode (slide 4 step 03): title, synopsis, air date…"""

    __tablename__ = "deal_episodes"
    __table_args__ = (
        # NULLS NOT DISTINCT so episode 101 without a season is unique too.
        UniqueConstraint(
            "deal_id",
            "season",
            "episode_number",
            name="uq_deal_episode",
            postgresql_nulls_not_distinct=True,
        ),
    )

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_deals.id", ondelete="CASCADE"), index=True
    )
    season: Mapped[int | None]
    episode_number: Mapped[int]
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    air_date: Mapped[date | None] = mapped_column(Date)
    duration_minutes: Mapped[int | None]
    language: Mapped[str | None] = mapped_column(String(60))
    notes: Mapped[str | None] = mapped_column(Text)


class DealDocument(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A file attached to a deal: signed contract, annexure, rights evidence (slide 4 step 03).

    Stored in the database for now; moves to object storage with production (Part 8).
    """

    __tablename__ = "deal_documents"

    deal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_deals.id", ondelete="CASCADE"), index=True
    )
    file_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int]
    kind: Mapped[str] = mapped_column(String(30), default="contract")
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
