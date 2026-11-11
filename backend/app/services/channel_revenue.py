"""Channels' money, month by month: gross → tax → CMS fee → what the CMS pays.

The CMS fee and what the CMS pays come from the CMS's own sheet when one was uploaded for
that month (its statement line for the channel). Without a sheet they are worked out from the
CMS's fee slabs — the channel's share of the fee across all of that CMS's channels, as on the
CMS page — and marked so. Amounts in the base currency use the company's rate for the month.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Channel,
    CmsPartner,
    CmsStatement,
    CmsStatementLine,
    Organization,
    RevenueFact,
)
from app.services.cms_fees import money
from app.services.settlement import CmsMonth, channel_lines, cms_month, fx_rate


@dataclass
class RevenueMonth:
    channel_id: uuid.UUID
    month: date
    cms_id: uuid.UUID | None
    cms_name: str | None
    currency: str
    gross: Decimal
    tax: Decimal
    fee: Decimal | None
    net: Decimal | None  # what the CMS pays for this channel
    source: str | None  # "sheet" | "slabs" | None (no fee known)
    fx_rate: Decimal | None
    net_base: Decimal | None
    views: int | None
    # What the CMS charged its fee on (gross, or gross − tax for CMSs that take it after tax):
    # Taggify's own commission on a partner's channel is taken on the same amount.
    fee_on: Decimal


class Summaries:
    """CMS month summaries, worked out once per (CMS, month) and shared by every channel."""

    def __init__(self, db: Session, org: Organization):
        self.db, self.org = db, org
        self._months: dict[tuple[uuid.UUID, date], CmsMonth] = {}
        self._lines: dict[tuple[uuid.UUID, date], dict] = {}

    def month(self, cms: CmsPartner, month: date) -> CmsMonth:
        key = (cms.id, month)
        if key not in self._months:
            self._months[key] = cms_month(self.db, self.org, cms, month)
        return self._months[key]

    def line(self, cms: CmsPartner, month: date, channel_id: uuid.UUID):
        key = (cms.id, month)
        if key not in self._lines:
            summary = self.month(cms, month)
            self._lines[key] = (
                {x.channel_id: x for x in channel_lines(self.db, self.org, cms, month, summary)}
                if summary.fee is not None
                else {}
            )
        return self._lines[key].get(channel_id)


def revenue_months(
    db: Session,
    org: Organization,
    channel_ids: list[uuid.UUID],
    summaries: Summaries | None = None,
) -> list[RevenueMonth]:
    """Every month each channel earned something, newest first."""
    if not channel_ids:
        return []
    summaries = summaries or Summaries(db, org)
    groups: dict[tuple[uuid.UUID, date, uuid.UUID | None, str], list[RevenueFact]] = defaultdict(
        list
    )
    for fact in db.scalars(
        select(RevenueFact).where(
            RevenueFact.organization_id == org.id, RevenueFact.channel_id.in_(channel_ids)
        )
    ):
        key = (fact.channel_id, fact.day.replace(day=1), fact.cms_partner_id, fact.currency)
        groups[key].append(fact)

    cms_ids = {cms_id for _, _, cms_id, _ in groups if cms_id}
    partners = {
        p.id: p
        for p in db.scalars(select(CmsPartner).where(CmsPartner.id.in_(cms_ids or [uuid.uuid4()])))
    }
    # The CMS's own figures for each channel, per (channel, CMS, month, currency).
    sheet: dict[tuple[uuid.UUID, uuid.UUID, date, str], tuple[Decimal, Decimal]] = {}
    for line, statement in db.execute(
        select(CmsStatementLine, CmsStatement)
        .join(CmsStatement, CmsStatement.id == CmsStatementLine.statement_id)
        .where(CmsStatement.organization_id == org.id, CmsStatementLine.channel_id.in_(channel_ids))
    ):
        key = (line.channel_id, statement.cms_partner_id, statement.month, statement.currency)
        fee, net = sheet.get(key, (Decimal(0), Decimal(0)))
        sheet[key] = (fee + line.fee_amount, net + line.net_amount)

    out: list[RevenueMonth] = []
    for (channel_id, month, cms_id, currency), facts in groups.items():
        gross = money(sum((f.gross_amount for f in facts), Decimal(0)))
        tax = money(sum((f.tax_amount or Decimal(0) for f in facts), Decimal(0)))
        views_known = [f.views for f in facts if f.views is not None]
        cms = partners.get(cms_id) if cms_id else None
        fee_on = gross - tax if cms is None or cms.fee_after_tax else gross

        fee: Decimal | None = None
        net: Decimal | None = None
        source: str | None = None
        if cms and (channel_id, cms.id, month, currency) in sheet:
            fee, net = sheet[(channel_id, cms.id, month, currency)]
            source = "sheet"
        elif cms:
            if summaries.month(cms, month).currency == currency:
                mine = summaries.line(cms, month, channel_id)
                if mine and mine.fee_share is not None:
                    fee, net, source = mine.fee_share, mine.net_share, "slabs"
        else:
            fee, net, source = Decimal("0.00"), gross - tax, "slabs"  # no CMS, no fee

        rate = fx_rate(db, org, month, currency)
        out.append(
            RevenueMonth(
                channel_id=channel_id,
                month=month,
                cms_id=cms_id,
                cms_name=cms.name if cms else None,
                currency=currency,
                gross=gross,
                tax=tax,
                fee=fee,
                net=net,
                source=source,
                fx_rate=rate,
                net_base=money(net * rate) if net is not None and rate is not None else None,
                views=sum(views_known) if views_known else None,
                fee_on=fee_on,
            )
        )
    return sorted(out, key=lambda r: (r.month, r.cms_name or ""), reverse=True)


def channel_revenue(db: Session, org: Organization, channel: Channel) -> list[RevenueMonth]:
    """One channel's months, newest first."""
    return revenue_months(db, org, [channel.id])
