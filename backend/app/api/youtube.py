"""YouTube connections (owners' permission files), the daily sync and channel performance."""

import hmac
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import func, select

from app.api.channels import channel_items, get_channel
from app.api.deps import Auth, AuthContext, client_ip
from app.core.config import get_settings
from app.core.database import DbSession, SessionLocal
from app.models import (
    Channel,
    ChannelDailyStat,
    CmsPartner,
    RevenueFact,
    YouTubeConnection,
)
from app.schemas.youtube import (
    ChannelRankRow,
    ChannelYouTubeOut,
    ConnectionRow,
    ConnectionsOut,
    ConnectOut,
    ConnectRowOut,
    DailyPoint,
    DashboardChannelsOut,
    DayStat,
    IdentifyOut,
    RankedChannel,
    ShareSlice,
    SyncIn,
    SyncProgressOut,
)
from app.services import youtube_sync, youtube_tokens
from app.services.audit import record_audit
from app.services.channel_performance import (
    Metrics,
    ShareTable,
    company_channels,
    daily_series,
    period_metrics,
    team_names,
    youtube_info,
)
from app.services.deals import company_today

router = APIRouter(tags=["youtube"])

MAX_HISTORY_DAYS = 3 * 366


def _progress_out(org_id: uuid.UUID) -> SyncProgressOut:
    return SyncProgressOut(**vars(youtube_sync.progress(org_id)))


def _start_sync(
    tasks: BackgroundTasks,
    ctx: AuthContext,
    start: date,
    end: date,
    channel_ids: list[uuid.UUID] | None = None,
) -> bool:
    if not youtube_sync.claim(ctx.organization.id):
        return False
    tasks.add_task(
        youtube_sync.run_sync, SessionLocal, ctx.organization.id, start, end, channel_ids
    )
    return True


def _fetch_range(ctx: AuthContext, fetch_from: date | None) -> tuple[date, date]:
    today = company_today(ctx.organization)
    end = today - timedelta(days=1)
    start = fetch_from or today.replace(day=1)
    if start > end:
        start = end
    if (end - start).days > MAX_HISTORY_DAYS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Fetch at most 3 years of history at a time"
        )
    return start, end


