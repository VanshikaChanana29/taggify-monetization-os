"""One channel's money, month by month: gross → tax → CMS fee → what the CMS pays.

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
from app.services.settlement import channel_lines, cms_month, fx_rate


@dataclass
class RevenueMonth:
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


def channel_revenue(db: Session, org: Organization, channel: Channel) -> list[RevenueMonth]:
    """Every month the channel earned something, newest first."""
    groups: dict[tuple[date, uuid.UUID | None, str], list[RevenueFact]] = defaultdict(list)
    for fact in db.scalars(
        select(RevenueFact).where(
            RevenueFact.organization_id == org.id, RevenueFact.channel_id == channel.id
        )
    ):
        groups[(fact.day.replace(day=1), fact.cms_partner_id, fact.currency)].append(fact)

    cms_ids = {cms_id for _, cms_id, _ in groups if cms_id}
    partners = {
        p.id: p
        for p in db.scalars(select(CmsPartner).where(CmsPartner.id.in_(cms_ids or [uuid.uuid4()])))
    }
    # The CMS's own figures for this channel, per (CMS, month, currency).
    sheet: dict[tuple[uuid.UUID, date, str], tuple[Decimal, Decimal]] = {}
    for line, statement in db.execute(
        select(CmsStatementLine, CmsStatement)
        .join(CmsStatement, CmsStatement.id == CmsStatementLine.statement_id)
        .where(CmsStatement.organization_id == org.id, CmsStatementLine.channel_id == channel.id)
    ):
        key = (statement.cms_partner_id, statement.month, statement.currency)
        fee, net = sheet.get(key, (Decimal(0), Decimal(0)))
        sheet[key] = (fee + line.fee_amount, net + line.net_amount)

    out: list[RevenueMonth] = []
    for (month, cms_id, currency), facts in groups.items():
        gross = money(sum((f.gross_amount for f in facts), Decimal(0)))
        tax = money(sum((f.tax_amount or Decimal(0) for f in facts), Decimal(0)))
        views_known = [f.views for f in facts if f.views is not None]
        cms = partners.get(cms_id) if cms_id else None

        fee: Decimal | None = None
        net: Decimal | None = None
        source: str | None = None
        if cms and (cms.id, month, currency) in sheet:
            fee, net = sheet[(cms.id, month, currency)]
            source = "sheet"
        elif cms:
            summary = cms_month(db, org, cms, month)
            if summary.currency == currency and summary.fee is not None:
                mine = next(
                    (
                        x
                        for x in channel_lines(db, org, cms, month, summary)
                        if x.channel_id == channel.id
                    ),
                    None,
                )
                if mine and mine.fee_share is not None:
                    fee, net, source = mine.fee_share, mine.net_share, "slabs"
        else:
            fee, net, source = Decimal("0.00"), gross - tax, "slabs"  # no CMS, no fee

        rate = fx_rate(db, org, month, currency)
        out.append(
            RevenueMonth(
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
            )
        )
    return sorted(out, key=lambda r: (r.month, r.cms_name or ""), reverse=True)
