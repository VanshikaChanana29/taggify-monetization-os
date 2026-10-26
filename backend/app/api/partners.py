"""Deal partners (e.g. Vanshika on the Sony deal): who they are, their % of each deal, the
licence money they paid in, their channels' earnings and what Taggify has paid them."""

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Auth, AuthContext, client_ip
from app.core.database import DbSession
from app.models import (
    Channel,
    ContentDeal,
    DealPartner,
    DealPartnerShare,
    PartnerContribution,
    PartnerPayout,
)
from app.schemas.partners import (
    ContributionIn,
    ContributionOut,
    DealPartnerOut,
    DealPartnersIn,
    PartnerChannelOut,
    PartnerDealOut,
    PartnerDealRef,
    PartnerDetail,
    PartnerIn,
    PartnerMonthOut,
    PartnerMonthSummary,
    PartnerOut,
    PayoutIn,
    PayoutOut,
)
from app.services.audit import record_audit
from app.services.month_close import MonthClosedError, ensure_open
from app.services.partners import month_summary, statement

router = APIRouter(tags=["partners"])


def _audit(db, ctx: AuthContext, request: Request, action, entity_id, details):
    record_audit(
        db,
        action,
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="deal_partner",
        entity_id=entity_id,
        details=details,
        ip=client_ip(request),
    )


def _partner(db: Session, ctx: AuthContext, partner_id: uuid.UUID) -> DealPartner:
    p = db.scalar(
        select(DealPartner).where(
            DealPartner.id == partner_id, DealPartner.organization_id == ctx.organization.id
        )
    )
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Partner not found")
    return p


def _deal(db: Session, ctx: AuthContext, deal_id: uuid.UUID) -> ContentDeal:
    d = db.scalar(
        select(ContentDeal).where(
            ContentDeal.id == deal_id, ContentDeal.organization_id == ctx.organization.id
        )
    )
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deal not found")
    return d


def _out(db: Session, ctx: AuthContext, p: DealPartner, with_money: bool = True) -> PartnerOut:
    deals = [
        PartnerDealRef(deal_id=d.id, title=d.title, share_pct=s.share_pct)
        for s, d in db.execute(
            select(DealPartnerShare, ContentDeal)
            .join(ContentDeal, ContentDeal.id == DealPartnerShare.deal_id)
            .where(DealPartnerShare.partner_id == p.id)
            .order_by(ContentDeal.title)
        )
    ]
    channels = db.scalar(select(func.count()).where(Channel.partner_id == p.id)) or 0
    out = PartnerOut(
        id=p.id,
        name=p.name,
        email=p.email,
        phone=p.phone,
        tds_pct=p.tds_pct,
        notes=p.notes,
        is_active=p.is_active,
        created_at=p.created_at,
        deals=deals,
        channel_count=channels,
    )
    if with_money:
        st = statement(db, ctx.organization, p)
        out.earned, out.paid, out.outstanding, out.waiting = (
            st.earned,
            st.paid,
            st.outstanding,
            st.waiting,
        )
    return out


def _unique(db: Session, ctx: AuthContext, name: str, exclude: uuid.UUID | None = None) -> None:
    stmt = select(DealPartner.id).where(
        DealPartner.organization_id == ctx.organization.id,
        func.lower(DealPartner.name) == name.lower(),
    )
    if exclude:
        stmt = stmt.where(DealPartner.id != exclude)
    if db.scalar(stmt):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A partner named '{name}' exists")


@router.get("/partners")
def list_partners(ctx: Auth, db: DbSession) -> list[PartnerOut]:
    rows = db.scalars(
        select(DealPartner)
        .where(DealPartner.organization_id == ctx.organization.id)
        .order_by(DealPartner.name)
    )
    return [_out(db, ctx, p) for p in rows]


@router.post("/partners", status_code=status.HTTP_201_CREATED)
def create_partner(body: PartnerIn, ctx: Auth, request: Request, db: DbSession) -> PartnerOut:
    _unique(db, ctx, body.name)
    p = DealPartner(organization_id=ctx.organization.id, **body.model_dump())
    db.add(p)
    db.flush()
    _audit(db, ctx, request, "partner.created", p.id, {"name": p.name})
    db.commit()
    return _out(db, ctx, p, with_money=False)


