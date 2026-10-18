import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import Select, and_, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import Auth, AuthContext, client_ip
from app.api.pagination import Page, Pagination, paginate
from app.core.database import DbSession
from app.models import (
    Channel,
    ContentDeal,
    ContentOwner,
    DealEpisodeRange,
    DealSlot,
    SlotAssignment,
)
from app.schemas.channels import AssignIn, SlotHistoryItem, UnassignIn
from app.schemas.deals import (
    CurrencyAmount,
    DealIn,
    DealListItem,
    DealOut,
    DealsSummary,
    EffectiveStatus,
    EpisodeRange,
    RightsCheckIn,
    RightsCheckOut,
    SlotOut,
    SlotUpdate,
)
from app.services.assignments import (
    AssignmentError,
    assign_channel,
    check_slot_status_change,
    open_managers,
    open_slot_assignments,
    replace_channel,
    unassign_channel,
)
from app.services.audit import record_audit
from app.services.deals import (
    EXPIRING_SOON_DAYS,
    PLATFORM_NAMES,
    SlotInUseError,
    check_rights,
    company_today,
    effective_status,
    sync_slots,
)
from app.services.month_close import MonthClosedError, ensure_open

router = APIRouter(prefix="/deals", tags=["deals"])


def _open(db, ctx, day, what):
    try:
        ensure_open(db, ctx.organization, day, what)
    except MonthClosedError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


# Fields whose before/after values go into the audit log on edit.
TRACKED = (
    "owner_id",
    "title",
    "deal_type",
    "status",
    "fee_amount",
    "currency",
    "revenue_share_pct",
    "term_start",
    "term_end",
    "episode_scope",
    "is_worldwide",
    "territories",
    "yt_slot_limit",
    "fb_slot_limit",
    "contract_url",
    "notes",
)

StatusFilter = EffectiveStatus | Literal["expiring"]
SortKey = Literal["title", "owner", "term_start", "term_end", "fee", "created"]


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, date | uuid.UUID):
        return str(value)
    return value


def _ranges(deal: ContentDeal) -> list[EpisodeRange]:
    return [
        EpisodeRange(season=r.season, from_episode=r.from_episode, to_episode=r.to_episode)
        for r in deal.episode_ranges
    ]


def _used(deal: ContentDeal, platform: str) -> int:
    return sum(1 for s in deal.slots if s.platform == platform and s.status != "unassigned")


def _list_item(deal: ContentDeal, today: date) -> dict[str, Any]:
    return {
        "id": deal.id,
        "title": deal.title,
        "owner_id": deal.owner_id,
        "owner_name": deal.owner.name,
        "deal_type": deal.deal_type,
        "status": effective_status(deal, today),
        "fee_amount": deal.fee_amount,
        "currency": deal.currency,
        "revenue_share_pct": deal.revenue_share_pct,
        "term_start": deal.term_start,
        "term_end": deal.term_end,
        "episode_scope": deal.episode_scope,
        "episode_ranges": _ranges(deal),
        "yt_slot_limit": deal.yt_slot_limit,
        "fb_slot_limit": deal.fb_slot_limit,
        "yt_slots_used": _used(deal, "youtube"),
        "fb_slots_used": _used(deal, "facebook"),
    }


def _slot_out(
    slot: DealSlot, assignment: SlotAssignment | None, manager_name: str | None
) -> SlotOut:
    channel = assignment.channel if assignment else None
    return SlotOut(
        id=slot.id,
        platform=slot.platform,  # type: ignore[arg-type]
        number=slot.number,
        code=slot.code,
        status=slot.status,  # type: ignore[arg-type]
        notes=slot.notes,
        channel_id=channel.id if channel else None,
        channel_name=channel.name if channel else None,
        channel_external_id=channel.external_id if channel else None,
        cms_name=channel.cms_partner.name if channel and channel.cms_partner else None,
        manager_name=manager_name,
        since=assignment.start_date if assignment else None,
    )


