"""How our channels are doing over a period: one place for the Channels list and the dashboard.

- Revenue comes from the money ledger (RevenueFact, USD): the CMS sheet's final figure where it
  has arrived, YouTube's estimate otherwise.
- Views, watch time and subscribers come from YouTube's daily numbers (ChannelDailyStat) when
  the channel is connected, else from the ledger's views.
- The daily line on the dashboard uses YouTube's daily estimate, which keeps its day-by-day shape
  even after the CMS sheet replaces a month with one monthly figure.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Channel, ChannelDailyStat, RevenueFact, Team, YouTubeConnection
from app.services.teams import open_memberships

CURRENCY = "USD"
ZERO = Decimal(0)


@dataclass
class Metrics:
    revenue: Decimal = ZERO
    views: int = 0
    estimate: Decimal = ZERO  # part of revenue that is still a YouTube estimate
    previous_revenue: Decimal = ZERO
    watch_minutes: int | None = None
    subscribers_net: int | None = None

    @property
    def rpm(self) -> Decimal | None:
        return (self.revenue / self.views * 1000).quantize(Decimal("0.01")) if self.views else None

    @property
    def watch_hours(self) -> Decimal | None:
        if self.watch_minutes is None:
            return None
        return (Decimal(self.watch_minutes) / 60).quantize(Decimal("0.1"))

    @property
    def revenue_change_pct(self) -> Decimal | None:
        return pct(self.revenue, self.previous_revenue)

    @property
    def estimate_share_pct(self) -> Decimal:
        return (self.estimate / self.revenue * 100).quantize(Decimal("1")) if self.revenue else ZERO

    def out(self) -> dict:
        return {
            "revenue": self.revenue,
            "views": self.views,
            "rpm": self.rpm,
            "watch_hours": self.watch_hours,
            "subscribers_net": self.subscribers_net,
            "previous_revenue": self.previous_revenue,
            "revenue_change_pct": self.revenue_change_pct,
            "estimate_share_pct": self.estimate_share_pct,
        }


def pct(now: Decimal, before: Decimal) -> Decimal | None:
    if not before:
        return None
    return ((now - before) / before * 100).quantize(Decimal("0.1"))


def previous_period(start: date, end: date) -> tuple[date, date]:
    length = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    return prev_end - timedelta(days=length - 1), prev_end


def _ledger(db: Session, org_id: uuid.UUID, start: date, end: date):
    return db.execute(
        select(
            RevenueFact.channel_id,
            RevenueFact.state,
            func.sum(RevenueFact.gross_amount),
            func.sum(RevenueFact.views),
        )
        .where(
            RevenueFact.organization_id == org_id,
            RevenueFact.currency == CURRENCY,
            RevenueFact.day >= start,
            RevenueFact.day <= end,
        )
        .group_by(RevenueFact.channel_id, RevenueFact.state)
    ).all()


def period_metrics(
    db: Session, org_id: uuid.UUID, start: date, end: date
) -> dict[uuid.UUID, Metrics]:
    out: dict[uuid.UUID, Metrics] = defaultdict(Metrics)
    for channel_id, state, revenue, views in _ledger(db, org_id, start, end):
        m = out[channel_id]
        m.revenue += revenue or 0
        m.views += int(views or 0)
        if state != "final":
            m.estimate += revenue or 0
    prev_start, prev_end = previous_period(start, end)
    for channel_id, _state, revenue, _views in _ledger(db, org_id, prev_start, prev_end):
        out[channel_id].previous_revenue += revenue or 0
    stats = db.execute(
        select(
            ChannelDailyStat.channel_id,
            func.sum(ChannelDailyStat.views),
            func.sum(ChannelDailyStat.watch_minutes),
            func.sum(ChannelDailyStat.subscribers_gained),
            func.sum(ChannelDailyStat.subscribers_lost),
        )
        .where(
            ChannelDailyStat.organization_id == org_id,
            ChannelDailyStat.day >= start,
            ChannelDailyStat.day <= end,
        )
        .group_by(ChannelDailyStat.channel_id)
    ).all()
    for channel_id, views, minutes, gained, lost in stats:
        m = out[channel_id]
        if views is not None:
            m.views = int(views)  # YouTube's daily views are complete; the ledger may lack them
        m.watch_minutes = int(minutes) if minutes is not None else None
        m.subscribers_net = int((gained or 0) - (lost or 0))
    return dict(out)


@dataclass
class YouTubeInfo:
    status: str = "not_connected"
    subscribers: int | None = None
    last_synced_at: datetime | None = None


def youtube_info(db: Session, org_id: uuid.UUID) -> dict[uuid.UUID, YouTubeInfo]:
    return {
        c.channel_id: YouTubeInfo(c.status, c.subscribers, c.last_synced_at)
        for c in db.scalars(
            select(YouTubeConnection).where(YouTubeConnection.organization_id == org_id)
        )
    }


def team_names(db: Session, manager_ids: set[uuid.UUID]) -> dict[uuid.UUID, tuple[uuid.UUID, str]]:
    """Manager → (team id, team name) for managers currently in a team."""
    memberships = open_memberships(db, manager_ids)
    ids = {m.team_id for m in memberships.values()}
    names = {t.id: t.name for t in db.scalars(select(Team).where(Team.id.in_(ids)))} if ids else {}
    return {e: (m.team_id, names.get(m.team_id, "")) for e, m in memberships.items()}


def daily_series(db: Session, org_id: uuid.UUID, start: date, end: date) -> list[dict]:
    rows = db.execute(
        select(
            ChannelDailyStat.day,
            func.sum(ChannelDailyStat.revenue),
            func.sum(ChannelDailyStat.views),
        )
        .where(
            ChannelDailyStat.organization_id == org_id,
            ChannelDailyStat.day >= start,
            ChannelDailyStat.day <= end,
        )
        .group_by(ChannelDailyStat.day)
        .order_by(ChannelDailyStat.day)
    ).all()
    return [{"day": d, "revenue": r or ZERO, "views": int(v or 0)} for d, r, v in rows]


@dataclass
class Share:
    label: str
    revenue: Decimal = ZERO
    channels: int = 0
    key: str | None = None  # CMS / team / deal id, so the dashboard can open the filtered list


@dataclass
class ShareTable:
    rows: dict[str, Share] = field(default_factory=dict)

    def add(self, label: str, revenue: Decimal, key: object = None) -> None:
        s = self.rows.setdefault(label, Share(label, key=str(key) if key else None))
        s.revenue += revenue
        s.channels += 1

    def top(self, n: int = 5) -> list[dict]:
        """The n biggest, the rest folded into "Other" (a pie stays readable)."""
        ordered = sorted(
            (s for s in self.rows.values() if s.revenue > 0), key=lambda s: s.revenue, reverse=True
        )
        head, tail = ordered[:n], ordered[n:]
        out = [vars(s) for s in head]
        if tail:
            out.append(
                {
                    "label": f"Other ({len(tail)})",
                    "revenue": sum((s.revenue for s in tail), ZERO),
                    "channels": sum(s.channels for s in tail),
                    "key": None,
                }
            )
        return out


def company_channels(db: Session, org_id: uuid.UUID) -> list[Channel]:
    return list(
        db.scalars(select(Channel).where(Channel.organization_id == org_id).order_by(Channel.name))
    )
