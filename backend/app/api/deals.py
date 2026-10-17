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
from app.models import ContentDeal, ContentOwner, DealEpisodeRange
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
from app.services.audit import record_audit
from app.services.deals import (
    EXPIRING_SOON_DAYS,
    SlotInUseError,
    check_rights,
    company_today,
    effective_status,
    sync_slots,
)

router = APIRouter(prefix="/deals", tags=["deals"])

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


def _out(deal: ContentDeal, today: date) -> DealOut:
    return DealOut(
        **_list_item(deal, today),
        stored_status=deal.status,  # type: ignore[arg-type]
        is_worldwide=deal.is_worldwide,
        territories=deal.territories,
        contract_url=deal.contract_url,
        notes=deal.notes,
        owner_contact_name=deal.owner.contact_name,
        owner_contact_email=deal.owner.contact_email,
        slots=[
            SlotOut(
                id=s.id,
                platform=s.platform,  # type: ignore[arg-type]
                number=s.number,
                code=s.code,
                status=s.status,  # type: ignore[arg-type]
                notes=s.notes,
            )
            for s in deal.slots
        ],
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
    return _out(_get_deal(db, ctx, deal.id), company_today(ctx.organization))


@router.get("/{deal_id}")
def get_deal(deal_id: uuid.UUID, ctx: Auth, db: DbSession) -> DealOut:
    return _out(_get_deal(db, ctx, deal_id), company_today(ctx.organization))


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
    return _out(_get_deal(db, ctx, deal.id), company_today(ctx.organization))


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
    return SlotOut(
        id=slot.id,
        platform=slot.platform,  # type: ignore[arg-type]
        number=slot.number,
        code=slot.code,
        status=slot.status,  # type: ignore[arg-type]
        notes=slot.notes,
    )


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
    return RightsCheckOut(allowed=result.allowed, reasons=result.reasons, checked_on=on_date)