def _slot_outs(db: Session, slots: list[DealSlot]) -> list[SlotOut]:
    assignments = open_slot_assignments(db, [s.id for s in slots])
    managers = open_managers(db, [a.channel_id for a in assignments.values()])
    out = []
    for s in slots:
        a = assignments.get(s.id)
        m = managers.get(a.channel_id) if a else None
        out.append(_slot_out(s, a, m.employee.full_name if m else None))
    return out


def _out(db: Session, deal: ContentDeal, today: date) -> DealOut:
    return DealOut(
        **_list_item(deal, today),
        stored_status=deal.status,  # type: ignore[arg-type]
        is_worldwide=deal.is_worldwide,
        territories=deal.territories,
        contract_url=deal.contract_url,
        notes=deal.notes,
        owner_contact_name=deal.owner.contact_name,
        owner_contact_email=deal.owner.contact_email,
        slots=_slot_outs(db, list(deal.slots)),
        created_at=deal.created_at,
        updated_at=deal.updated_at,
    )


def _get_deal(db: Session, ctx: AuthContext, deal_id: uuid.UUID) -> ContentDeal:
    deal = db.scalar(
        select(ContentDeal)
        .options(selectinload(ContentDeal.slots), selectinload(ContentDeal.episode_ranges))
        .where(ContentDeal.id == deal_id, ContentDeal.organization_id == ctx.organization.id)
    )
    if deal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deal not found")
    return deal


def _check_owner(db: Session, ctx: AuthContext, body: DealIn, current: uuid.UUID | None = None):
    owner = db.scalar(
        select(ContentOwner).where(
            ContentOwner.id == body.owner_id,
            ContentOwner.organization_id == ctx.organization.id,
        )
    )
    if owner is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Content owner not found")
    if not owner.is_active and owner.id != current:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That content owner is inactive")


def _apply(deal: ContentDeal, body: DealIn) -> None:
    data = body.model_dump(exclude={"episode_ranges"})
    for key, value in data.items():
        setattr(deal, key, value)
    deal.episode_ranges = [
        DealEpisodeRange(season=r.season, from_episode=r.from_episode, to_episode=r.to_episode)
        for r in body.episode_ranges
    ]
    try:
        sync_slots(deal)
    except SlotInUseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


def _status_filter(stmt: Select[Any], status_: StatusFilter, today: date) -> Select[Any]:
    live = and_(
        ContentDeal.status == "active",
        ContentDeal.term_start <= today,
        ContentDeal.term_end >= today,
    )
    conditions = {
        "draft": ContentDeal.status == "draft",
        "terminated": ContentDeal.status == "terminated",
        "upcoming": and_(ContentDeal.status == "active", ContentDeal.term_start > today),
        "expired": and_(ContentDeal.status == "active", ContentDeal.term_end < today),
        "active": live,
        "expiring": and_(live, ContentDeal.term_end <= today + timedelta(days=EXPIRING_SOON_DAYS)),
    }
    return stmt.where(conditions[status_])


SORT_COLUMNS = {
    "title": ContentDeal.title,
    "owner": ContentOwner.name,
    "term_start": ContentDeal.term_start,
    "term_end": ContentDeal.term_end,
    "fee": ContentDeal.fee_amount,
    "created": ContentDeal.created_at,
}


