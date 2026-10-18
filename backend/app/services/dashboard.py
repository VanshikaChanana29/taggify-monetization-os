"""Founder homepage (PDF slide 15): money and operations on one screen.

Every number is summed from the same sources the finance pages use (settlements, deal
economics, installments), so a card always matches the page it links to.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    BankReceipt,
    Channel,
    ChannelManagerAssignment,
    CmsAdjustment,
    CmsStatement,
    ContentDeal,
    DealInstallment,
    DealSlot,
    Employee,
    IncentiveRun,
    MonthClose,
    Organization,
    RevenueFact,
    SlotAssignment,
)
from app.services.cms_fees import money
from app.services.deal_economics import deal_economics
from app.services.deals import (
    EXPIRING_SOON_DAYS,
    company_today,
    effective_status,
    notice_deadline,
)
from app.services.incentives import calculate
from app.services.settlement import CmsMonth, fx_rate, month_end, month_settlements

TREND_MONTHS = 6
INSTALLMENT_HORIZON_DAYS = 30
NOTICE_HORIZON_DAYS = 30
ZERO = Decimal("0.00")


def shift(month: date, n: int) -> date:
    y, m = divmod(month.year * 12 + month.month - 1 + n, 12)
    return date(y, m + 1, 1)


@dataclass
class Totals:
    gross: Decimal = ZERO
    fee: Decimal = ZERO
    net: Decimal = ZERO
    received: Decimal = ZERO
    outstanding: Decimal = ZERO
    complete: bool = True


def totals(rows: list[CmsMonth]) -> Totals:
    t = Totals()
    for r in rows:
        if r.gross_base is None or (r.cms_id and r.net_base is None):
            t.complete = False
        t.gross += r.gross_base or ZERO
        t.fee += r.fee_base or ZERO
        t.net += r.net_base or ZERO
        t.received += r.received
        t.outstanding += r.outstanding or ZERO
    return t


@dataclass
class Item:
    """One line in an attention box; `href` is where the founder clicks through to."""

    key: str
    title: str
    detail: str
    href: str
    severity: str = "warning"  # "danger" | "warning" | "info"
    amount: Decimal | None = None


@dataclass
class DealRow:
    id: uuid.UUID
    title: str
    owner: str
    status: str
    rights_cost: Decimal
    net_contribution: Decimal
    recovery_pct: Decimal | None
    payable: Decimal


@dataclass
class ChannelRow:
    id: uuid.UUID
    name: str
    platform: str
    manager: str | None
    gross: Decimal


AGING_BUCKETS = ("not_due", "d0_30", "d31_60", "d61_90", "d90_plus")


@dataclass
class AgingRow:
    """What a CMS still owes, by how long ago the settlement month ended."""

    cms_id: uuid.UUID
    cms_name: str
    buckets: dict[str, Decimal]
    total: Decimal


@dataclass
class PersonRow:
    id: uuid.UUID
    name: str
    channels: int
    gross: Decimal  # gross of the channels they managed this month, base currency
    incentive: Decimal


@dataclass
class Dashboard:
    month: date
    base_currency: str
    current: Totals
    previous: Totals
    incentives: Decimal | None
    rights_cost: Decimal
    net_contribution: Decimal
    recovery_pct: Decimal | None
    trend: list[tuple[date, Totals]]
    money: list[Item] = field(default_factory=list)
    operations: list[Item] = field(default_factory=list)
    deals: list[DealRow] = field(default_factory=list)
    channels: list[ChannelRow] = field(default_factory=list)
    aging: list[AgingRow] = field(default_factory=list)
    people: list[PersonRow] = field(default_factory=list)


def activity_months(db: Session, org: Organization) -> set[date]:
    """Every month with revenue, receipts, statements or adjustments."""
    months = {
        d.date()
        for d in db.scalars(
            select(func.date_trunc("month", RevenueFact.day))
            .where(RevenueFact.organization_id == org.id)
            .distinct()
        )
    }
    for model in (BankReceipt, CmsAdjustment, CmsStatement):
        months |= set(
            db.scalars(select(model.month).where(model.organization_id == org.id).distinct())
        )
    return months


def default_month(db: Session, org: Organization) -> date:
    """The latest month with revenue, else the current month."""
    current = company_today(org).replace(day=1)
    latest = db.scalar(
        select(func.max(RevenueFact.day)).where(
            RevenueFact.organization_id == org.id, RevenueFact.day < month_end(current)
        )
    )
    return latest.replace(day=1) if latest else current


def build(db: Session, org: Organization, month: date) -> Dashboard:
    today = company_today(org)
    base = org.base_currency
    cache: dict[date, list[CmsMonth]] = {}

    def rows(m: date) -> list[CmsMonth]:
        if m not in cache:
            cache[m] = month_settlements(db, org, m)
        return cache[m]

    trend = [(shift(month, -i), totals(rows(shift(month, -i)))) for i in range(TREND_MONTHS)]
    trend.reverse()
    run = db.scalar(
        select(IncentiveRun).where(
            IncentiveRun.organization_id == org.id, IncentiveRun.month == month
        )
    )

    deals = db.scalars(
        select(ContentDeal)
        .options(selectinload(ContentDeal.slots))
        .where(ContentDeal.organization_id == org.id, ContentDeal.status != "draft")
    ).all()
    deal_rows: list[DealRow] = []
    rights_total = net_total = ZERO
    for deal in deals:
        if deal.deal_type not in ("fixed_fee", "hybrid"):
            continue
        e = deal_economics(db, org, deal)
        if not e.rights_cost:
            continue
        rights_total += e.rights_cost
        net_total += e.net_contribution
        deal_rows.append(
            DealRow(
                deal.id,
                deal.title,
                deal.owner.name,
                effective_status(deal, today),
                e.rights_cost,
                e.net_contribution,
                e.recovery_pct,
                e.payable,
            )
        )
    deal_rows.sort(key=lambda d: d.rights_cost, reverse=True)

    result = Dashboard(
        month=month,
        base_currency=base,
        current=trend[-1][1],
        previous=trend[-2][1],
        incentives=run.total_base if run else None,
        rights_cost=money(rights_total),
        net_contribution=money(net_total),
        recovery_pct=(net_total / rights_total * 100).quantize(Decimal("0.1"))
        if rights_total
        else None,
        trend=trend,
        deals=deal_rows[:6],
        channels=_top_channels(db, org, month),
    )
    result.money = _money_items(db, org, month, today, rows, run)
    result.operations = _operation_items(db, org, today, deals)
    result.aging = _aging(db, org, month, today, rows)
    result.people = _top_people(db, org, month)
    return result


def _bucket(days: int) -> str:
    if days < 0:
        return "not_due"
    if days <= 30:
        return "d0_30"
    if days <= 60:
        return "d31_60"
    return "d61_90" if days <= 90 else "d90_plus"


def _aging(db, org, month, today, rows) -> list[AgingRow]:
    """Outstanding per CMS up to the viewed month, aged from each month's end (docx §9)."""
    out: dict[uuid.UUID, AgingRow] = {}
    for m in sorted(m for m in activity_months(db, org) if m <= month):
        age = (today - month_end(m)).days
        for r in rows(m):
            if not (r.cms_id and r.outstanding):
                continue
            row = out.setdefault(
                r.cms_id, AgingRow(r.cms_id, r.cms_name, dict.fromkeys(AGING_BUCKETS, ZERO), ZERO)
            )
            row.buckets[_bucket(age)] += r.outstanding
            row.total += r.outstanding
    return sorted((r for r in out.values() if r.total), key=lambda r: -r.total)


