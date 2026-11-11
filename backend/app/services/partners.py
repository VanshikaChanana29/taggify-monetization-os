"""What Taggify owes a deal partner, month by month (founders' rules, 26 Oct and 11 Nov 2026).

A partner's channels earn through Taggify's CMS partners like any other. For each channel and
month (CMS fee from the CMS's sheet when uploaded, else from its slabs):

    Taggify commission = the owner's % for the channel × what the CMS charged its fee on
                         (e.g. CMS 10% + Taggify 5% = 15% off the partner); none unless set
    partner's share    = gross − tax the CMS withheld − CMS fee − Taggify commission
    due                = only once the CMS has paid Taggify for that month
    still to pay       = share − what Taggify has already paid them   (no TDS: founders)

The partner also owes Taggify their % of each licence fee (e.g. ₹25L of Sony's ₹50L).
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Channel,
    CmsPartner,
    ContentDeal,
    DealPartner,
    DealPartnerShare,
    Organization,
    PartnerCommission,
    PartnerContribution,
    PartnerPayout,
    RevenueFact,
)
from app.services.channel_revenue import RevenueMonth, Summaries, revenue_months
from app.services.cms_fees import money
from app.services.settlement import fx_rate, month_end

ZERO = Decimal("0.00")


@dataclass
class PartnerMonth:
    month: date
    currency: str | None
    channels: int = 0
    gross: Decimal = ZERO
    tax: Decimal = ZERO
    cms_fee: Decimal = ZERO
    commission: Decimal = ZERO  # Taggify's own, in the CMS's currency
    commission_base: Decimal | None = ZERO
    share: Decimal = ZERO  # in the CMS's currency
    share_base: Decimal | None = ZERO
    tds: Decimal | None = ZERO
    to_pay: Decimal | None = ZERO
    paid: Decimal = ZERO
    tds_paid: Decimal = ZERO
    balance: Decimal | None = ZERO
    cms_paid: bool = True
    # waiting_cms | due | part_paid | paid | needs_rate | needs_slabs
    status: str = "due"


@dataclass
class PartnerDeal:
    deal_id: uuid.UUID
    title: str
    owner: str
    share_pct: Decimal
    licence_share: Decimal | None  # their % of the licence fee, base currency
    contributed: Decimal = ZERO
    contribution_due: Decimal | None = None


@dataclass
class PartnerChannelMonth:
    """One partner channel's month: what it earned, what Taggify kept, what is theirs."""

    channel_id: uuid.UUID
    month: date
    cms_name: str | None
    currency: str
    gross: Decimal
    tax: Decimal
    cms_fee: Decimal | None
    source: str | None
    commission_pct: Decimal | None  # None = not set
    commission: Decimal | None
    share: Decimal | None
    fx_rate: Decimal | None
    commission_base: Decimal | None
    share_base: Decimal | None
    views: int | None


@dataclass
class PartnerStatement:
    months: list[PartnerMonth] = field(default_factory=list)
    channel_months: list[PartnerChannelMonth] = field(default_factory=list)
    commission: Decimal = ZERO  # Taggify's commission, base currency, months with a rate
    deals: list[PartnerDeal] = field(default_factory=list)
    earned: Decimal = ZERO  # share, base currency, all months with a rate
    due: Decimal = ZERO  # to pay, months the CMS has paid
    waiting: Decimal = ZERO  # to pay, months the CMS has not paid yet
    paid: Decimal = ZERO
    outstanding: Decimal = ZERO  # due − paid
    warnings: list[str] = field(default_factory=list)


def partner_channel_ids(db: Session, org: Organization) -> set[uuid.UUID]:
    """Channels run by a deal partner: their money is the partner's, not Taggify's."""
    return set(
        db.scalars(
            select(Channel.id).where(
                Channel.organization_id == org.id, Channel.partner_id.is_not(None)
            )
        )
    )


def partner_pct_by_deal(db: Session, org: Organization) -> dict[uuid.UUID, Decimal]:
    """{deal: total % held by partners}."""
    return {
        d: Decimal(p)
        for d, p in db.execute(
            select(DealPartnerShare.deal_id, func.sum(DealPartnerShare.share_pct))
            .where(DealPartnerShare.organization_id == org.id)
            .group_by(DealPartnerShare.deal_id)
        )
    }


def _licence_base(db: Session, org: Organization, deal: ContentDeal) -> Decimal | None:
    if deal.deal_type not in ("fixed_fee", "hybrid") or deal.fee_amount is None:
        return None
    if deal.currency == org.base_currency:
        return deal.fee_amount
    rate = fx_rate(db, org, deal.term_start.replace(day=1), deal.currency)
    return money(deal.fee_amount * rate) if rate is not None else None


