"""Bring YouTube's daily numbers into the tool for connected channels.

Revenue and views go into RevenueFact as provisional estimates (source "youtube"); the CMS's
monthly sheet later replaces a month with final figures. A sync never touches:
- a month the company has closed;
- a channel's month that already has final (CMS) figures.
Watch time and subscribers go into ChannelDailyStat. YouTube's answer is kept as it came.

The daily run fetches the last few days again because YouTube revises revenue for 2–3 days.
"""

import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ChannelDailyStat,
    Organization,
    RevenueFact,
    YouTubeConnection,
    YouTubeSnapshot,
)
from app.services import youtube_api
from app.services.month_close import closed_months
from app.services.youtube_tokens import TokenSetupError, decrypt

log = logging.getLogger(__name__)

DAILY_LOOKBACK_DAYS = 5
CHUNK_DAYS = 92
CENT = Decimal("0.01")


def _month(d: date) -> date:
    return d.replace(day=1)


def _chunks(start: date, end: date):
    while start <= end:
        stop = min(end, start + timedelta(days=CHUNK_DAYS - 1))
        yield start, stop
        start = stop + timedelta(days=1)


@dataclass
class ChannelOutcome:
    days: int = 0
    skipped_days: int = 0
    error: str | None = None


def sync_connection(
    db: Session, conn: YouTubeConnection, start: date, end: date, *, closed: set[date]
) -> ChannelOutcome:
    """Fetch [start, end] for one channel and save it. The caller commits."""
    out = ChannelOutcome()
    channel = conn.channel
    try:
        access = youtube_api.refresh(
            conn.token_uri,
            conn.client_id,
            decrypt(conn.client_secret_enc),
            decrypt(conn.refresh_token_enc),
        )
        if youtube_api.CHANNEL_SCOPE in (conn.scopes or []):
            info = youtube_api.my_channel(access)
            if info is not None:
                conn.subscribers, conn.videos = info["subscribers"], info["videos"]
                conn.totals_at = datetime.now(UTC)
        reports = [
            (a, b, youtube_api.channel_report(access, conn.google_channel_id, a, b))
            for a, b in _chunks(start, end)
        ]
    except youtube_api.TokenDead as exc:
        conn.status, conn.last_error = "expired", f"Permission expired or removed: {exc}"
        out.error = conn.last_error
        return out
    except (youtube_api.GoogleError, TokenSetupError) as exc:
        conn.status, conn.last_error = "error", str(exc)
        out.error = conn.last_error
        return out

    existing = {
        f.day: f
        for f in db.scalars(
            select(RevenueFact).where(
                RevenueFact.channel_id == channel.id,
                RevenueFact.day >= start,
                RevenueFact.day <= end,
            )
        )
    }
    # The CMS sheet saves a month's final figure on its first day, which may be outside
    # [start, end]: look at whole months.
    final_months = set(
        db.scalars(
            select(RevenueFact.day).where(
                RevenueFact.channel_id == channel.id,
                RevenueFact.state == "final",
                RevenueFact.day >= _month(start),
                RevenueFact.day <= end,
            )
        )
    )
    final_months = {_month(d) for d in final_months}
    stats = {
        s.day: s
        for s in db.scalars(
            select(ChannelDailyStat).where(
                ChannelDailyStat.channel_id == channel.id,
                ChannelDailyStat.day >= start,
                ChannelDailyStat.day <= end,
            )
        )
    }
    days: list[date] = []
    for a, b, report in reports:
        db.add(
            YouTubeSnapshot(
                organization_id=conn.organization_id,
                channel_id=channel.id,
                start_day=a,
                end_day=b,
                response={
                    "columnHeaders": report.get("columnHeaders", []),
                    "rows": report.get("rows", []),
                },
            )
        )
        for row in report.get("rows") or []:
            day = date.fromisoformat(row[0])
            revenue, views, minutes, gained, lost = (row[1:] + [None] * 5)[:5]
            days.append(day)
            stat = stats.get(day)
            if stat is None:
                stat = ChannelDailyStat(
                    organization_id=conn.organization_id, channel_id=channel.id, day=day
                )
                db.add(stat)
                stats[day] = stat
            stat.revenue = Decimal(str(revenue or 0)).quantize(CENT, rounding=ROUND_HALF_UP)
            stat.views = int(views) if views is not None else None
            stat.watch_minutes = int(minutes) if minutes is not None else None
            stat.subscribers_gained = int(gained) if gained is not None else None
            stat.subscribers_lost = int(lost) if lost is not None else None

            if _month(day) in closed or _month(day) in final_months:
                out.skipped_days += 1
                continue
            amount = Decimal(str(revenue or 0)).quantize(CENT, rounding=ROUND_HALF_UP)
            fact = existing.get(day)
            if fact is None:
                fact = RevenueFact(
                    organization_id=conn.organization_id,
                    channel_id=channel.id,
                    cms_partner_id=channel.cms_partner_id,
                    day=day,
                )
                db.add(fact)
                existing[day] = fact
            fact.gross_amount = amount
            fact.currency = "USD"
            fact.views = int(views) if views is not None else None
            fact.state = "provisional"
            fact.source = "youtube"
            out.days += 1

    conn.status, conn.last_error = "ok", None
    conn.last_synced_at = datetime.now(UTC)
    if days:
        first, last = min(days), max(days)
        conn.data_from = min(conn.data_from or first, first)
        conn.data_to = max(conn.data_to or last, last)
    return out


