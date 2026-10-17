import uuid
from datetime import date

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, OrgScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin

CHANNEL_STATUSES = ("active", "inactive")


class CmsPartner(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A YouTube CMS (or Facebook business portfolio) that channels are monetised through.

    Fee tiers and settlements are added in Part 4.
    """

    __tablename__ = "cms_partners"
    __table_args__ = (UniqueConstraint("organization_id", "name"),)

    name: Mapped[str] = mapped_column(String(120))
    platform: Mapped[str] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")


class Channel(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A YouTube channel or Facebook page the company operates."""

    __tablename__ = "channels"
    __table_args__ = (UniqueConstraint("organization_id", "platform", "external_id"),)

    platform: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    external_id: Mapped[str] = mapped_column(String(100))
    url: Mapped[str | None] = mapped_column(String(500))
    cms_partner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cms_partners.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="active")
    notes: Mapped[str | None] = mapped_column(Text)

    cms_partner: Mapped[CmsPartner | None] = relationship(lazy="joined")


class SlotAssignment(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A channel occupying a deal slot for a period. Never deleted: closing sets end_date.

    The open assignment of a slot is the one with end_date NULL.
    """

    __tablename__ = "slot_assignments"
    __table_args__ = (
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="date_order"),
        # At most one open assignment per slot.
        Index(
            "uq_slot_assignments_open_slot",
            "slot_id",
            unique=True,
            postgresql_where=text("end_date IS NULL"),
        ),
    )

    slot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("deal_slots.id", ondelete="RESTRICT"), index=True
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="RESTRICT"), index=True
    )
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    # "assigned" for a first assignment, "replacement" when it took over from another channel.
    start_reason: Mapped[str] = mapped_column(String(20), default="assigned")
    # "replaced" or "unassigned" once closed.
    end_reason: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(String(500))

    channel: Mapped[Channel] = relationship(lazy="joined")
