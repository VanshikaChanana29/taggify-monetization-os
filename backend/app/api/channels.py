import io
import uuid
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import Auth, AuthContext, client_ip
from app.api.pagination import Page, Pagination, paginate
from app.core.database import DbSession
from app.models import (
    Channel,
    ChannelManagerAssignment,
    CmsPartner,
    ContentDeal,
    DealPartner,
    DealSlot,
    Employee,
    SlotAssignment,
    TeamMembership,
    YouTubeConnection,
)
from app.schemas.channels import (
    ChannelDetail,
    ChannelIn,
    ChannelListItem,
    ChannelMetricsOut,
    ChannelSlotRef,
    ImportLineOut,
    ImportOut,
    ManagerHistoryItem,
    ManagerIn,
    PersonRef,
    SlotHistoryItem,
)
from app.services.assignments import AssignmentError, open_managers, set_manager
from app.services.audit import record_audit
from app.services.channel_import import TEMPLATE_HEADERS, TEMPLATE_ROWS, import_channels
from app.services.channel_performance import Metrics, period_metrics, team_names, youtube_info
from app.services.cms_sheet import read_table
from app.services.deals import company_today
from app.services.month_close import MonthClosedError, ensure_open
from app.services.teams import team_leads_for

router = APIRouter(prefix="/channels", tags=["channels"])

TRACKED = (
    "platform",
    "name",
    "external_id",
    "url",
    "cms_partner_id",
    "status",
    "notes",
    "partner_id",
)


def _person(employee: Employee | None) -> PersonRef | None:
    return PersonRef(id=employee.id, name=employee.full_name) if employee else None


def channel_items(db: Session, channels: list[Channel]) -> list[ChannelListItem]:
    """List rows with current slots, manager and team lead, in three queries."""
    ids = [c.id for c in channels]
    slots: dict[uuid.UUID, list[ChannelSlotRef]] = {i: [] for i in ids}
    if ids:
        rows = db.execute(
            select(SlotAssignment, DealSlot, ContentDeal)
            .join(DealSlot, DealSlot.id == SlotAssignment.slot_id)
            .join(ContentDeal, ContentDeal.id == DealSlot.deal_id)
            .where(SlotAssignment.channel_id.in_(ids), SlotAssignment.end_date.is_(None))
            .order_by(ContentDeal.title)
        ).all()
        for a, slot, deal in rows:
            slots[a.channel_id].append(
                ChannelSlotRef(
                    deal_id=deal.id,
                    deal_title=deal.title,
                    owner_name=deal.owner.name,
                    slot_id=slot.id,
                    slot_code=slot.code,
                    slot_status=slot.status,
                    since=a.start_date,
                )
            )
    managers = open_managers(db, ids)
    leads = team_leads_for(db, {m.employee_id for m in managers.values()})
    partner_ids = {c.partner_id for c in channels if c.partner_id}
    partners = (
        dict(
            db.execute(
                select(DealPartner.id, DealPartner.name).where(DealPartner.id.in_(partner_ids))
            ).all()
        )
        if partner_ids
        else {}
    )
    items = []
    for c in channels:
        m = managers.get(c.id)
        items.append(
            ChannelListItem(
                id=c.id,
                platform=c.platform,  # type: ignore[arg-type]
                name=c.name,
                external_id=c.external_id,
                url=c.url,
                status=c.status,  # type: ignore[arg-type]
                cms_partner_id=c.cms_partner_id,
                cms_name=c.cms_partner.name if c.cms_partner else None,
                partner=PersonRef(id=c.partner_id, name=partners[c.partner_id])
                if c.partner_id
                else None,
                slots=slots[c.id],
                manager=_person(m.employee) if m else None,
                team_lead=_person(leads.get(m.employee_id)) if m else None,
                created_at=c.created_at,
            )
        )
    return items


