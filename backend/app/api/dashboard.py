"""Part 5: founder dashboard (PDF slide 15) and the all-companies group view."""

from dataclasses import asdict
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.deps import Auth
from app.core.database import DbSession
from app.models import Membership, Organization, YouTubeConnection
from app.schemas.dashboard import (
    AgingOut,
    AttentionItem,
    CompanyRow,
    DashboardOut,
    DealRecovery,
    GroupOut,
    TopChannel,
    TopPerson,
    TotalsOut,
    TrendPoint,
)
from app.schemas.finance import parse_month
from app.services.dashboard import Totals, build, company_totals, default_month

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

MonthParam = Query(default=None, pattern=r"^\d{4}-\d{2}$")


def _month(value: str | None, db, org):
    if value is None:
        return default_month(db, org)
    try:
        return parse_month(value)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


def _totals(t: Totals) -> TotalsOut:
    return TotalsOut(**asdict(t))


@router.get("")
def dashboard(ctx: Auth, db: DbSession, month: str | None = MonthParam) -> DashboardOut:
    d = build(db, ctx.organization, _month(month, db, ctx.organization))
    return DashboardOut(
        month=f"{d.month:%Y-%m}",
        base_currency=d.base_currency,
        current=_totals(d.current),
        previous=_totals(d.previous),
        incentives=d.incentives,
        rights_cost=d.rights_cost,
        net_contribution=d.net_contribution,
        recovery_pct=d.recovery_pct,
        trend=[TrendPoint(month=f"{m:%Y-%m}", **asdict(t)) for m, t in d.trend],
        money=[AttentionItem(**asdict(i)) for i in d.money],
        operations=[AttentionItem(**asdict(i)) for i in d.operations],
        deals=[DealRecovery(**asdict(r)) for r in d.deals],
        channels=[TopChannel(**asdict(c)) for c in d.channels],
        aging=[AgingOut(**asdict(a)) for a in d.aging],
        people=[TopPerson(**asdict(p)) for p in d.people],
        youtube_last_sync=db.scalar(
            select(func.max(YouTubeConnection.last_synced_at)).where(
                YouTubeConnection.organization_id == ctx.organization.id
            )
        ),
    )


@router.get("/group")
def group(ctx: Auth, db: DbSession, month: str | None = MonthParam) -> GroupOut:
    """Every company this founder can open, side by side for one month."""
    m = _month(month, db, ctx.organization)
    orgs = db.scalars(
        select(Organization)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == ctx.user.id, Membership.is_active.is_(True))
        .order_by(Organization.name)
    ).all()
    rows = []
    for org in orgs:
        c = company_totals(db, org, m)
        rows.append(
            CompanyRow(
                organization_id=org.id,
                name=org.name,
                base_currency=org.base_currency,
                closed=c.closed,
                current=org.id == ctx.organization.id,
                **asdict(c.totals),
            )
        )
    currencies = {r.base_currency for r in rows}
    total = None
    if len(currencies) == 1:
        zero = Decimal("0.00")
        total = TotalsOut(
            gross=sum((r.gross for r in rows), zero),
            fee=sum((r.fee for r in rows), zero),
            net=sum((r.net for r in rows), zero),
            received=sum((r.received for r in rows), zero),
            outstanding=sum((r.outstanding for r in rows), zero),
            complete=all(r.complete for r in rows),
        )
    return GroupOut(
        month=f"{m:%Y-%m}",
        companies=rows,
        total=total,
        currency=currencies.pop() if len(currencies) == 1 else None,
    )
