"""Parent deals: one contract with a content owner, with its shows under it.

e.g. "Sony Package 2026", ₹1 Cr, Jan 2026 → Dec 2027, holding 10 shows. Each show is a deal
as before (/deals); the parent holds the total, the installments and the deal partners.
"""

import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deals import _list_item
from app.api.deps import Auth, AuthContext, client_ip
from app.api.pagination import Page, Pagination, paginate
from app.core.database import DbSession
from app.models import ContentDeal, ContentOwner, ParentDeal
from app.schemas.deals import (
    DealListItem,
    DealType,
    ParentDealIn,
    ParentDealListItem,
    ParentDealOut,
)
from app.services.audit import record_audit
from app.services.deal_economics import Economics, parent_economics
from app.services.deals import EXPIRING_SOON_DAYS, company_today
from app.services.parent_deals import (
    PAYS_FEE,
    ParentDealError,
    allotted,
    check_parent_update,
    parent_status,
)

router = APIRouter(prefix="/parent-deals", tags=["parent deals"])

TRACKED = ("owner_id", "name", "deal_type", "amount", "currency", "term_start", "term_end", "notes")
SortKey = Literal["name", "term_end", "amount", "created"]
StatusFilter = Literal["upcoming", "active", "expired", "expiring"]
SORT_COLUMNS = {
    "name": ParentDeal.name,
    "term_end": ParentDeal.term_end,
    "amount": ParentDeal.amount,
    "created": ParentDeal.created_at,
}


def _get(db: Session, ctx: AuthContext, parent_id: uuid.UUID) -> ParentDeal:
    parent = db.scalar(
        select(ParentDeal)
        .options(
            selectinload(ParentDeal.shows).selectinload(ContentDeal.slots),
            selectinload(ParentDeal.shows).selectinload(ContentDeal.episode_ranges),
        )
        .where(ParentDeal.id == parent_id, ParentDeal.organization_id == ctx.organization.id)
    )
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deal not found")
    return parent


def _check_owner(db: Session, ctx: AuthContext, owner_id: uuid.UUID, current=None) -> None:
    owner = db.scalar(
        select(ContentOwner).where(
            ContentOwner.id == owner_id, ContentOwner.organization_id == ctx.organization.id
        )
    )
    if owner is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Content owner not found")
    if not owner.is_active and owner.id != current:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That content owner is inactive")


def _item(db: Session, parent: ParentDeal, e: Economics, today) -> dict:
    held = allotted(db, parent.id) if parent.deal_type in PAYS_FEE else None
    return {
        "id": parent.id,
        "name": parent.name,
        "owner_id": parent.owner_id,
        "owner_name": parent.owner.name,
        "deal_type": parent.deal_type,
        "status": parent_status(parent, today),
        "amount": parent.amount,
        "currency": parent.currency,
        "term_start": parent.term_start,
        "term_end": parent.term_end,
        "notes": parent.notes,
        "show_count": len(parent.shows),
        "allotted": held,
        "unallotted": parent.amount - held
        if parent.amount is not None and held is not None
        else None,
        "profit": e.profit,
        "recovery_pct": e.recovery_pct,
        "rights_cost": e.rights_cost,
    }


def _out(db: Session, ctx: AuthContext, parent: ParentDeal) -> ParentDealOut:
    today = company_today(ctx.organization)
    e, shows = parent_economics(db, ctx.organization, parent)
    return ParentDealOut(
        **_item(db, parent, e, today),
        shows=[
            DealListItem(
                **_list_item(show, today),
                profit=se.profit,
                recovery_pct=se.recovery_pct,
                rights_cost=se.rights_cost,
            )
            for show, se in shows
        ],
        created_at=parent.created_at,
        updated_at=parent.updated_at,
    )


def _audit(db, ctx: AuthContext, request: Request, action: str, parent: ParentDeal, details):
    record_audit(
        db,
        action,
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="parent_deal",
        entity_id=parent.id,
        details={"title": parent.name, **details},
        ip=client_ip(request),
    )


def _plain(value):
    if value is None:
        return None
    return f"{value:.2f}" if isinstance(value, Decimal) else str(value)