def get_channel(db: Session, ctx: AuthContext, channel_id: uuid.UUID) -> Channel:
    channel = db.scalar(
        select(Channel).where(
            Channel.id == channel_id, Channel.organization_id == ctx.organization.id
        )
    )
    if channel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Channel not found")
    return channel


def _check_refs(db: Session, ctx: AuthContext, body: ChannelIn, current: Channel | None) -> None:
    if body.partner_id and not db.scalar(
        select(DealPartner.id).where(
            DealPartner.id == body.partner_id, DealPartner.organization_id == ctx.organization.id
        )
    ):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Partner not found")
    if body.cms_partner_id:
        cms = db.scalar(
            select(CmsPartner).where(
                CmsPartner.id == body.cms_partner_id,
                CmsPartner.organization_id == ctx.organization.id,
            )
        )
        if cms is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "CMS partner not found")
        if cms.platform != body.platform:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"{cms.name} is a {cms.platform.title()} CMS; "
                f"the channel is {body.platform.title()}",
            )
        if not cms.is_active and (current is None or current.cms_partner_id != cms.id):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{cms.name} is inactive")
    dup = select(Channel.id).where(
        Channel.organization_id == ctx.organization.id,
        Channel.platform == body.platform,
        Channel.external_id == body.external_id,
    )
    if current:
        dup = dup.where(Channel.id != current.id)
    if db.scalar(dup):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A {body.platform.title()} channel with this ID already exists",
        )
    if current and body.platform != current.platform:
        held = db.scalar(
            select(SlotAssignment.id).where(
                SlotAssignment.channel_id == current.id, SlotAssignment.end_date.is_(None)
            )
        )
        if held:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Cannot change the platform while the channel holds a slot",
            )


SORT = {"name": Channel.name, "created": Channel.created_at, "platform": Channel.platform}
# Sorted in Python after the period's numbers are worked out.
METRIC_SORT = {
    "revenue": lambda m: m.revenue,
    "views": lambda m: m.views,
    "rpm": lambda m: m.rpm,
    "change": lambda m: m.revenue_change_pct,
    "subs": lambda m: m.subscribers_net,
}