@router.put("/partners/{partner_id}")
def update_partner(
    partner_id: uuid.UUID, body: PartnerIn, ctx: Auth, request: Request, db: DbSession
) -> PartnerOut:
    p = _partner(db, ctx, partner_id)
    _unique(db, ctx, body.name, exclude=p.id)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    _audit(db, ctx, request, "partner.updated", p.id, {"name": p.name})
    db.commit()
    return _out(db, ctx, p)


@router.get("/partners/summary")
def partners_month(
    ctx: Auth, db: DbSession, month: str = Query(pattern=r"^\d{4}-\d{2}$")
) -> list[PartnerMonthSummary]:
    m = date(int(month[:4]), int(month[5:]), 1)
    return [PartnerMonthSummary(**r) for r in month_summary(db, ctx.organization, m)]


@router.get("/partners/{partner_id}")
def partner_detail(partner_id: uuid.UUID, ctx: Auth, db: DbSession) -> PartnerDetail:
    p = _partner(db, ctx, partner_id)
    st = statement(db, ctx.organization, p)
    head = _out(db, ctx, p, with_money=False)
    head.earned, head.paid, head.outstanding, head.waiting = (
        st.earned,
        st.paid,
        st.outstanding,
        st.waiting,
    )
    channels = db.scalars(
        select(Channel).where(Channel.partner_id == p.id).order_by(Channel.name)
    ).all()
    contributions = db.execute(
        select(PartnerContribution, ContentDeal.title)
        .join(ContentDeal, ContentDeal.id == PartnerContribution.deal_id)
        .where(PartnerContribution.partner_id == p.id)
        .order_by(PartnerContribution.received_on.desc())
    ).all()
    payouts = db.scalars(
        select(PartnerPayout)
        .where(PartnerPayout.partner_id == p.id)
        .order_by(PartnerPayout.paid_on.desc())
    ).all()
    return PartnerDetail(
        partner=head,
        base_currency=ctx.organization.base_currency,
        months=[PartnerMonthOut(**{**vars(m), "month": f"{m.month:%Y-%m}"}) for m in st.months],
        deals=[PartnerDealOut(**vars(d)) for d in st.deals],
        channels=[
            PartnerChannelOut(
                id=c.id,
                name=c.name,
                platform=c.platform,
                external_id=c.external_id,
                cms_name=c.cms_partner.name if c.cms_partner else None,
                status=c.status,
            )
            for c in channels
        ],
        contributions=[
            ContributionOut(
                id=c.id,
                deal_id=c.deal_id,
                deal_title=title,
                amount=c.amount,
                received_on=c.received_on,
                reference=c.reference,
            )
            for c, title in contributions
        ],
        payouts=[
            PayoutOut(
                id=x.id,
                month=f"{x.month:%Y-%m}",
                amount=x.amount,
                tds_amount=x.tds_amount,
                paid_on=x.paid_on,
                reference=x.reference,
            )
            for x in payouts
        ],
        warnings=st.warnings,
    )


# ---- A deal's partners ---------------------------------------------------------------------


@router.get("/deals/{deal_id}/partners")
def deal_partners(deal_id: uuid.UUID, ctx: Auth, db: DbSession) -> list[DealPartnerOut]:
    deal = _deal(db, ctx, deal_id)
    return [
        DealPartnerOut(partner_id=s.partner_id, name=s.partner.name, share_pct=s.share_pct)
        for s in db.scalars(select(DealPartnerShare).where(DealPartnerShare.deal_id == deal.id))
    ]