@router.get("")
def list_parent_deals(
    ctx: Auth,
    db: DbSession,
    pagination: Pagination,
    q: str | None = None,
    owner_id: uuid.UUID | None = None,
    status_: Annotated[
        Literal["upcoming", "active", "expired"] | None, Query(alias="status")
    ] = None,
    deal_type: DealType | None = None,
    sort: SortKey = "term_end",
    direction: Literal["asc", "desc"] = "asc",
) -> Page[ParentDealListItem]:
    """Parent deals with their totals. Search also finds a deal by one of its shows' titles."""
    today = company_today(ctx.organization)
    stmt = (
        select(ParentDeal)
        .join(ContentOwner, ContentOwner.id == ParentDeal.owner_id)
        .options(selectinload(ParentDeal.shows).selectinload(ContentDeal.slots))
        .where(ParentDeal.organization_id == ctx.organization.id)
    )
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        has_show = (
            select(ContentDeal.id)
            .where(ContentDeal.parent_id == ParentDeal.id, ContentDeal.title.ilike(pattern))
            .exists()
        )
        stmt = stmt.where(
            or_(ParentDeal.name.ilike(pattern), ContentOwner.name.ilike(pattern), has_show)
        )
    if owner_id:
        stmt = stmt.where(ParentDeal.owner_id == owner_id)
    if deal_type:
        stmt = stmt.where(ParentDeal.deal_type == deal_type)
    if status_ == "upcoming":
        stmt = stmt.where(ParentDeal.term_start > today)
    elif status_ == "expired":
        stmt = stmt.where(ParentDeal.term_end < today)
    elif status_ == "active":
        stmt = stmt.where(ParentDeal.term_start <= today, ParentDeal.term_end >= today)
    elif status_ == "expiring":
        stmt = stmt.where(
            ParentDeal.term_start <= today,
            ParentDeal.term_end >= today,
            ParentDeal.term_end <= today + timedelta(days=EXPIRING_SOON_DAYS),
        )
    column = SORT_COLUMNS[sort]
    order = column.asc().nulls_last() if direction == "asc" else column.desc().nulls_last()
    stmt = stmt.order_by(order, ParentDeal.id)

    parents, total = paginate(db, stmt, pagination)
    items = []
    for p in parents:
        e, _ = parent_economics(db, ctx.organization, p)
        items.append(ParentDealListItem(**_item(db, p, e, today)))
    return Page(items=items, total=total, page=pagination.page, page_size=pagination.page_size)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_parent_deal(
    body: ParentDealIn, ctx: Auth, request: Request, db: DbSession
) -> ParentDealOut:
    _check_owner(db, ctx, body.owner_id)
    parent = ParentDeal(organization_id=ctx.organization.id, **body.model_dump())
    db.add(parent)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "parent_deal.created",
        parent,
        {
            "deal_type": parent.deal_type,
            "amount": f"{parent.currency} {parent.amount}" if parent.amount else None,
            "term": f"{parent.term_start} → {parent.term_end}",
        },
    )
    db.commit()
    db.expire_all()
    return _out(db, ctx, _get(db, ctx, parent.id))


@router.get("/{parent_id}")
def get_parent_deal(parent_id: uuid.UUID, ctx: Auth, db: DbSession) -> ParentDealOut:
    return _out(db, ctx, _get(db, ctx, parent_id))


@router.put("/{parent_id}")
def update_parent_deal(
    parent_id: uuid.UUID, body: ParentDealIn, ctx: Auth, request: Request, db: DbSession
) -> ParentDealOut:
    """Edit name, amount, dates… A new owner is copied to every show under the deal."""
    parent = _get(db, ctx, parent_id)
    _check_owner(db, ctx, body.owner_id, current=parent.owner_id)
    try:
        check_parent_update(db, parent, body)
    except ParentDealError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    before = {f: _plain(getattr(parent, f)) for f in TRACKED}
    for key, value in body.model_dump().items():
        setattr(parent, key, value)
    for show in parent.shows:
        show.owner_id = parent.owner_id
    changes = {
        f: [before[f], _plain(getattr(parent, f))]
        for f in TRACKED
        if before[f] != _plain(getattr(parent, f))
    }
    if changes:
        _audit(db, ctx, request, "parent_deal.updated", parent, {"changes": changes})
    db.commit()
    db.expire_all()
    return _out(db, ctx, _get(db, ctx, parent_id))


@router.delete("/{parent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_parent_deal(parent_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    """Only an empty deal can be deleted: move or delete its shows first."""
    parent = _get(db, ctx, parent_id)
    if parent.shows:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{parent.name} still has {len(parent.shows)} show(s). Move them to another deal first",
        )
    _audit(db, ctx, request, "parent_deal.deleted", parent, {})
    db.delete(parent)
    db.commit()
