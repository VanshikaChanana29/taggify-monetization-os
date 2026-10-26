"""Deal profitability (PDF slide 11): economic recovery of the rights cost.

Gross revenue is attributed to a deal day by day: a channel's revenue on a day belongs
to the deal whose slot the channel held that day (split evenly if it held slots in
several deals). From that gross we take the tax the CMS withheld, the CMS fee (at the CMS's
effective rate for the month), the incentives paid on it, and the deal's operating expenses:

    net contribution = gross − tax − CMS fee − incentives − expenses (− owner share)

A partnership has no rights cost: the partner gets their % of what is left after tax and
the CMS fee, and our incentives and expenses come out of our part.

Deal partners (e.g. Vanshika holding 50% of the Sony deal) pay their % of the licence fee
and keep their own channels' earnings, so Taggify's rights cost is only its own part and
the partner's channels are left out here.
    recovery %       = net contribution ÷ rights cost

Installments only change what is still payable in cash — never the rights cost.
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
    DealExpense,
    DealInstallment,
    DealPartnerShare,
    DealSlot,
    Organization,
    RevenueFact,
    SlotAssignment,
)
from app.services.cms_fees import money
from app.services.incentives import Timeline
from app.services.settlement import cms_month, fx_rate


@dataclass
class MonthRow:
    month: str
    gross: Decimal = Decimal(0)
    tax: Decimal = Decimal(0)
    cms_fee: Decimal = Decimal(0)
    incentives: Decimal = Decimal(0)


@dataclass
class Economics:
    base_currency: str
    deal_type: str
    rights_cost: Decimal | None
    gross: Decimal = Decimal(0)
    tax: Decimal = Decimal(0)
    cms_fee: Decimal = Decimal(0)
    incentives: Decimal = Decimal(0)
    expenses: Decimal = Decimal(0)
    owner_share: Decimal = Decimal(0)
    # The owner's full revenue share before netting the minimum guarantee (hybrid deals).
    royalty: Decimal = Decimal(0)
    net_contribution: Decimal = Decimal(0)
    recovery_pct: Decimal | None = None
    remaining: Decimal | None = None
    installments_total: Decimal = Decimal(0)
    paid: Decimal = Decimal(0)
    payable: Decimal = Decimal(0)
    next_due_date: date | None = None
    next_due_amount: Decimal | None = None
    by_month: list[MonthRow] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def deal_economics(db: Session, org: Organization, deal: ContentDeal) -> Economics:
    base = org.base_currency
    warnings: list[str] = []

    rights_cost = None
    # The rights cost is the licence fee, or for a hybrid deal the minimum guarantee.
    partner_pct = db.scalar(
        select(func.coalesce(func.sum(DealPartnerShare.share_pct), 0)).where(
            DealPartnerShare.deal_id == deal.id
        )
    )
    ours = (Decimal(100) - Decimal(partner_pct)) / 100
    if deal.deal_type in ("fixed_fee", "hybrid") and deal.fee_amount is not None:
        if deal.currency == base:
            rights_cost = money(deal.fee_amount * ours)
        else:
            rate = fx_rate(db, org, deal.term_start.replace(day=1), deal.currency)
            if rate is None:
                warnings.append(
                    f"No {deal.currency}→{base} rate for {deal.term_start:%b %Y} "
                    "to value the licence fee."
                )
            else:
                rights_cost = money(deal.fee_amount * rate * ours)

    # Every slot holding of this deal's slots, and of any other deal by the same channels.
    slot_ids = [s.id for s in deal.slots]
    held = db.scalars(
        select(SlotAssignment).where(SlotAssignment.slot_id.in_(slot_ids or [uuid.uuid4()]))
    ).all()
    # A partner's own channels earn for the partner, not for Taggify.
    partner_channels = set(
        db.scalars(
            select(Channel.id).where(
                Channel.id.in_({a.channel_id for a in held} or {uuid.uuid4()}),
                Channel.partner_id.is_not(None),
            )
        )
    )
    channel_ids = {a.channel_id for a in held} - partner_channels
    all_holdings: dict[uuid.UUID, list[tuple[SlotAssignment, uuid.UUID]]] = defaultdict(list)
    if channel_ids:
        for a, deal_id in db.execute(
            select(SlotAssignment, DealSlot.deal_id)
            .join(DealSlot, DealSlot.id == SlotAssignment.slot_id)
            .where(SlotAssignment.channel_id.in_(channel_ids))
        ):
            all_holdings[a.channel_id].append((a, deal_id))

    facts = (
        db.scalars(
            select(RevenueFact).where(
                RevenueFact.organization_id == org.id, RevenueFact.channel_id.in_(channel_ids)
            )
        ).all()
        if channel_ids
        else []
    )
    timeline = Timeline(db, org)
    # (CMS, month) → (fee as a share of what it is charged on, charged after tax?)
    cms_cache: dict[tuple, tuple[Decimal, bool] | None] = {}
    fx_cache: dict[tuple, Decimal | None] = {}
    months: dict[str, MonthRow] = {}
    fx_missing: set[str] = set()
    fee_missing: set[str] = set()
    result = Economics(base_currency=base, deal_type=deal.deal_type, rights_cost=rights_cost)

    for f in facts:
        holders = [
            deal_id
            for a, deal_id in all_holdings[f.channel_id]
            if a.start_date <= f.day and (a.end_date is None or a.end_date >= f.day)
        ]
        if deal.id not in holders:
            continue
        share = Decimal(1) / len(set(holders))
        month = f.day.replace(day=1)
        key = (month, f.currency)
        if key not in fx_cache:
            fx_cache[key] = fx_rate(db, org, month, f.currency)
        rate = fx_cache[key]
        if rate is None:
            fx_missing.add(f"{f.currency} {month:%b %Y}")
            continue
        gross_base = f.gross_amount * share * rate
        tax_base = (f.tax_amount or Decimal(0)) * share * rate

        fee_base = Decimal(0)
        if f.cms_partner_id:
            ck = (f.cms_partner_id, month)
            if ck not in cms_cache:
                cms = db.get(CmsPartner, f.cms_partner_id)
                summary = cms_month(db, org, cms, month)
                fee_on = summary.gross - summary.tax if cms.fee_after_tax else summary.gross
                cms_cache[ck] = (
                    (summary.fee / fee_on, cms.fee_after_tax)
                    if summary.fee is not None and fee_on
                    else None
                )
            if cms_cache[ck] is None:
                fee_missing.add(f"{month:%b %Y}")
            else:
                fee_rate, after_tax = cms_cache[ck]
                fee_base = (gross_base - tax_base if after_tax else gross_base) * fee_rate

        incentive_base = Decimal(0)
        for employee_id, kind in timeline.earners(f.channel_id, f.day):
            pct = timeline.rate(employee_id, kind, f.day)
            if pct:
                incentive_base += gross_base * pct / 100

        row = months.setdefault(f"{month:%Y-%m}", MonthRow(f"{month:%Y-%m}"))
        row.gross += gross_base
        row.tax += tax_base
        row.cms_fee += fee_base
        row.incentives += incentive_base

    for row in months.values():
        row.gross, row.tax, row.cms_fee, row.incentives = (
            money(row.gross),
            money(row.tax),
            money(row.cms_fee),
            money(row.incentives),
        )
        result.gross += row.gross
        result.tax += row.tax
        result.cms_fee += row.cms_fee
        result.incentives += row.incentives
    result.by_month = sorted(months.values(), key=lambda r: r.month)

    result.expenses = money(
        db.scalar(
            select(func.coalesce(func.sum(DealExpense.amount), 0)).where(
                DealExpense.deal_id == deal.id
            )
        )
    )
    if deal.deal_type == "partnership" and deal.revenue_share_pct is not None:
        after_cms = result.gross - result.tax - result.cms_fee
        result.royalty = money(after_cms * deal.revenue_share_pct / 100)
        result.owner_share = result.royalty
    elif deal.deal_type in ("revenue_share", "hybrid") and deal.revenue_share_pct is not None:
        result.royalty = money(result.gross * deal.revenue_share_pct / 100)
        # Hybrid: the minimum guarantee is an advance on the owner's share, so only the
        # share above it is an extra cost.
        recouped = (rights_cost or Decimal(0)) if deal.deal_type == "hybrid" else Decimal(0)
        result.owner_share = max(Decimal("0.00"), result.royalty - recouped)
    result.net_contribution = (
        result.gross
        - result.tax
        - result.cms_fee
        - result.incentives
        - result.expenses
        - result.owner_share
    )
    if rights_cost:
        result.recovery_pct = (result.net_contribution * 100 / rights_cost).quantize(Decimal("0.1"))
        result.remaining = max(Decimal("0.00"), rights_cost - result.net_contribution)

    installments = db.scalars(
        select(DealInstallment)
        .where(DealInstallment.deal_id == deal.id)
        .order_by(DealInstallment.due_date)
    ).all()
    result.installments_total = money(sum((i.amount for i in installments), Decimal(0)))
    result.paid = money(sum((i.paid_amount or Decimal(0) for i in installments), Decimal(0)))
    result.payable = result.installments_total - result.paid
    upcoming = next((i for i in installments if i.paid_on is None), None)
    if upcoming:
        result.next_due_date, result.next_due_amount = upcoming.due_date, upcoming.amount
    if (
        rights_cost is not None
        and deal.currency == base
        and installments
        and result.installments_total != deal.fee_amount
    ):
        warnings.append(
            f"Installments add up to {result.installments_total:,.2f} "
            f"but the licence fee is {deal.fee_amount:,.2f}."
        )

    if fx_missing:
        warnings.append(f"Revenue left out for missing FX rates: {', '.join(sorted(fx_missing))}.")
    if fee_missing:
        warnings.append(f"CMS fee unknown (no fee tiers) for: {', '.join(sorted(fee_missing))}.")
    result.warnings = warnings
    return result