@router.get("")
def list_channels(
    ctx: Auth,
    db: DbSession,
    pagination: Pagination,
    q: str | None = None,
    platform: Literal["youtube", "facebook"] | None = None,
    cms_partner_id: uuid.UUID | None = None,
    partner_id: uuid.UUID | None = None,
    status_: Annotated[Literal["active", "inactive"] | None, Query(alias="status")] = None,
    deal_id: uuid.UUID | None = None,
    manager_id: uuid.UUID | None = None,
    managed: Literal["yes", "no"] | None = None,
    slot: Literal["assigned", "unassigned"] | None = None,
    team_id: uuid.UUID | None = None,
    youtube: Literal["connected", "expired", "not_connected"] | None = None,
    start: date | None = None,
    end: date | None = None,
    sort: Literal[
        "name", "created", "platform", "revenue", "views", "rpm", "change", "subs"
    ] = "name",
    direction: Literal["asc", "desc"] = "asc",
) -> Page[ChannelListItem]:
    today = company_today(ctx.organization)
    end = end or today - timedelta(days=1)
    start = start or end.replace(day=1)
    if start > end:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Start must be before end")
    stmt = select(Channel).where(Channel.organization_id == ctx.organization.id)
    if team_id:
        stmt = stmt.where(
            exists(
                select(ChannelManagerAssignment.id)
                .join(
                    TeamMembership,
                    (TeamMembership.employee_id == ChannelManagerAssignment.employee_id)
                    & TeamMembership.end_date.is_(None),
                )
                .where(
                    ChannelManagerAssignment.channel_id == Channel.id,
                    ChannelManagerAssignment.end_date.is_(None),
                    TeamMembership.team_id == team_id,
                )
                .correlate(Channel)
            )
        )
    if youtube:
        conn = select(YouTubeConnection.id).where(YouTubeConnection.channel_id == Channel.id)
        if youtube == "connected":
            stmt = stmt.where(
                exists(conn.where(YouTubeConnection.status == "ok").correlate(Channel))
            )
        elif youtube == "expired":
            stmt = stmt.where(
                exists(conn.where(YouTubeConnection.status != "ok").correlate(Channel))
            )
        else:
            stmt = stmt.where(Channel.platform == "youtube", ~exists(conn.correlate(Channel)))
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(Channel.name.ilike(pattern), Channel.external_id.ilike(pattern)))
    if platform:
        stmt = stmt.where(Channel.platform == platform)
    if cms_partner_id:
        stmt = stmt.where(Channel.cms_partner_id == cms_partner_id)
    if partner_id:
        stmt = stmt.where(Channel.partner_id == partner_id)
    if status_:
        stmt = stmt.where(Channel.status == status_)
    holds_slot = (
        select(SlotAssignment.id)
        .where(SlotAssignment.channel_id == Channel.id, SlotAssignment.end_date.is_(None))
        .correlate(Channel)
    )
    if slot == "assigned":
        stmt = stmt.where(exists(holds_slot))
    elif slot == "unassigned":
        stmt = stmt.where(~exists(holds_slot))
    if deal_id:
        stmt = stmt.where(
            exists(
                select(SlotAssignment.id)
                .join(DealSlot, DealSlot.id == SlotAssignment.slot_id)
                .where(
                    SlotAssignment.channel_id == Channel.id,
                    SlotAssignment.end_date.is_(None),
                    DealSlot.deal_id == deal_id,
                )
                .correlate(Channel)
            )
        )
    if manager_id:
        stmt = stmt.where(
            exists(
                select(ChannelManagerAssignment.id)
                .where(
                    ChannelManagerAssignment.channel_id == Channel.id,
                    ChannelManagerAssignment.end_date.is_(None),
                    ChannelManagerAssignment.employee_id == manager_id,
                )
                .correlate(Channel)
            )
        )
    if managed:
        has_manager = exists(
            select(ChannelManagerAssignment.id)
            .where(
                ChannelManagerAssignment.channel_id == Channel.id,
                ChannelManagerAssignment.end_date.is_(None),
            )
            .correlate(Channel)
        )
        stmt = stmt.where(has_manager if managed == "yes" else ~has_manager)
    metrics = period_metrics(db, ctx.organization.id, start, end)
    if sort in METRIC_SORT:
        # Rank every matching channel by the period's numbers, then cut the page.
        everything = list(db.scalars(stmt.order_by(Channel.name)))
        key = METRIC_SORT[sort]
        value = {c.id: key(metrics.get(c.id, Metrics())) for c in everything}
        with_value = sorted(
            (c for c in everything if value[c.id] is not None),
            key=lambda c: value[c.id],
            reverse=direction == "desc",
        )
        # Channels without a value always go last, in name order.
        ordered = with_value + [c for c in everything if value[c.id] is None]
        total = len(ordered)
        first = (pagination.page - 1) * pagination.page_size
        channels = ordered[first : first + pagination.page_size]
    else:
        col = SORT[sort]
        stmt = stmt.order_by(col.asc() if direction == "asc" else col.desc(), Channel.id)
        channels, total = paginate(db, stmt, pagination)
    items = channel_items(db, channels)
    yt = youtube_info(db, ctx.organization.id)
    teams = team_names(db, {i.manager.id for i in items if i.manager})
    for item in items:
        m = metrics.get(item.id)
        info = yt.get(item.id)
        item.metrics = ChannelMetricsOut(**m.out()) if m else None
        item.youtube_status = info.status if info else "not_connected"
        item.subscribers = info.subscribers if info else None
        item.team = teams[item.manager.id][1] if item.manager and item.manager.id in teams else None
    return Page(items=items, total=total, page=pagination.page, page_size=pagination.page_size)