def commissions(db: Session, partner_ids: list[uuid.UUID]) -> dict[uuid.UUID, list]:
    """{partner: their commission rows, newest first}."""
    out: dict[uuid.UUID, list[PartnerCommission]] = defaultdict(list)
    for row in db.scalars(
        select(PartnerCommission)
        .where(PartnerCommission.partner_id.in_(partner_ids or [uuid.uuid4()]))
        .order_by(PartnerCommission.effective_from.desc())
    ):
        out[row.partner_id].append(row)
    return out


def commission_pct(rows: list, channel_id: uuid.UUID, month: date) -> Decimal | None:
    """The % in force for a channel in a month: its own rate, else the partner's, else none."""
    for wanted in (channel_id, None):
        for row in rows:
            if row.channel_id == wanted and row.effective_from <= month:
                return row.pct
    return None


def channel_money(lines: list[RevenueMonth], rows: list) -> list[PartnerChannelMonth]:
    """Each channel-month with Taggify's commission and the partner's share worked out."""
    out = []
    for x in lines:
        pct = commission_pct(rows, x.channel_id, x.month)
        commission = share = None
        if x.fee is not None and x.net is not None:
            commission = money(x.fee_on * (pct or ZERO) / 100)
            share = x.net - commission
        known = x.fx_rate is not None
        out.append(
            PartnerChannelMonth(
                channel_id=x.channel_id,
                month=x.month,
                cms_name=x.cms_name,
                currency=x.currency,
                gross=x.gross,
                tax=x.tax,
                cms_fee=x.fee,
                source=x.source,
                commission_pct=pct,
                commission=commission,
                share=share,
                fx_rate=x.fx_rate,
                commission_base=(
                    money(commission * x.fx_rate) if known and commission is not None else None
                ),
                share_base=money(share * x.fx_rate) if known and share is not None else None,
                views=x.views,
            )
        )
    return out


def statement(db: Session, org: Organization, partner: DealPartner) -> PartnerStatement:
    out = PartnerStatement()
    channel_ids = list(db.scalars(select(Channel.id).where(Channel.partner_id == partner.id)))
    summaries = Summaries(db, org)
    out.channel_months = channel_money(
        revenue_months(db, org, channel_ids, summaries),
        commissions(db, [partner.id]).get(partner.id, []),
    )
    by_month: dict[date, list[PartnerChannelMonth]] = defaultdict(list)
    for line in out.channel_months:
        by_month[line.month].append(line)
    cms_by_name = {
        c.name: c
        for c in db.scalars(select(CmsPartner).where(CmsPartner.organization_id == org.id))
    }

    payouts: dict[date, list[PartnerPayout]] = defaultdict(list)
    for p in db.scalars(select(PartnerPayout).where(PartnerPayout.partner_id == partner.id)):
        payouts[p.month].append(p)

    for month in sorted(set(by_month) | set(payouts), reverse=True):
        row = PartnerMonth(month=month, currency=None)
        rate_missing = fee_missing = False
        share_base = commission_base = ZERO
        lines = by_month.get(month, [])
        for line in lines:
            row.currency = row.currency or line.currency
            row.gross += line.gross
            row.tax += line.tax
            if line.share is None or line.cms_fee is None or line.commission is None:
                fee_missing = True
                continue
            row.cms_fee += line.cms_fee
            row.commission += line.commission
            row.share += line.share
            if line.share_base is None or line.commission_base is None:
                rate_missing = True
            else:
                share_base += line.share_base
                commission_base += line.commission_base
        for name in {line.cms_name for line in lines if line.cms_name}:
            summary = summaries.month(cms_by_name[name], month)
            # Due only once the CMS has paid Taggify in full for the month.
            paid_in_full = (
                summary.net_base is not None
                and summary.net_base > 0
                and (summary.outstanding or ZERO) <= 0
            )
            row.cms_paid = row.cms_paid and paid_in_full
        row.channels = len({line.channel_id for line in lines})
        row.paid = money(sum((p.amount for p in payouts.get(month, [])), ZERO))
        row.tds_paid = money(sum((p.tds_amount for p in payouts.get(month, [])), ZERO))
        if fee_missing or rate_missing:
            row.status = "needs_slabs" if fee_missing else "needs_rate"
            row.share_base = row.commission_base = row.tds = row.to_pay = row.balance = None
        else:
            row.share_base = money(share_base)
            row.commission_base = money(commission_base)
            row.tds = ZERO  # founders: no TDS on partner payments
            row.to_pay = row.share_base
            row.balance = row.to_pay - row.paid
            out.earned += row.share_base
            out.commission += row.commission_base
            if not row.cms_paid:
                row.status = "waiting_cms"
                out.waiting += row.to_pay
            else:
                out.due += row.to_pay
                row.status = "paid" if row.balance <= 0 else "part_paid" if row.paid > 0 else "due"
        out.paid += row.paid
        out.months.append(row)
    out.outstanding = money(out.due - out.paid)

    contributed = defaultdict(lambda: ZERO)
    for deal_id, amount in db.execute(
        select(PartnerContribution.deal_id, func.sum(PartnerContribution.amount))
        .where(PartnerContribution.partner_id == partner.id)
        .group_by(PartnerContribution.deal_id)
    ):
        contributed[deal_id] = money(amount)
    for share, deal in db.execute(
        select(DealPartnerShare, ContentDeal)
        .join(ContentDeal, ContentDeal.id == DealPartnerShare.deal_id)
        .where(DealPartnerShare.partner_id == partner.id)
        .order_by(ContentDeal.title)
    ):
        licence = _licence_base(db, org, deal)
        part = money(licence * share.share_pct / 100) if licence is not None else None
        out.deals.append(
            PartnerDeal(
                deal_id=deal.id,
                title=deal.title,
                owner=deal.owner.name,
                share_pct=share.share_pct,
                licence_share=part,
                contributed=contributed[deal.id],
                contribution_due=(part - contributed[deal.id]) if part is not None else None,
            )
        )

    if any(m.status == "needs_rate" for m in out.months):
        out.warnings.append(
            "Some months have no exchange rate, so the partner's share cannot be valued."
        )
    if any(m.status == "needs_slabs" for m in out.months):
        out.warnings.append(
            "Some months have no CMS fee slabs, so the partner's share cannot be worked out."
        )
    return out