# ---- Running for many channels, in the background -------------------------------------------


@dataclass
class SyncProgress:
    running: bool = False
    started_at: datetime | None = None
    finished_at: datetime | None = None
    start: date | None = None
    end: date | None = None
    total: int = 0
    done: int = 0
    failed: int = 0
    days_saved: int = 0
    errors: list[str] = field(default_factory=list)


_progress: dict[uuid.UUID, SyncProgress] = {}
_lock = threading.Lock()


def progress(org_id: uuid.UUID) -> SyncProgress:
    return _progress.get(org_id) or SyncProgress()


def claim(org_id: uuid.UUID) -> bool:
    """Mark the company as syncing; False when a sync is already running for it."""
    with _lock:
        current = _progress.get(org_id)
        if current and current.running:
            return False
        _progress[org_id] = SyncProgress(running=True, started_at=datetime.now(UTC))
        return True


def default_range(today: date) -> tuple[date, date]:
    # YouTube's numbers arrive about 2–3 days late; yesterday is the newest day worth asking for.
    return today - timedelta(days=DAILY_LOOKBACK_DAYS), today - timedelta(days=1)


def run_sync(
    session_factory,
    org_id: uuid.UUID,
    start: date,
    end: date,
    channel_ids: list[uuid.UUID] | None = None,
) -> SyncProgress:
    """Sync every connected channel of the company (or the given ones), one commit each.
    The caller must have claimed the company first."""
    prog = _progress.setdefault(org_id, SyncProgress(running=True))
    prog.start, prog.end = start, end
    db: Session = session_factory()
    try:
        org = db.get(Organization, org_id)
        q = select(YouTubeConnection).where(YouTubeConnection.organization_id == org_id)
        if channel_ids is not None:
            q = q.where(YouTubeConnection.channel_id.in_(channel_ids))
        conn_ids = [c.id for c in db.scalars(q)]
        prog.total = len(conn_ids)
        closed = closed_months(db, org)
        for cid in conn_ids:
            conn = db.get(YouTubeConnection, cid)
            try:
                out = sync_connection(db, conn, start, end, closed=closed)
                db.commit()
            except Exception as exc:  # one channel must not stop the rest
                db.rollback()
                log.exception("YouTube sync failed for connection %s", cid)
                out = ChannelOutcome(error=str(exc))
            prog.done += 1
            prog.days_saved += out.days
            if out.error:
                prog.failed += 1
                if len(prog.errors) < 50:
                    prog.errors.append(f"{conn.channel.name}: {out.error}")
    finally:
        db.close()
        prog.running = False
        prog.finished_at = datetime.now(UTC)
    return prog


def run_daily_for_all(session_factory, today: date) -> None:
    """The scheduler's job: every company, the last few days."""
    db: Session = session_factory()
    try:
        org_ids = list(db.scalars(select(YouTubeConnection.organization_id).distinct()))
    finally:
        db.close()
    start, end = default_range(today)
    for org_id in org_ids:
        if claim(org_id):
            run_sync(session_factory, org_id, start, end)