@router.get("/summary")
def channels_summary(ctx: Auth, db: DbSession) -> dict[str, int]:
    org = ctx.organization.id
    held = (
        select(SlotAssignment.channel_id)
        .where(SlotAssignment.organization_id == org, SlotAssignment.end_date.is_(None))
        .distinct()
    )
    managed = (
        select(ChannelManagerAssignment.channel_id)
        .where(
            ChannelManagerAssignment.organization_id == org,
            ChannelManagerAssignment.end_date.is_(None),
        )
        .distinct()
    )
    active = select(Channel.id).where(Channel.organization_id == org, Channel.status == "active")
    count = lambda stmt: db.scalar(select(func.count()).select_from(stmt.subquery())) or 0  # noqa: E731
    return {
        "active_channels": count(active),
        "in_slots": count(held),
        "without_slot": count(active.where(Channel.id.not_in(held))),
        "without_manager": count(active.where(Channel.id.not_in(managed))),
        "youtube_not_connected": count(
            active.where(
                Channel.platform == "youtube",
                Channel.id.not_in(
                    select(YouTubeConnection.channel_id).where(
                        YouTubeConnection.organization_id == org
                    )
                ),
            )
        ),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_channel(body: ChannelIn, ctx: Auth, request: Request, db: DbSession) -> ChannelListItem:
    _check_refs(db, ctx, body, None)
    channel = Channel(organization_id=ctx.organization.id, **body.model_dump())
    db.add(channel)
    db.flush()
    record_audit(
        db,
        "channel.created",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="channel",
        entity_id=channel.id,
        details={"name": channel.name, "platform": channel.platform},
        ip=client_ip(request),
    )
    db.commit()
    db.expire_all()
    return channel_items(db, [get_channel(db, ctx, channel.id)])[0]


# ---- Bulk import -------------------------------------------------------------------------------

MAX_IMPORT_BYTES = 5 * 1024 * 1024


@router.get("/import/template")
def import_template(_: Auth) -> Response:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Channels"
    ws.append(TEMPLATE_HEADERS)
    for row in TEMPLATE_ROWS:
        ws.append(row)
    for col, width in zip("ABCDEFGH", (30, 28, 12, 18, 22, 10, 40, 30), strict=True):
        ws.column_dimensions[col].width = width
    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="channels-template.xlsx"'},
    )


async def _import(file: UploadFile, ctx: AuthContext, db: Session, commit: bool) -> ImportOut:
    content = await file.read(MAX_IMPORT_BYTES + 1)
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file is larger than 5 MB"
        )
    try:
        table = read_table(content, file.filename or "channels")
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    result = import_channels(db, ctx.organization, table, commit=commit)
    return ImportOut(
        added=result.count("new"),
        exists=result.count("exists"),
        duplicate=result.count("duplicate"),
        errors=result.count("error"),
        with_notes=sum(1 for x in result.lines if x.result == "new" and x.notes),
        missing_columns=result.missing_columns,
        lines=[ImportLineOut(**vars(x)) for x in result.lines],
    )


@router.post("/import/preview")
async def import_preview(
    ctx: Auth, db: DbSession, file: Annotated[UploadFile, File()]
) -> ImportOut:
    """What would happen, line by line. Nothing is saved."""
    out = await _import(file, ctx, db, commit=False)
    db.rollback()
    return out


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_file(
    request: Request, ctx: Auth, db: DbSession, file: Annotated[UploadFile, File()]
) -> ImportOut:
    out = await _import(file, ctx, db, commit=True)
    if out.missing_columns:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "The file needs these columns: " + ", ".join(out.missing_columns),
        )
    record_audit(
        db,
        "channel.imported",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="channel",
        entity_id=None,
        details={
            "file": file.filename,
            "added": out.added,
            "skipped": out.exists + out.duplicate + out.errors,
        },
        ip=client_ip(request),
    )
    db.commit()
    return out