def month_summary(db: Session, org: Organization, month: date) -> list[dict]:
    """Per partner, for one month: channels, gross and their share (dashboard)."""
    rows = []
    for partner in db.scalars(
        select(DealPartner).where(DealPartner.organization_id == org.id).order_by(DealPartner.name)
    ):
        ids = list(db.scalars(select(Channel.id).where(Channel.partner_id == partner.id)))
        if not ids:
            continue
        gross = db.scalar(
            select(func.coalesce(func.sum(RevenueFact.gross_amount), 0)).where(
                RevenueFact.channel_id.in_(ids),
                RevenueFact.day >= month,
                RevenueFact.day < month_end(month),
            )
        )
        rows.append(
            {
                "id": partner.id,
                "name": partner.name,
                "channels": len(ids),
                "gross": money(Decimal(gross)),
            }
        )
    return rows


def _in(month: date, start: date | None, end: date | None) -> bool:
    return (start is None or month >= start) and (end is None or month <= end)


def _base(amount: Decimal | None, rate: Decimal | None) -> Decimal | None:
    return money(amount * rate) if amount is not None and rate is not None else None


def leaderboard(db: Session, org: Organization, start: date | None, end: date | None) -> dict:
    """Dashboard: which partners (and which of their channels) earn Taggify the most."""
    partners = db.scalars(
        select(DealPartner).where(DealPartner.organization_id == org.id).order_by(DealPartner.name)
    ).all()
    names = {
        c.id: (c.name, c.partner_id)
        for c in db.scalars(
            select(Channel).where(
                Channel.organization_id == org.id, Channel.partner_id.is_not(None)
            )
        )
    }
    rows, channels, missing = [], defaultdict(lambda: [ZERO, ZERO, ZERO]), 0
    for partner in partners:
        st = statement(db, org, partner)
        lines = [x for x in st.channel_months if _in(x.month, start, end)]
        if not lines and not names_for(names, partner.id):
            continue
        gross = commission = share = ZERO
        for x in lines:
            g = _base(x.gross, x.fx_rate)
            if g is None or x.commission_base is None or x.share_base is None:
                missing += 1
                continue
            gross += g
            commission += x.commission_base
            share += x.share_base
            totals = channels[x.channel_id]
            totals[0] += g
            totals[1] += x.commission_base
            totals[2] += x.share_base
        rows.append(
            {
                "id": partner.id,
                "name": partner.name,
                "channels": len(names_for(names, partner.id)),
                "earning_channels": len({x.channel_id for x in lines}),
                "gross": money(gross),
                "commission": money(commission),
                "share": money(share),
            }
        )
    rows.sort(key=lambda r: (r["commission"], r["gross"]), reverse=True)
    by_id = {p.id: p.name for p in partners}
    top = sorted(
        (
            {
                "channel_id": cid,
                "name": names[cid][0],
                "partner_id": names[cid][1],
                "partner_name": by_id.get(names[cid][1], ""),
                "gross": money(v[0]),
                "commission": money(v[1]),
                "share": money(v[2]),
            }
            for cid, v in channels.items()
            if cid in names
        ),
        key=lambda r: (r["commission"], r["gross"]),
        reverse=True,
    )[:10]
    return {
        "base_currency": org.base_currency,
        "partners": rows,
        "top_channels": top,
        "gross": money(sum((r["gross"] for r in rows), ZERO)),
        "commission": money(sum((r["commission"] for r in rows), ZERO)),
        "share": money(sum((r["share"] for r in rows), ZERO)),
        "missing": missing,
    }


