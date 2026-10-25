"""YouTube channels connected through the channel owner's Google permission (OAuth token).

The token lets the tool read the channel's analytics and revenue (read-only). Revenue and views
go into RevenueFact like any other revenue; the other daily numbers (watch time, subscribers)
go into ChannelDailyStat. Every answer from YouTube is also kept as it came (YouTubeSnapshot).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, OrgScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.channels import Channel

CONNECTION_STATUSES = ("ok", "expired", "error")


class YouTubeConnection(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """One channel's Google permission. A YouTube channel is connected in one company only."""

    __tablename__ = "youtube_connections"

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), unique=True
    )
    # The channel ID YouTube reported for this token (UC…), checked against channel.external_id.
    google_channel_id: Mapped[str] = mapped_column(String(64), unique=True)
    google_title: Mapped[str | None] = mapped_column(String(200))
    client_id: Mapped[str] = mapped_column(String(200))
    # Encrypted with TOKEN_ENCRYPTION_KEY; never returned by the API.
    client_secret_enc: Mapped[str] = mapped_column(Text)
    refresh_token_enc: Mapped[str] = mapped_column(Text)
    token_uri: Mapped[str] = mapped_column(String(200))
    scopes: Mapped[list[str]] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(20), default="ok")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    # Earliest and latest day YouTube has given us data for.
    data_from: Mapped[date | None] = mapped_column(Date)
    data_to: Mapped[date | None] = mapped_column(Date)
    # Channel totals from YouTube (only when the token may read channel details).
    subscribers: Mapped[int | None] = mapped_column(BigInteger)
    videos: Mapped[int | None]
    totals_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    connected_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    channel: Mapped[Channel] = relationship(lazy="joined")


class ChannelDailyStat(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Daily numbers besides revenue and views (those live in RevenueFact)."""

    __tablename__ = "channel_daily_stats"
    __table_args__ = (UniqueConstraint("channel_id", "day"),)

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    day: Mapped[date] = mapped_column(Date, index=True)
    # YouTube's own daily estimate, kept even after the CMS sheet makes the month final (the
    # money ledger then holds one monthly figure; this keeps the day-by-day shape for charts).
    revenue: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    views: Mapped[int | None] = mapped_column(BigInteger)
    watch_minutes: Mapped[int | None] = mapped_column(BigInteger)
    subscribers_gained: Mapped[int | None]
    subscribers_lost: Mapped[int | None]
    source: Mapped[str] = mapped_column(String(40), default="youtube_analytics")


class YouTubeSnapshot(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """YouTube's answer to one sync request, kept as it came (audit / where a number came from)."""

    __tablename__ = "youtube_snapshots"

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    start_day: Mapped[date] = mapped_column(Date)
    end_day: Mapped[date] = mapped_column(Date)
    api: Mapped[str] = mapped_column(String(60), default="youtubeAnalytics.v2.reports")
    response: Mapped[dict] = mapped_column(JSONB)
