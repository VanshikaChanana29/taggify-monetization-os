import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, model_validator

ConnectResultKind = Literal[
    "connected", "updated", "not_in_company", "elsewhere", "duplicate", "unusable"
]


class ConnectRowOut(BaseModel):
    file: str
    result: ConnectResultKind
    channel_id: str | None
    channel_name: str | None
    youtube_title: str | None
    tool_channel_id: uuid.UUID | None
    message: str | None


class ConnectOut(BaseModel):
    connected: int
    updated: int
    not_in_company: int
    unusable: int
    duplicates: int
    elsewhere: int
    sync_started: bool
    rows: list[ConnectRowOut]


class IdentifyOut(BaseModel):
    channel_id: str
    title: str | None


class SyncProgressOut(BaseModel):
    running: bool
    started_at: datetime | None
    finished_at: datetime | None
    start: date | None
    end: date | None
    total: int
    done: int
    failed: int
    days_saved: int
    errors: list[str]


class ConnectionRow(BaseModel):
    channel_id: uuid.UUID
    channel_name: str
    external_id: str
    cms_name: str | None
    status: Literal["ok", "expired", "error", "not_connected"]
    youtube_title: str | None
    last_synced_at: datetime | None
    data_from: date | None
    data_to: date | None
    subscribers: int | None
    last_error: str | None


class ConnectionsOut(BaseModel):
    youtube_channels: int
    connected: int
    expired: int
    not_connected: int
    last_sync: datetime | None
    sync: SyncProgressOut
    rows: list[ConnectionRow]


class SyncIn(BaseModel):
    start: date | None = None
    end: date | None = None
    channel_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def order(self):
        if self.start and self.end and self.start > self.end:
            raise ValueError("Start date must be on or before the end date")
        return self


class ChannelYouTubeOut(BaseModel):
    status: Literal["ok", "expired", "error", "not_connected"]
    youtube_title: str | None
    last_synced_at: datetime | None
    data_from: date | None
    data_to: date | None
    subscribers: int | None
    videos: int | None
    last_error: str | None
    days: list["DayStat"]


class DayStat(BaseModel):
    day: date
    revenue: Decimal | None
    currency: str | None
    state: str | None
    views: int | None
    watch_minutes: int | None
    subscribers_gained: int | None
    subscribers_lost: int | None


class DailyPoint(BaseModel):
    day: date
    revenue: Decimal
    views: int


class ShareSlice(BaseModel):
    label: str
    revenue: Decimal
    channels: int
    key: str | None = None


class RankedChannel(BaseModel):
    channel_id: uuid.UUID
    name: str
    revenue: Decimal
    views: int
    revenue_change_pct: Decimal | None


class ChannelRankRow(BaseModel):
    """Every channel with numbers in the period, for the dashboard's full ranking."""

    channel_id: uuid.UUID
    name: str
    platform: str
    cms_name: str | None
    manager: str | None
    team: str | None
    revenue: Decimal
    share_pct: Decimal  # of the period's channel revenue
    previous_revenue: Decimal
    revenue_change_pct: Decimal | None
    views: int
    rpm: Decimal | None
    watch_hours: Decimal | None
    subscribers_net: int | None
    youtube_status: str


class DashboardChannelsOut(BaseModel):
    """The dashboard's channel section for one month (revenue in USD)."""

    month: str
    start: date
    end: date
    currency: str
    revenue: Decimal
    previous_revenue: Decimal
    revenue_change_pct: Decimal | None
    estimate_share_pct: Decimal
    views: int
    rpm: Decimal | None
    watch_hours: Decimal | None
    subscribers_net: int | None
    channels_with_revenue: int
    youtube_channels: int
    connected: int
    expired: int
    last_sync: datetime | None
    daily: list[DailyPoint]
    share_by: dict[str, list[ShareSlice]]  # "cms", "team", "deal"
    top: list[RankedChannel]
    rising: list[RankedChannel]
    falling: list[RankedChannel]
    rows: list[ChannelRankRow]


ChannelYouTubeOut.model_rebuild()