@router.get("/{channel_id}")
def channel_detail(channel_id: uuid.UUID, ctx: Auth, db: DbSession) -> ChannelDetail:
    channel = get_channel(db, ctx, channel_id)
    item = channel_items(db, [channel])[0]
    slot_rows = db.execute(
        select(SlotAssignment, DealSlot, ContentDeal)
        .join(DealSlot, DealSlot.id == SlotAssignment.slot_id)
        .join(ContentDeal, ContentDeal.id == DealSlot.deal_id)
        .where(SlotAssignment.channel_id == channel.id)
        .order_by(SlotAssignment.start_date.desc(), SlotAssignment.created_at.desc())
    ).all()
    managers = db.scalars(
        select(ChannelManagerAssignment)
        .where(ChannelManagerAssignment.channel_id == channel.id)
        .order_by(
            ChannelManagerAssignment.start_date.desc(), ChannelManagerAssignment.created_at.desc()
        )
    ).all()
    return ChannelDetail(
        **item.model_dump(),
        notes=channel.notes,
        slot_history=[
            SlotHistoryItem(
                id=a.id,
                deal_id=deal.id,
                deal_title=deal.title,
                slot_id=slot.id,
                slot_code=slot.code,
                channel_id=channel.id,
                channel_name=channel.name,
                start_date=a.start_date,
                end_date=a.end_date,
                start_reason=a.start_reason,
                end_reason=a.end_reason,
                notes=a.notes,
            )
            for a, slot, deal in slot_rows
        ],
        manager_history=[
            ManagerHistoryItem(
                id=m.id,
                channel_id=channel.id,
                channel_name=channel.name,
                employee=PersonRef(id=m.employee.id, name=m.employee.full_name),
                start_date=m.start_date,
                end_date=m.end_date,
            )
            for m in managers
        ],
    )


@router.put("/{channel_id}")
def update_channel(
    channel_id: uuid.UUID, body: ChannelIn, ctx: Auth, request: Request, db: DbSession
) -> ChannelListItem:
    channel = get_channel(db, ctx, channel_id)
    _check_refs(db, ctx, body, channel)
    new = body.model_dump()
    before = {f: getattr(channel, f) for f in TRACKED}
    changes = {
        f: [
            str(before[f]) if before[f] is not None else None,
            str(new[f]) if new[f] is not None else None,
        ]
        for f in TRACKED
        if before[f] != new[f]
    }
    for f in TRACKED:
        setattr(channel, f, new[f])
    if changes:
        record_audit(
            db,
            "channel.updated",
            organization_id=ctx.organization.id,
            user_id=ctx.user.id,
            entity_type="channel",
            entity_id=channel.id,
            details={"name": channel.name, "changes": changes},
            ip=client_ip(request),
        )
    db.commit()
    db.expire_all()
    return channel_items(db, [get_channel(db, ctx, channel.id)])[0]


@router.post("/{channel_id}/manager")
def change_manager(
    channel_id: uuid.UUID, body: ManagerIn, ctx: Auth, request: Request, db: DbSession
) -> ChannelListItem:
    channel = get_channel(db, ctx, channel_id)
    employee = None
    if body.employee_id:
        employee = db.scalar(
            select(Employee).where(
                Employee.id == body.employee_id, Employee.organization_id == ctx.organization.id
            )
        )
        if employee is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    today = company_today(ctx.organization)
    try:
        ensure_open(db, ctx.organization, body.effective_date or today, "This handover")
    except MonthClosedError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    try:
        closed, _ = set_manager(
            db, channel, employee, effective=body.effective_date or today, today=today
        )
    except AssignmentError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    record_audit(
        db,
        "channel.manager_changed",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="channel",
        entity_id=channel.id,
        details={
            "name": channel.name,
            "changes": {
                "manager": [
                    closed.employee.full_name if closed else None,
                    employee.full_name if employee else None,
                ]
            },
            "effective_date": str(body.effective_date or today),
        },
        ip=client_ip(request),
    )
    db.commit()
    db.expire_all()
    return channel_items(db, [get_channel(db, ctx, channel.id)])[0]
