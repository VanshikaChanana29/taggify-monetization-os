"""Month-level CMS settlement: gross → CMS fee → net receivable → cash → outstanding.

PDF slide 9 (fee across all of a CMS's channels), slide 10 (net receivable − receipts ±
adjustments = outstanding) and slide 16 steps 2–6. Everything is computed from the
stored facts, so changing a fee schedule or an FX rate re-prices the month.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    BankReceipt,
    Channel,
    CmsAdjustment,
    CmsPartner,
    CmsStatement,
    ContentDeal,
    DealSlot,
    FxRate,
    Organization,
    RevenueFact,
    SlotAssignment,
)
from app.services.cms_fees import allocate, fee_for, money, schedule_for


def month_end(month: date) -> date:
    return date(month.year + (month.month == 12), month.month % 12 + 1, 1)


@dataclass
class CmsMonth:
    cms_id: uuid.UUID | None  # None = channels with no CMS
    cms_name: str
    currency: str | None
    gross: Decimal = Decimal("0.00")
    fee: Decimal | None = None
    net: Decimal | None = None
    fee_rule: str | None = None
    fx_rate: Decimal | None = None
    gross_base: Decimal | None = None
    fee_base: Decimal | None = None
    net_base: Decimal | None = None
    statement_net: Decimal | None = None
    variance: Decimal | None = None
    adjustments: Decimal = Decimal("0.00")
    # Receipts valued at the month's FX rate: what they clear of the receivable.
    received: Decimal = Decimal("0.00")
    # What the bank actually credited, and the FX gain (+) or loss (−) between the two.
    received_credited: Decimal = Decimal("0.00")
    fx_difference: Decimal = Decimal("0.00")
    outstanding: Decimal | None = None
    channel_count: int = 0
    warnings: list[str] = field(default_factory=list)


def fx_rate(db: Session, org: Organization, month: date, currency: str) -> Decimal | None:
    if currency == org.base_currency:
        return Decimal(1)
    return db.scalar(
        select(FxRate.rate).where(
            FxRate.organization_id == org.id, FxRate.month == month, FxRate.currency == currency
        )
    )


def _gross_by_channel(db: Session, org: Organization, month: date, cms_id: uuid.UUID | None):
    """{(channel_id, currency): (gross, views)} for the month."""
    stmt = (
        select(
            RevenueFact.channel_id,
            RevenueFact.currency,
            func.sum(RevenueFact.gross_amount),
            func.sum(RevenueFact.views),
        )
        .where(
            RevenueFact.organization_id == org.id,
            RevenueFact.day >= month,
            RevenueFact.day < month_end(month),
        )
        .group_by(RevenueFact.channel_id, RevenueFact.currency)
    )
    stmt = stmt.where(
        RevenueFact.cms_partner_id == cms_id if cms_id else RevenueFact.cms_partner_id.is_(None)
    )
    return {(c, cur): (g or Decimal(0), v) for c, cur, g, v in db.execute(stmt)}


def receipt_value(db: Session, org: Organization, receipt: BankReceipt) -> Decimal | None:
    """A receipt at the settlement month's FX rate, so $15,000 clears $15,000 of the
    receivable whatever rate the bank used (that difference is FX gain/loss)."""
    if receipt.currency == org.base_currency:
        return receipt.amount
    rate = fx_rate(db, org, receipt.month, receipt.currency)
    return money(receipt.amount * rate) if rate is not None else None


def cms_month(db: Session, org: Organization, cms: CmsPartner | None, month: date) -> CmsMonth:
    cms_id = cms.id if cms else None
    rows = _gross_by_channel(db, org, month, cms_id)
    currencies = sorted({cur for _, cur in rows})
    schedule = schedule_for(db, cms_id, month) if cms else None
    currency = schedule.currency if schedule else (currencies[0] if currencies else None)
    result = CmsMonth(cms_id=cms_id, cms_name=cms.name if cms else "No CMS", currency=currency)
    result.channel_count = len({c for c, _ in rows})

    other = [cur for cur in currencies if cur != currency]
    if other:
        result.warnings.append(
            f"Revenue in {', '.join(other)} is left out: this CMS settles in {currency}."
        )
    result.gross = money(
        sum((g for (_, cur), (g, _) in rows.items() if cur == currency), Decimal(0))
    )

    if cms:
        if schedule is None:
            result.warnings.append("No fee schedule for this month — add one on the CMS partner.")
        else:
            result.fee = fee_for(result.gross, schedule)
            result.net = result.gross - result.fee
            result.fee_rule = f"{schedule.tier_type} tiers from {schedule.effective_from:%d %b %Y}"
    else:
        result.fee, result.net = Decimal("0.00"), result.gross

    if currency:
        result.fx_rate = fx_rate(db, org, month, currency)
        if result.fx_rate is None:
            result.warnings.append(f"No {currency}→{org.base_currency} rate for this month.")
        else:
            result.gross_base = money(result.gross * result.fx_rate)
            if result.fee is not None:
                result.fee_base = money(result.fee * result.fx_rate)
                result.net_base = result.gross_base - result.fee_base

    if cms:
        statement = db.scalar(
            select(CmsStatement).where(
                CmsStatement.cms_partner_id == cms.id, CmsStatement.month == month
            )
        )
        if statement:
            result.statement_net = statement.net_amount
            if result.net is not None and statement.currency == currency:
                result.variance = statement.net_amount - result.net
        result.adjustments = money(
            db.scalar(
                select(func.coalesce(func.sum(CmsAdjustment.amount), 0)).where(
                    CmsAdjustment.cms_partner_id == cms.id, CmsAdjustment.month == month
                )
            )
        )
        receipts = db.scalars(
            select(BankReceipt).where(
                BankReceipt.cms_partner_id == cms.id, BankReceipt.month == month
            )
        ).all()
        for r in receipts:
            valued = receipt_value(db, org, r)
            if valued is None:
                result.warnings.append(
                    f"No {r.currency}→{org.base_currency} rate for this month to value a "
                    "receipt; counted at the amount credited."
                )
                valued = r.amount_base
            result.received += valued
            result.received_credited += r.amount_base
        result.received = money(result.received)
        result.received_credited = money(result.received_credited)
        result.fx_difference = result.received_credited - result.received
        if result.net_base is not None:
            result.outstanding = result.net_base + result.adjustments - result.received
    return result


def month_settlements(db: Session, org: Organization, month: date) -> list[CmsMonth]:
    """One row per CMS that had revenue, money or a statement this month (+ "No CMS")."""
    active_ids = set(
        db.scalars(
            select(RevenueFact.cms_partner_id)
            .where(
                RevenueFact.organization_id == org.id,
                RevenueFact.day >= month,
                RevenueFact.day < month_end(month),
            )
            .distinct()
        )
    )
    for model in (BankReceipt, CmsAdjustment, CmsStatement):
        active_ids |= set(
            db.scalars(
                select(model.cms_partner_id)
                .where(model.organization_id == org.id, model.month == month)
                .distinct()
            )
        )
    partners = db.scalars(
        select(CmsPartner)
        .where(
            CmsPartner.organization_id == org.id, CmsPartner.id.in_([i for i in active_ids if i])
        )
        .order_by(CmsPartner.name)
    ).all()
    rows = [cms_month(db, org, p, month) for p in partners]
    if None in active_ids:
        rows.append(cms_month(db, org, None, month))
    return rows


@dataclass
class ChannelLine:
    channel_id: uuid.UUID
    channel_name: str
    platform: str
    deals: list[str]
    gross: Decimal
    fee_share: Decimal | None
    net_share: Decimal | None
    views: int | None


def channel_lines(
    db: Session, org: Organization, cms: CmsPartner | None, month: date, summary: CmsMonth
) -> list[ChannelLine]:
    """Slide 9 table: each channel's gross and its share of the CMS fee."""
    rows = _gross_by_channel(db, org, month, cms.id if cms else None)
    gross = {c: g for (c, cur), (g, _) in rows.items() if cur == summary.currency}
    views = {c: v for (c, cur), (_, v) in rows.items() if cur == summary.currency}
    fee_shares = allocate(summary.fee, gross) if summary.fee is not None else {}
    channels = {
        c.id: c
        for c in db.scalars(select(Channel).where(Channel.id.in_(list(gross) or [uuid.uuid4()])))
    }
    # Deals whose slots the channel held at any point in the month.
    deals: dict[uuid.UUID, set[str]] = defaultdict(set)
    if gross:
        for channel_id, title in db.execute(
            select(SlotAssignment.channel_id, ContentDeal.title)
            .join(DealSlot, DealSlot.id == SlotAssignment.slot_id)
            .join(ContentDeal, ContentDeal.id == DealSlot.deal_id)
            .where(
                SlotAssignment.channel_id.in_(list(gross)),
                SlotAssignment.start_date < month_end(month),
                or_(SlotAssignment.end_date.is_(None), SlotAssignment.end_date >= month),
            )
        ):
            deals[channel_id].add(title)
    lines = [
        ChannelLine(
            channel_id=c,
            channel_name=channels[c].name,
            platform=channels[c].platform,
            deals=sorted(deals.get(c, [])),
            gross=money(g),
            fee_share=fee_shares.get(c),
            net_share=money(g) - fee_shares[c] if c in fee_shares else None,
            views=views.get(c),
        )
        for c, g in gross.items()
    ]
    return sorted(lines, key=lambda line: line.gross, reverse=True)