def _top_people(db: Session, org: Organization, month: date, limit: int = 5):
    """Leaderboard: who managed the most gross this month, and what they earn on it."""
    calc = calculate(db, org, month)
    rows: dict[uuid.UUID, PersonRow] = {}
    names = dict(
        db.execute(
            select(Employee.id, Employee.full_name).where(Employee.organization_id == org.id)
        ).all()
    )
    channels: dict[uuid.UUID, set] = defaultdict(set)
    for line in calc.lines:
        row = rows.setdefault(
            line.employee_id, PersonRow(line.employee_id, names[line.employee_id], 0, ZERO, ZERO)
        )
        key = (line.employee_id, line.channel_id, line.kind, line.currency)
        row.incentive += calc.amount_base.get(key, ZERO)
        if line.kind == "manager":
            channels[line.employee_id].add(line.channel_id)
            rate = (
                Decimal(1)
                if line.currency == org.base_currency
                else fx_rate(db, org, month, line.currency)
            )
            if rate is not None:
                row.gross += money(line.gross * rate)
    for employee_id, row in rows.items():
        row.channels = len(channels[employee_id])
    ranked = sorted(rows.values(), key=lambda r: (-r.gross, -r.incentive, r.name))
    return ranked[:limit]


def _top_channels(db: Session, org: Organization, month: date, limit: int = 5):
    sums: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    for channel_id, currency, gross in db.execute(
        select(RevenueFact.channel_id, RevenueFact.currency, func.sum(RevenueFact.gross_amount))
        .where(
            RevenueFact.organization_id == org.id,
            RevenueFact.day >= month,
            RevenueFact.day < month_end(month),
        )
        .group_by(RevenueFact.channel_id, RevenueFact.currency)
    ):
        rate = Decimal(1) if currency == org.base_currency else fx_rate(db, org, month, currency)
        if rate is not None:
            sums[channel_id] += gross * rate
    top = sorted(sums.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    if not top:
        return []
    channels = {
        c.id: c for c in db.scalars(select(Channel).where(Channel.id.in_([i for i, _ in top])))
    }
    managers = {
        a.channel_id: a.employee.full_name
        for a in db.scalars(
            select(ChannelManagerAssignment).where(
                ChannelManagerAssignment.channel_id.in_(channels),
                ChannelManagerAssignment.end_date.is_(None),
            )
        )
    }
    return [
        ChannelRow(i, channels[i].name, channels[i].platform, managers.get(i), money(g))
        for i, g in top
    ]


def _money_items(db, org, month, today, rows, run) -> list[Item]:
    items: list[Item] = []
    label = f"{month:%B %Y}"
    current = today.replace(day=1)
    past = sorted(m for m in activity_months(db, org) if m <= month)

    # CMS balances still owed, across every month up to the one being viewed.
    owed: dict[uuid.UUID, list] = {}
    for m in past:
        for r in rows(m):
            if r.cms_id and r.outstanding:
                entry = owed.setdefault(r.cms_id, [r.cms_name, ZERO, m])
                entry[1] += r.outstanding
                if r.outstanding > 0:
                    entry[2] = m
    for cms_id, (name, amount, latest) in sorted(owed.items(), key=lambda kv: -kv[1][1]):
        if amount > 0:
            items.append(
                Item(
                    f"cms-outstanding-{cms_id}",
                    f"{name} outstanding",
                    "Net receivable not yet received in the bank",
                    f"/finance/{cms_id}?month={latest:%Y-%m}",
                    "warning",
                    money(amount),
                )
            )

    # Installments to content owners: overdue, or due within the next 30 days.
    horizon = today + timedelta(days=INSTALLMENT_HORIZON_DAYS)
    for inst, title in db.execute(
        select(DealInstallment, ContentDeal.title)
        .join(ContentDeal, ContentDeal.id == DealInstallment.deal_id)
        .where(
            DealInstallment.organization_id == org.id,
            DealInstallment.paid_on.is_(None),
            DealInstallment.due_date <= horizon,
        )
        .order_by(DealInstallment.due_date)
    ):
        overdue = inst.due_date < today
        items.append(
            Item(
                f"installment-{inst.id}",
                f"{title} installment {'overdue' if overdue else 'due'}",
                f"{'Was due' if overdue else 'Due'} {inst.due_date:%d %b %Y}",
                f"/deals/{inst.deal_id}?tab=payments",
                "danger" if overdue else "info",
                inst.amount,
            )
        )

    this_month = rows(month)
    mismatches = [r for r in this_month if r.variance is not None and r.variance != 0]
    if mismatches:
        items.append(
            Item(
                "mismatches",
                f"{len(mismatches)} settlement mismatch{'es' if len(mismatches) > 1 else ''}",
                "CMS statement differs from our calculation: "
                + ", ".join(r.cms_name for r in mismatches),
                f"/finance?month={month:%Y-%m}",
                "danger",
            )
        )
    missing = [r.cms_name for r in this_month if r.warnings]
    if missing:
        items.append(
            Item(
                "pricing",
                "Numbers incomplete",
                f"Fee tiers or FX rate missing for {label}: {', '.join(missing)}",
                f"/finance?month={month:%Y-%m}",
                "warning",
            )
        )
    has_revenue = any(r.gross for r in this_month)
    if has_revenue and (run is None or run.status not in ("approved", "locked")):
        items.append(
            Item(
                "incentives",
                "Incentives not approved",
                f"Calculate and approve incentives for {label}",
                f"/finance/incentives?month={month:%Y-%m}",
                "info",
            )
        )

    closed = set(db.scalars(select(MonthClose.month).where(MonthClose.organization_id == org.id)))
    open_past = [m for m in past if m < current and m not in closed]
    if open_past:
        oldest = open_past[0]
        more = f" (+{len(open_past) - 1} more)" if len(open_past) > 1 else ""
        items.append(
            Item(
                "close",
                f"Close {oldest:%B %Y}{more}",
                "Finished month not locked yet",
                f"/finance/close?month={oldest:%Y-%m}",
                "info",
            )
        )
    return items


def _operation_items(db, org, today, deals) -> list[Item]:
    items: list[Item] = []
    expiring = [
        d
        for d in deals
        if effective_status(d, today) == "active"
        and d.term_end <= today + timedelta(days=EXPIRING_SOON_DAYS)
    ]
    if expiring:
        first = min(expiring, key=lambda d: d.term_end)
        items.append(
            Item(
                "expiring",
                f"{len(expiring)} deal{'s' if len(expiring) > 1 else ''} expiring soon",
                f"{first.title} ends {first.term_end:%d %b %Y}",
                "/deals?status=expiring",
                "danger" if first.term_end <= today + timedelta(days=30) else "warning",
            )
        )

    horizon = today + timedelta(days=NOTICE_HORIZON_DAYS)
    notices = sorted(
        (
            (notice_deadline(d), d)
            for d in deals
            if effective_status(d, today) == "active"
            and notice_deadline(d) is not None
            and today <= notice_deadline(d) <= horizon
        ),
        key=lambda x: x[0],
    )
    for deadline, d in notices:
        items.append(
            Item(
                f"notice-{d.id}",
                f"Renewal notice due for {d.title}",
                f"Tell {d.owner.name} by {deadline:%d %b %Y} ({d.notice_period_days} days "
                f"before the licence ends {d.term_end:%d %b %Y})",
                f"/deals/{d.id}",
                "danger" if deadline <= today + timedelta(days=7) else "warning",
            )
        )

    pending = [(d, s) for d in deals for s in d.slots if s.status == "pending_whitelist"]
    if pending:
        items.append(
            Item(
                "whitelisting",
                f"{len(pending)} whitelisting request{'s' if len(pending) > 1 else ''} pending",
                ", ".join(sorted({f"{d.title} {s.code}" for d, s in pending}))[:200],
                f"/deals/{pending[0][0].id}?tab=slots",
                "warning",
            )
        )

    open_slot = exists(
        select(SlotAssignment.id).where(
            SlotAssignment.slot_id == DealSlot.id, SlotAssignment.end_date.is_(None)
        )
    )
    live = [d for d in deals if effective_status(d, today) == "active"]
    vacant = (
        db.execute(
            select(DealSlot.deal_id, func.count())
            .where(DealSlot.deal_id.in_([d.id for d in live]), ~open_slot)
            .group_by(DealSlot.deal_id)
        ).all()
        if live
        else []
    )
    if vacant:
        titles = {d.id: d.title for d in live}
        count = sum(n for _, n in vacant)
        items.append(
            Item(
                "vacant",
                f"{count} unused slot{'s' if count > 1 else ''} on live deals",
                ", ".join(sorted(titles[i] for i, _ in vacant)),
                f"/deals/{vacant[0][0]}?tab=slots" if len(vacant) == 1 else "/deals?status=active",
                "info",
            )
        )

    has_manager = exists(
        select(ChannelManagerAssignment.id).where(
            ChannelManagerAssignment.channel_id == Channel.id,
            ChannelManagerAssignment.end_date.is_(None),
        )
    )
    unmanaged = db.scalar(
        select(func.count()).where(
            Channel.organization_id == org.id, Channel.status == "active", ~has_manager
        )
    )
    if unmanaged:
        items.append(
            Item(
                "unmanaged",
                f"{unmanaged} channel{'s' if unmanaged > 1 else ''} without a manager",
                "Nobody earns or is accountable for their revenue",
                "/channels?managed=no&status=active",
                "warning",
            )
        )
    return items


@dataclass
class CompanyTotals:
    organization: Organization
    month: date
    totals: Totals
    closed: bool


def company_totals(db: Session, org: Organization, month: date) -> CompanyTotals:
    closed = db.scalar(
        select(MonthClose.id).where(MonthClose.organization_id == org.id, MonthClose.month == month)
    )
    return CompanyTotals(org, month, totals(month_settlements(db, org, month)), closed is not None)