@router.get("")
def list_deals(
    ctx: Auth,
    db: DbSession,
    pagination: Pagination,
    q: str | None = None,
    owner_id: uuid.UUID | None = None,
    status_: Annotated[StatusFilter | None, Query(alias="status")] = None,
    deal_type: Literal["fixed_fee", "revenue_share", "owned"] | None = None,
    sort: SortKey = "term_end",
    direction: Literal["asc", "desc"] = "asc",
) -> Page[DealListItem]:
    today = company_today(ctx.organization)
    stmt = (
        select(ContentDeal)
        .join(ContentOwner, ContentOwner.id == ContentDeal.owner_id)
        .options(selectinload(ContentDeal.slots), selectinload(ContentDeal.episode_ranges))
        .where(ContentDeal.organization_id == ctx.organization.id)
    )
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(ContentDeal.title.ilike(pattern), ContentOwner.name.ilike(pattern)))
    if owner_id:
        stmt = stmt.where(ContentDeal.owner_id == owner_id)
    if status_:
        stmt = _status_filter(stmt, status_, today)
    if deal_type:
        stmt = stmt.where(ContentDeal.deal_type == deal_type)
    column = SORT_COLUMNS[sort]
    order = column.asc().nulls_last() if direction == "asc" else column.desc().nulls_last()
    stmt = stmt.order_by(order, ContentDeal.id)

    deals, total = paginate(db, stmt, pagination)
    return Page(
        items=[DealListItem(**_list_item(d, today)) for d in deals],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/summary")
def deals_summary(ctx: Auth, db: DbSession) -> DealsSummary:
    today = company_today(ctx.organization)
    live = [
        d
        for d in db.scalars(
            select(ContentDeal)
            .options(selectinload(ContentDeal.slots))
            .where(ContentDeal.organization_id == ctx.organization.id)
        )
        if effective_status(d, today) == "active"
    ]
    value: dict[str, Decimal] = defaultdict(Decimal)
    for d in live:
        if d.fee_amount is not None and d.currency:
            value[d.currency] += d.fee_amount
    soon = today + timedelta(days=EXPIRING_SOON_DAYS)
    return DealsSummary(
        active_deals=len(live),
        expiring_soon=sum(1 for d in live if d.term_end <= soon),
        slots_used=sum(1 for d in live for s in d.slots if s.status != "unassigned"),
        slots_total=sum(len(d.slots) for d in live),
        licence_value=[CurrencyAmount(currency=c, amount=a) for c, a in sorted(value.items())],
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_deal(body: DealIn, ctx: Auth, request: Request, db: DbSession) -> DealOut:
    _check_owner(db, ctx, body)
    deal = ContentDeal(organization_id=ctx.organization.id)
    _apply(deal, body)
    db.add(deal)
    db.flush()
    record_audit(
        db,
        "deal.created",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="deal",
        entity_id=deal.id,
        details={"title": deal.title},
        ip=client_ip(request),
    )
    db.commit()
    db.expire_all()  # reload as stored (e.g. 5000000 -> 5000000.00)
    return _out(db, _get_deal(db, ctx, deal.id), company_today(ctx.organization))


@router.get("/{deal_id}")
def get_deal(deal_id: uuid.UUID, ctx: Auth, db: DbSession) -> DealOut:
    return _out(db, _get_deal(db, ctx, deal_id), company_today(ctx.organization))


@router.put("/{deal_id}")
def update_deal(
    deal_id: uuid.UUID, body: DealIn, ctx: Auth, request: Request, db: DbSession
) -> DealOut:
    deal = _get_deal(db, ctx, deal_id)
    _check_owner(db, ctx, body, current=deal.owner_id)
    before = {f: _jsonable(getattr(deal, f)) for f in TRACKED}
    before_ranges = [r.model_dump() for r in _ranges(deal)]

    _apply(deal, body)

    after = {f: _jsonable(getattr(deal, f)) for f in TRACKED}
    changes = {f: [before[f], after[f]] for f in TRACKED if before[f] != after[f]}
    after_ranges = [r.model_dump() for r in body.episode_ranges]
    if before_ranges != after_ranges:
        changes["episode_ranges"] = [before_ranges, after_ranges]
    if changes:
        record_audit(
            db,
            "deal.updated",
            organization_id=ctx.organization.id,
            user_id=ctx.user.id,
            entity_type="deal",
            entity_id=deal.id,
            details={"title": deal.title, "changes": changes},
            ip=client_ip(request),
        )
    db.commit()
    db.expire_all()
    return _out(db, _get_deal(db, ctx, deal.id), company_today(ctx.organization))


@router.patch("/{deal_id}/slots/{slot_id}")
def update_slot(
    deal_id: uuid.UUID,
    slot_id: uuid.UUID,
    body: SlotUpdate,
    ctx: Auth,
    request: Request,
    db: DbSession,
) -> SlotOut:
    deal = _get_deal(db, ctx, deal_id)
    slot = next((s for s in deal.slots if s.id == slot_id), None)
    if slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slot not found")
    notes = (body.notes or "").strip() or None
    if body.status != slot.status:
        try:
            check_slot_status_change(db, slot, body.status)
        except AssignmentError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    changes = {}
    if slot.status != body.status:
        changes["status"] = [slot.status, body.status]
    if slot.notes != notes:
        changes["notes"] = [slot.notes, notes]
    slot.status, slot.notes = body.status, notes
    if changes:
        record_audit(
            db,
            "slot.updated",
            organization_id=ctx.organization.id,
            user_id=ctx.user.id,
            entity_type="deal",
            entity_id=deal.id,
            details={"title": deal.title, "slot": slot.code, "changes": changes},
            ip=client_ip(request),
        )
    db.commit()
    return _slot_outs(db, [slot])[0]


@router.post("/{deal_id}/check-rights")
def check_deal_rights(
    deal_id: uuid.UUID, body: RightsCheckIn, ctx: Auth, db: DbSession
) -> RightsCheckOut:
    deal = _get_deal(db, ctx, deal_id)
    on_date = body.on_date or company_today(ctx.organization)
    result = check_rights(
        deal,
        platform=body.platform,
        on_date=on_date,
        episode=body.episode,
        season=body.season,
        territory=body.territory,
    )
    reasons = list(result.reasons)
    if body.channel_id:
        channel = _channel(db, ctx, body.channel_id)
        reasons += _destination_reasons(db, deal, channel, body.platform, on_date)
    return RightsCheckOut(allowed=not reasons, reasons=reasons, checked_on=on_date)


SLOT_STATE_TEXT = {
    "reserved": "only reserved",
    "pending_whitelist": "still waiting for whitelist approval",
}


def _destination_reasons(
    db: Session, deal: ContentDeal, channel: Channel, platform: str, on_date: date
) -> list[str]:
    """The channel must hold an approved (active) slot of this deal on that date."""
    if channel.platform != platform:
        return [f"{channel.name} is a {PLATFORM_NAMES[channel.platform]} channel."]
    reasons = []
    if channel.status != "active":
        reasons.append(f"{channel.name} is inactive.")
    held = db.execute(
        select(SlotAssignment, DealSlot)
        .join(DealSlot, DealSlot.id == SlotAssignment.slot_id)
        .where(
            DealSlot.deal_id == deal.id,
            SlotAssignment.channel_id == channel.id,
            SlotAssignment.start_date <= on_date,
            or_(SlotAssignment.end_date.is_(None), SlotAssignment.end_date >= on_date),
        )
    ).first()
    if held is None:
        reasons.append(f"{channel.name} does not hold a slot in this deal on {on_date:%d %b %Y}.")
    else:
        assignment, slot = held
        if assignment.end_date is None and slot.status != "active":
            reasons.append(
                f"{channel.name} holds {slot.code}, but the slot is "
                f"{SLOT_STATE_TEXT.get(slot.status, slot.status)}."
            )
    return reasons


# ---- Slot <-> channel (Part 3) ------------------------------------------------------------


def _slot(deal: ContentDeal, slot_id: uuid.UUID) -> DealSlot:
    slot = next((s for s in deal.slots if s.id == slot_id), None)
    if slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slot not found")
    return slot


def _channel(db: Session, ctx: AuthContext, channel_id: uuid.UUID) -> Channel:
    channel = db.scalar(
        select(Channel).where(
            Channel.id == channel_id, Channel.organization_id == ctx.organization.id
        )
    )
    if channel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Channel not found")
    return channel


def _slot_audit(db, ctx, request, deal, slot, action, before, after, effective, notes=None):
    record_audit(
        db,
        action,
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="deal",
        entity_id=deal.id,
        details={
            "title": deal.title,
            "slot": slot.code,
            "changes": {"channel": [before, after]},
            "effective_date": str(effective),
            **({"notes": notes} if notes else {}),
        },
        ip=client_ip(request),
    )


@router.post("/{deal_id}/slots/{slot_id}/assign")
def assign_slot(
    deal_id: uuid.UUID,
    slot_id: uuid.UUID,
    body: AssignIn,
    ctx: Auth,
    request: Request,
    db: DbSession,
) -> SlotOut:
    deal = _get_deal(db, ctx, deal_id)
    slot = _slot(deal, slot_id)
    channel = _channel(db, ctx, body.channel_id)
    today = company_today(ctx.organization)
    effective = body.effective_date or today
    _open(db, ctx, effective, "This assignment")
    try:
        assign_channel(
            db,
            deal,
            slot,
            channel,
            status=body.status,
            effective=effective,
            today=today,
            notes=body.notes,
        )
    except AssignmentError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    _slot_audit(
        db, ctx, request, deal, slot, "slot.assigned", None, channel.name, effective, body.notes
    )
    db.commit()
    db.expire_all()
    return _slot_outs(db, [_slot(_get_deal(db, ctx, deal_id), slot_id)])[0]


@router.post("/{deal_id}/slots/{slot_id}/replace")
def replace_slot(
    deal_id: uuid.UUID,
    slot_id: uuid.UUID,
    body: AssignIn,
    ctx: Auth,
    request: Request,
    db: DbSession,
) -> SlotOut:
    deal = _get_deal(db, ctx, deal_id)
    slot = _slot(deal, slot_id)
    channel = _channel(db, ctx, body.channel_id)
    today = company_today(ctx.organization)
    effective = body.effective_date or today
    _open(db, ctx, effective, "This replacement")
    try:
        old, _ = replace_channel(
            db,
            deal,
            slot,
            channel,
            status=body.status,
            effective=effective,
            today=today,
            notes=body.notes,
        )
    except AssignmentError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    _slot_audit(
        db,
        ctx,
        request,
        deal,
        slot,
        "slot.replaced",
        old.channel.name,
        channel.name,
        effective,
        body.notes,
    )
    db.commit()
    db.expire_all()
    return _slot_outs(db, [_slot(_get_deal(db, ctx, deal_id), slot_id)])[0]


@router.post("/{deal_id}/slots/{slot_id}/unassign")
def unassign_slot(
    deal_id: uuid.UUID,
    slot_id: uuid.UUID,
    body: UnassignIn,
    ctx: Auth,
    request: Request,
    db: DbSession,
) -> SlotOut:
    deal = _get_deal(db, ctx, deal_id)
    slot = _slot(deal, slot_id)
    today = company_today(ctx.organization)
    effective = body.effective_date or today
    _open(db, ctx, effective, "This removal")
    try:
        old = unassign_channel(db, slot, effective=effective, today=today, notes=body.notes)
    except AssignmentError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    _slot_audit(
        db,
        ctx,
        request,
        deal,
        slot,
        "slot.unassigned",
        old.channel.name,
        None,
        effective,
        body.notes,
    )
    db.commit()
    db.expire_all()
    return _slot_outs(db, [_slot(_get_deal(db, ctx, deal_id), slot_id)])[0]


@router.get("/{deal_id}/assignments")
def deal_assignments(deal_id: uuid.UUID, ctx: Auth, db: DbSession) -> list[SlotHistoryItem]:
    """Every channel that has ever held a slot of this deal, newest first."""
    deal = _get_deal(db, ctx, deal_id)
    slots = {s.id: s for s in deal.slots}
    rows = db.scalars(
        select(SlotAssignment)
        .join(DealSlot, DealSlot.id == SlotAssignment.slot_id)
        .where(DealSlot.deal_id == deal.id)
        .order_by(SlotAssignment.start_date.desc(), SlotAssignment.created_at.desc())
    ).all()
    return [
        SlotHistoryItem(
            id=a.id,
            deal_id=deal.id,
            deal_title=deal.title,
            slot_id=a.slot_id,
            slot_code=slots[a.slot_id].code if a.slot_id in slots else "—",
            channel_id=a.channel_id,
            channel_name=a.channel.name,
            start_date=a.start_date,
            end_date=a.end_date,
            start_reason=a.start_reason,
            end_reason=a.end_reason,
            notes=a.notes,
        )
        for a in rows
    ]
