"""What Taggify owes a deal partner, month by month (founders' rules, 26 Oct 2026).

A partner's channels earn through Taggify's CMS partners like any other. For each month:

    partner's share  = their channels' gross − tax the CMS withheld − their share of the CMS fee
    due              = only once the CMS has paid Taggify for that month
    TDS              = share × the partner's TDS %
    to pay           = share − TDS
    still to pay     = to pay − what Taggify has already paid them

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
    PartnerContribution,
    PartnerPayout,
    RevenueFact,
)
from app.services.cms_fees import money
from app.services.settlement import channel_lines, cms_month, fx_rate, month_end

ZERO = Decimal("0.00")


@dataclass
class PartnerMonth:
    month: date
    currency: str | None
    channels: int = 0
    gross: Decimal = ZERO
    tax: Decimal = ZERO
    cms_fee: Decimal = ZERO
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
class PartnerStatement:
    months: list[PartnerMonth] = field(default_factory=list)
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


def statement(db: Session, org: Organization, partner: DealPartner) -> PartnerStatement:
    out = PartnerStatement()
    tds_pct = partner.tds_pct or ZERO
    channel_ids = list(db.scalars(select(Channel.id).where(Channel.partner_id == partner.id)))

    # Which CMS each month's earnings went through.
    pairs: dict[date, set[uuid.UUID | None]] = defaultdict(set)
    if channel_ids:
        month_col = func.date_trunc("month", RevenueFact.day)
        for m, cms_id in db.execute(
            select(month_col, RevenueFact.cms_partner_id)
            .where(RevenueFact.channel_id.in_(channel_ids))
            .distinct()
        ):
            pairs[m.date() if hasattr(m, "date") else m].add(cms_id)

    payouts: dict[date, list[PartnerPayout]] = defaultdict(list)
    for p in db.scalars(select(PartnerPayout).where(PartnerPayout.partner_id == partner.id)):
        payouts[p.month].append(p)

    mine = set(channel_ids)
    for month in sorted(set(pairs) | set(payouts), reverse=True):
        row = PartnerMonth(month=month, currency=None)
        seen: set[uuid.UUID] = set()
        rate_missing = fee_missing = False
        share_base = ZERO
        for cms_id in pairs.get(month, set()):
            cms = db.get(CmsPartner, cms_id) if cms_id else None
            summary = cms_month(db, org, cms, month)
            lines = [
                line
                for line in channel_lines(db, org, cms, month, summary)
                if line.channel_id in mine
            ]
            if not lines:
                continue
            row.currency = row.currency or summary.currency
            for line in lines:
                seen.add(line.channel_id)
                row.gross += line.gross
                row.tax += line.tax
                if line.fee_share is None:
                    fee_missing = True
                    continue
                row.cms_fee += line.fee_share
                row.share += line.net_share or ZERO
                rate = Decimal(1) if summary.currency == org.base_currency else summary.fx_rate
                if rate is None:
                    rate_missing = True
                else:
                    share_base += (line.net_share or ZERO) * rate
            if cms is not None:
                # Due only once the CMS has paid Taggify in full for the month.
                paid_in_full = (
                    summary.net_base is not None
                    and summary.net_base > 0
                    and (summary.outstanding or ZERO) <= 0
                )
                row.cms_paid = row.cms_paid and paid_in_full
        row.channels = len(seen)
        row.paid = money(sum((p.amount for p in payouts.get(month, [])), ZERO))
        row.tds_paid = money(sum((p.tds_amount for p in payouts.get(month, [])), ZERO))
        if fee_missing:
            row.status, row.share_base, row.tds, row.to_pay, row.balance = (
                "needs_slabs",
                None,
                None,
                None,
                None,
            )
        elif rate_missing:
            row.status, row.share_base, row.tds, row.to_pay, row.balance = (
                "needs_rate",
                None,
                None,
                None,
                None,
            )
        else:
            row.share_base = money(share_base)
            row.tds = money(row.share_base * tds_pct / 100)
            row.to_pay = row.share_base - row.tds
            row.balance = row.to_pay - row.paid
            out.earned += row.share_base
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

    if partner.tds_pct is None:
        out.warnings.append("No TDS % set for this partner — TDS shows as 0 until you add it.")
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