def names_for(names: dict, partner_id: uuid.UUID) -> list[uuid.UUID]:
    return [cid for cid, (_, pid) in names.items() if pid == partner_id]


def deal_earnings(
    db: Session, org: Organization, deal: ContentDeal, start: date | None, end: date | None
) -> dict:
    """Everything a deal's channels earned Taggify: its own channels' money from the CMS, and
    its commission on partners' channels — channel by channel, for months they held its slots."""
    from app.models import DealSlot, SlotAssignment

    held: dict[uuid.UUID, list[tuple[date, date | None]]] = defaultdict(list)
    for channel_id, s, e in db.execute(
        select(SlotAssignment.channel_id, SlotAssignment.start_date, SlotAssignment.end_date)
        .join(DealSlot, DealSlot.id == SlotAssignment.slot_id)
        .where(DealSlot.deal_id == deal.id)
    ):
        held[channel_id].append((s, e))
    channels = {
        c.id: c for c in db.scalars(select(Channel).where(Channel.id.in_(list(held) or [deal.id])))
    }
    partner_ids = list({c.partner_id for c in channels.values() if c.partner_id})
    rates = commissions(db, partner_ids)
    partner_names = {
        p.id: p.name
        for p in db.scalars(select(DealPartner).where(DealPartner.id.in_(partner_ids or [deal.id])))
    }

    lines = revenue_months(db, org, list(held))
    rows: dict[uuid.UUID, dict] = {}
    missing = 0
    for x in lines:
        if not _in(x.month, start, end) or not any(
            s < month_end(x.month) and (e is None or e >= x.month) for s, e in held[x.channel_id]
        ):
            continue
        ch = channels[x.channel_id]
        row = rows.setdefault(
            ch.id,
            {
                "channel_id": ch.id,
                "name": ch.name,
                "partner_name": partner_names.get(ch.partner_id) if ch.partner_id else None,
                "months": 0,
                "gross": ZERO,
                "cms_fee": ZERO,
                "taggify": ZERO,
                "partner": ZERO,
            },
        )
        row["months"] += 1
        gross, fee = _base(x.gross, x.fx_rate), _base(x.fee, x.fx_rate)
        net = _base((x.gross - x.tax - x.fee) if x.fee is not None else None, x.fx_rate)
        if gross is None or fee is None or net is None:
            missing += 1
            continue
        row["gross"] += gross
        row["cms_fee"] += fee
        if ch.partner_id:
            pct = commission_pct(rates.get(ch.partner_id, []), ch.id, x.month) or ZERO
            commission = money((_base(x.fee_on, x.fx_rate) or ZERO) * pct / 100)
            row["taggify"] += commission
            row["partner"] += net - commission
        else:
            row["taggify"] += net
    out = sorted(rows.values(), key=lambda r: r["taggify"], reverse=True)
    own = [r for r in out if r["partner_name"] is None]
    theirs = [r for r in out if r["partner_name"] is not None]
    licence = _licence_base(db, org, deal)
    partner_pct = partner_pct_by_deal(db, org).get(deal.id, ZERO)
    return {
        "base_currency": org.base_currency,
        "channels": out,
        "own": money(sum((r["taggify"] for r in own), ZERO)),
        "commission": money(sum((r["taggify"] for r in theirs), ZERO)),
        "partners_share": money(sum((r["partner"] for r in theirs), ZERO)),
        "gross": money(sum((r["gross"] for r in out), ZERO)),
        "licence_cost": money(licence * (100 - partner_pct) / 100) if licence is not None else None,
        "missing": missing,
    }