@router.put("/deals/{deal_id}/partners")
def set_deal_partners(
    deal_id: uuid.UUID, body: DealPartnersIn, ctx: Auth, request: Request, db: DbSession
) -> list[DealPartnerOut]:
    deal = _deal(db, ctx, deal_id)
    ids = [s.partner_id for s in body.partners]
    if len(set(ids)) != len(ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A partner is listed twice")
    if sum((s.share_pct for s in body.partners), Decimal(0)) >= 100:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Partners together must hold less than 100%"
        )
    for s in body.partners:
        _partner(db, ctx, s.partner_id)
    existing = {
        s.partner_id: s
        for s in db.scalars(select(DealPartnerShare).where(DealPartnerShare.deal_id == deal.id))
    }
    for pid, s in existing.items():
        if pid not in ids:
            db.delete(s)
    for item in body.partners:
        if item.partner_id in existing:
            existing[item.partner_id].share_pct = item.share_pct
        else:
            db.add(
                DealPartnerShare(
                    organization_id=ctx.organization.id,
                    deal_id=deal.id,
                    partner_id=item.partner_id,
                    share_pct=item.share_pct,
                )
            )
    record_audit(
        db,
        "deal.partners_changed",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="deal",
        entity_id=deal.id,
        details={
            "title": deal.title,
            "partners": {str(s.partner_id): str(s.share_pct) for s in body.partners},
        },
        ip=client_ip(request),
    )
    db.commit()
    return deal_partners(deal_id, ctx, db)


# ---- Money in (licence share) and money out (payouts) ----------------------------------------


@router.post("/partners/{partner_id}/contributions", status_code=status.HTTP_201_CREATED)
def add_contribution(
    partner_id: uuid.UUID, body: ContributionIn, ctx: Auth, request: Request, db: DbSession
) -> ContributionOut:
    p = _partner(db, ctx, partner_id)
    deal = _deal(db, ctx, body.deal_id)
    if not db.scalar(
        select(DealPartnerShare.id).where(
            DealPartnerShare.deal_id == deal.id, DealPartnerShare.partner_id == p.id
        )
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"{p.name} is not a partner on {deal.title}"
        )
    c = PartnerContribution(
        organization_id=ctx.organization.id, partner_id=p.id, **body.model_dump()
    )
    db.add(c)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "partner.contribution_added",
        p.id,
        {"deal": deal.title, "amount": str(c.amount)},
    )
    db.commit()
    return ContributionOut(
        id=c.id,
        deal_id=deal.id,
        deal_title=deal.title,
        amount=c.amount,
        received_on=c.received_on,
        reference=c.reference,
    )


@router.delete("/partner-contributions/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contribution(item_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    c = db.scalar(
        select(PartnerContribution).where(
            PartnerContribution.id == item_id,
            PartnerContribution.organization_id == ctx.organization.id,
        )
    )
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    _audit(
        db, ctx, request, "partner.contribution_deleted", c.partner_id, {"amount": str(c.amount)}
    )
    db.delete(c)
    db.commit()


@router.post("/partners/{partner_id}/payouts", status_code=status.HTTP_201_CREATED)
def add_payout(
    partner_id: uuid.UUID, body: PayoutIn, ctx: Auth, request: Request, db: DbSession
) -> PayoutOut:
    p = _partner(db, ctx, partner_id)
    month = date(int(body.month[:4]), int(body.month[5:]), 1)
    if body.paid_on > date.today():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "The paid date cannot be in the future"
        )
    x = PartnerPayout(
        organization_id=ctx.organization.id,
        partner_id=p.id,
        month=month,
        amount=body.amount,
        tds_amount=body.tds_amount,
        paid_on=body.paid_on,
        reference=body.reference,
    )
    db.add(x)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "partner.paid",
        p.id,
        {"month": body.month, "amount": str(x.amount), "tds": str(x.tds_amount)},
    )
    db.commit()
    return PayoutOut(
        id=x.id,
        month=body.month,
        amount=x.amount,
        tds_amount=x.tds_amount,
        paid_on=x.paid_on,
        reference=x.reference,
    )


@router.delete("/partner-payouts/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_payout(item_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    x = db.scalar(
        select(PartnerPayout).where(
            PartnerPayout.id == item_id, PartnerPayout.organization_id == ctx.organization.id
        )
    )
    if x is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    try:
        ensure_open(db, ctx.organization, x.month, "This payment")
    except MonthClosedError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    _audit(db, ctx, request, "partner.payment_deleted", x.partner_id, {"amount": str(x.amount)})
    db.delete(x)
    db.commit()