async def _read_uploads(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    out, total = [], 0
    for f in files:
        content = await f.read(youtube_tokens.MAX_UPLOAD_BYTES + 1)
        total += len(content)
        if total > youtube_tokens.MAX_UPLOAD_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Upload is over 20 MB")
        out.append((f.filename or "file.json", content))
    return out


def _connect_out(result: youtube_tokens.ConnectResult, sync_started: bool) -> ConnectOut:
    return ConnectOut(
        connected=result.count("connected"),
        updated=result.count("updated"),
        not_in_company=result.count("not_in_company"),
        unusable=result.count("unusable"),
        duplicates=result.count("duplicate"),
        elsewhere=result.count("elsewhere"),
        sync_started=sync_started,
        rows=[ConnectRowOut(**vars(r)) for r in result.rows],
    )


def _setup_guard() -> None:
    try:
        youtube_tokens.encrypt("check")
    except youtube_tokens.TokenSetupError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


# ---- Connections ---------------------------------------------------------------------------


@router.get("/youtube/connections")
def list_connections(ctx: Auth, db: DbSession) -> ConnectionsOut:
    org_id = ctx.organization.id
    channels = list(
        db.scalars(
            select(Channel)
            .where(Channel.organization_id == org_id, Channel.platform == "youtube")
            .order_by(Channel.name)
        )
    )
    conns = {
        c.channel_id: c
        for c in db.scalars(
            select(YouTubeConnection).where(YouTubeConnection.organization_id == org_id)
        )
    }
    cms = dict(
        db.execute(
            select(CmsPartner.id, CmsPartner.name).where(CmsPartner.organization_id == org_id)
        ).all()
    )
    rows = []
    for ch in channels:
        c = conns.get(ch.id)
        rows.append(
            ConnectionRow(
                channel_id=ch.id,
                channel_name=ch.name,
                external_id=ch.external_id,
                cms_name=cms.get(ch.cms_partner_id),
                status=c.status if c else "not_connected",  # type: ignore[arg-type]
                youtube_title=c.google_title if c else None,
                last_synced_at=c.last_synced_at if c else None,
                data_from=c.data_from if c else None,
                data_to=c.data_to if c else None,
                subscribers=c.subscribers if c else None,
                last_error=c.last_error if c else None,
            )
        )
    order = {"expired": 0, "error": 1, "not_connected": 2, "ok": 3}
    rows.sort(key=lambda r: (order[r.status], r.channel_name.lower()))
    return ConnectionsOut(
        youtube_channels=len(channels),
        connected=sum(r.status == "ok" for r in rows),
        expired=sum(r.status in ("expired", "error") for r in rows),
        not_connected=sum(r.status == "not_connected" for r in rows),
        last_sync=max((c.last_synced_at for c in conns.values() if c.last_synced_at), default=None),
        sync=_progress_out(org_id),
        rows=rows,
    )


@router.post("/youtube/tokens")
async def upload_tokens(
    ctx: Auth,
    request: Request,
    db: DbSession,
    tasks: BackgroundTasks,
    files: Annotated[list[UploadFile], File()],
    fetch_from: Annotated[date | None, Form()] = None,
) -> ConnectOut:
    """Connect this company's channels from a .zip or .json permission files. Channels that are
    not in this company are listed and nothing is saved for them."""
    _setup_guard()
    start, end = _fetch_range(ctx, fetch_from)
    token_files = youtube_tokens.read_files(await _read_uploads(files))
    if not token_files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No .json files found")
    verified = youtube_tokens.verify_all(token_files)
    result = youtube_tokens.connect(
        db, ctx.organization, ctx.user.id, verified, ip=client_ip(request)
    )
    db.commit()
    started = bool(result.synced_channel_ids) and _start_sync(
        tasks, ctx, start, end, result.synced_channel_ids
    )
    return _connect_out(result, started)


@router.post("/youtube/identify")
async def identify_token(ctx: Auth, file: Annotated[UploadFile, File()]) -> IdentifyOut:
    """Which channel a permission file belongs to (fills the New channel form). Saves nothing."""
    files = youtube_tokens.read_files(await _read_uploads([file]))
    if not files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a .json token file")
    v = youtube_tokens.verify(files[0])
    if v.problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, v.problem)
    return IdentifyOut(channel_id=v.channel_id, title=v.title)


@router.post("/channels/{channel_id}/youtube-token")
async def connect_channel(
    channel_id: uuid.UUID,
    ctx: Auth,
    request: Request,
    db: DbSession,
    tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
    fetch_from: Annotated[date | None, Form()] = None,
) -> ConnectOut:
    """Connect one channel; the file must be this channel's permission."""
    _setup_guard()
    channel = get_channel(db, ctx, channel_id)
    if channel.platform != "youtube":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only YouTube channels")
    start, end = _fetch_range(ctx, fetch_from)
    files = youtube_tokens.read_files(await _read_uploads([file]))
    if not files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a .json token file")
    v = youtube_tokens.verify(files[0])
    if v.problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, v.problem)
    if v.channel_id != channel.external_id:
        who = f"'{v.title}'" if v.title else v.channel_id
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"This file is for {who} ({v.channel_id}), not {channel.name} ({channel.external_id})",
        )
    result = youtube_tokens.connect(db, ctx.organization, ctx.user.id, [v], ip=client_ip(request))
    row = result.rows[0]
    if row.result == "elsewhere":
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, row.message)
    db.commit()
    started = _start_sync(tasks, ctx, start, end, [channel.id])
    return _connect_out(result, started)


