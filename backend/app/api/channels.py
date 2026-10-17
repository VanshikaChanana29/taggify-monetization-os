import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
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
    DealSlot,
    Employee,
    SlotAssignment,
)
from app.schemas.channels import (
    ChannelDetail,
    ChannelIn,
    ChannelListItem,
    ChannelSlotRef,
    ManagerHistoryItem,
    ManagerIn,
    PersonRef,
    SlotHistoryItem,
)
from app.services.assignments import AssignmentError, open_managers, set_manager
from app.services.audit import record_audit
from app.services.deals import company_today
from app.services.month_close import MonthClosedError, ensure_open
from app.services.teams import team_leads_for

router = APIRouter(prefix="/channels", tags=["channels"])

TRACKED = ("platform", "name", "external_id", "url", "cms_partner_id", "status", "notes")


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


@router.get("")
def list_channels(
    ctx: Auth,
    db: DbSession,
    pagination: Pagination,
    q: str | None = None,
    platform: Literal["youtube", "facebook"] | None = None,
    cms_partner_id: uuid.UUID | None = None,
    status_: Annotated[Literal["active", "inactive"] | None, Query(alias="status")] = None,
    deal_id: uuid.UUID | None = None,
    manager_id: uuid.UUID | None = None,
    slot: Literal["assigned", "unassigned"] | None = None,
    sort: Literal["name", "created", "platform"] = "name",
    direction: Literal["asc", "desc"] = "asc",
) -> Page[ChannelListItem]:
    stmt = select(Channel).where(Channel.organization_id == ctx.organization.id)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(Channel.name.ilike(pattern), Channel.external_id.ilike(pattern)))
    if platform:
        stmt = stmt.where(Channel.platform == platform)
    if cms_partner_id:
        stmt = stmt.where(Channel.cms_partner_id == cms_partner_id)
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
    col = SORT[sort]
    stmt = stmt.order_by(col.asc() if direction == "asc" else col.desc(), Channel.id)
    channels, total = paginate(db, stmt, pagination)
    return Page(
        items=channel_items(db, channels),
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


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