@router.delete("/channels/{channel_id}/youtube-token", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_channel(channel_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    """Forget the channel's permission. Revenue already saved stays."""
    channel = get_channel(db, ctx, channel_id)
    conn = db.scalar(select(YouTubeConnection).where(YouTubeConnection.channel_id == channel.id))
    if conn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This channel is not connected")
    db.delete(conn)
    record_audit(
        db,
        "youtube.disconnected",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="channel",
        entity_id=channel.id,
        details={"name": channel.name},
        ip=client_ip(request),
    )
    db.commit()


@router.get("/channels/{channel_id}/youtube")
def channel_youtube(
    channel_id: uuid.UUID, ctx: Auth, db: DbSession, days: Annotated[int, Query(ge=7, le=90)] = 30
) -> ChannelYouTubeOut:
    channel = get_channel(db, ctx, channel_id)
    conn = db.scalar(select(YouTubeConnection).where(YouTubeConnection.channel_id == channel.id))
    since = company_today(ctx.organization) - timedelta(days=days)
    facts = {
        f.day: f
        for f in db.scalars(
            select(RevenueFact).where(
                RevenueFact.channel_id == channel.id, RevenueFact.day >= since
            )
        )
    }
    stats = {
        s.day: s
        for s in db.scalars(
            select(ChannelDailyStat).where(
                ChannelDailyStat.channel_id == channel.id, ChannelDailyStat.day >= since
            )
        )
    }
    out_days = []
    for day in sorted(set(facts) | set(stats), reverse=True):
        f, s = facts.get(day), stats.get(day)
        out_days.append(
            DayStat(
                day=day,
                revenue=f.gross_amount if f else None,
                currency=f.currency if f else None,
                state=f.state if f else None,
                views=f.views if f else None,
                watch_minutes=s.watch_minutes if s else None,
                subscribers_gained=s.subscribers_gained if s else None,
                subscribers_lost=s.subscribers_lost if s else None,
            )
        )
    return ChannelYouTubeOut(
        status=conn.status if conn else "not_connected",  # type: ignore[arg-type]
        youtube_title=conn.google_title if conn else None,
        last_synced_at=conn.last_synced_at if conn else None,
        data_from=conn.data_from if conn else None,
        data_to=conn.data_to if conn else None,
        subscribers=conn.subscribers if conn else None,
        videos=conn.videos if conn else None,
        last_error=conn.last_error if conn else None,
        days=out_days,
    )


# ---- Sync ---------------------------------------------------------------------------------


@router.post("/youtube/sync", status_code=status.HTTP_202_ACCEPTED)
def start_sync(body: SyncIn, ctx: Auth, db: DbSession, tasks: BackgroundTasks) -> SyncProgressOut:
    """Sync now (last few days), or fetch history for any dates; runs in the background."""
    today = company_today(ctx.organization)
    start, end = youtube_sync.default_range(today)
    if body.start:
        start = body.start
    if body.end:
        end = min(body.end, today - timedelta(days=1))
    if start > end:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick dates before today")
    if (end - start).days > MAX_HISTORY_DAYS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Fetch at most 3 years of history at a time"
        )
    ids = None
    if body.channel_id:
        get_channel(db, ctx, body.channel_id)
        ids = [body.channel_id]
    has_any = db.scalar(
        select(func.count())
        .select_from(YouTubeConnection)
        .where(YouTubeConnection.organization_id == ctx.organization.id)
    )
    if not has_any:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No YouTube channel is connected")
    if not _start_sync(tasks, ctx, start, end, ids):
        raise HTTPException(status.HTTP_409_CONFLICT, "A sync is already running for this company")
    return _progress_out(ctx.organization.id)


@router.get("/youtube/sync")
def sync_status(ctx: Auth) -> SyncProgressOut:
    return _progress_out(ctx.organization.id)


@router.post("/internal/youtube-sync", status_code=status.HTTP_202_ACCEPTED)
def scheduled_sync(
    tasks: BackgroundTasks, x_sync_secret: Annotated[str | None, Header()] = None
) -> dict:
    """Called once a day by the scheduler (cron-job.org) with the X-Sync-Secret header."""
    secret = get_settings().sync_secret
    if not secret or not x_sync_secret or not hmac.compare_digest(secret, x_sync_secret):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong or missing sync secret")
    tasks.add_task(youtube_sync.run_daily_for_all, SessionLocal, date.today())
    return {"started": True}


# ---- Dashboard: channels section ----------------------------------------------------------


def _ranked(item, m: Metrics) -> RankedChannel:
    return RankedChannel(
        channel_id=item.id,
        name=item.name,
        revenue=m.revenue,
        views=m.views,
        revenue_change_pct=m.revenue_change_pct,
    )


@router.get("/dashboard/channels")
def dashboard_channels(
    ctx: Auth,
    db: DbSession,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
    start: date | None = None,
    end: date | None = None,
) -> DashboardChannelsOut:
    """Our channels for a month (or any start–end dates): totals, the daily line, who earns
    what, best and falling, and every channel ranked by revenue."""
    today = company_today(ctx.organization)
    yesterday = today - timedelta(days=1)
    if start and end:
        if start > end:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Start must be before end")
        if (end - start).days > MAX_HISTORY_DAYS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick at most 3 years")
        month = None
    else:
        start = date.fromisoformat(f"{month}-01") if month else yesterday.replace(day=1)
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        end = min(next_month - timedelta(days=1), yesterday)
        if end < start:
            end = start
    org_id = ctx.organization.id
    items = channel_items(db, company_channels(db, org_id))
    metrics = period_metrics(db, org_id, start, end)
    teams = team_names(db, {i.manager.id for i in items if i.manager})
    yt = youtube_info(db, org_id)

    total = Metrics()
    watch, subs = 0, 0
    has_watch = has_subs = False
    shares = {"cms": ShareTable(), "team": ShareTable(), "deal": ShareTable()}
    ranked = []
    for item in items:
        m = metrics.get(item.id)
        if m is None:
            continue
        total.revenue += m.revenue
        total.previous_revenue += m.previous_revenue
        total.estimate += m.estimate
        total.views += m.views
        if m.watch_minutes is not None:
            watch, has_watch = watch + m.watch_minutes, True
        if m.subscribers_net is not None:
            subs, has_subs = subs + m.subscribers_net, True
        if m.revenue > 0:
            shares["cms"].add(item.cms_name or "No CMS", m.revenue, item.cms_partner_id)
            team = teams.get(item.manager.id) if item.manager else None
            shares["team"].add(team[1] if team else "No team", m.revenue, team[0] if team else None)
            shares["deal"].add(
                item.slots[0].deal_title if item.slots else "No deal",
                m.revenue,
                item.slots[0].deal_id if item.slots else None,
            )
            ranked.append((item, m))
    total.watch_minutes = watch if has_watch else None
    total.subscribers_net = subs if has_subs else None
    ranked.sort(key=lambda x: x[1].revenue, reverse=True)
    movers = [
        x for x in ranked if x[1].previous_revenue >= 10 and x[1].revenue_change_pct is not None
    ]
    movers.sort(key=lambda x: x[1].revenue_change_pct)
    youtube_channels = sum(i.platform == "youtube" for i in items)
    return DashboardChannelsOut(
        month=month or f"{start:%Y-%m}",
        start=start,
        end=end,
        currency="USD",
        revenue=total.revenue,
        previous_revenue=total.previous_revenue,
        revenue_change_pct=total.revenue_change_pct,
        estimate_share_pct=total.estimate_share_pct,
        views=total.views,
        rpm=total.rpm,
        watch_hours=total.watch_hours,
        subscribers_net=total.subscribers_net,
        channels_with_revenue=len(ranked),
        youtube_channels=youtube_channels,
        connected=sum(i.status == "ok" for i in yt.values()),
        expired=sum(i.status != "ok" for i in yt.values()),
        last_sync=max((i.last_synced_at for i in yt.values() if i.last_synced_at), default=None),
        daily=[DailyPoint(**d) for d in daily_series(db, org_id, start, end)],
        share_by={k: [ShareSlice(**r) for r in t.top(5)] for k, t in shares.items()},
        top=[_ranked(i, m) for i, m in ranked[:10]],
        rising=[_ranked(i, m) for i, m in reversed(movers[-5:]) if m.revenue_change_pct > 0],
        falling=[_ranked(i, m) for i, m in movers[:5] if m.revenue_change_pct < 0],
        rows=[
            ChannelRankRow(
                channel_id=i.id,
                name=i.name,
                platform=i.platform,
                cms_name=i.cms_name,
                manager=i.manager.name if i.manager else None,
                team=teams[i.manager.id][1] if i.manager and i.manager.id in teams else None,
                revenue=m.revenue,
                share_pct=(m.revenue / total.revenue * 100).quantize(Decimal("0.1"))
                if total.revenue
                else Decimal(0),
                previous_revenue=m.previous_revenue,
                revenue_change_pct=m.revenue_change_pct,
                views=m.views,
                rpm=m.rpm,
                watch_hours=m.watch_hours,
                subscribers_net=m.subscribers_net,
                youtube_status=yt[i.id].status if i.id in yt else "not_connected",
            )
            for i, m in ranked
        ],
    )
