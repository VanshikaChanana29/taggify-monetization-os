"""Who earned what, day by day (PDF slides 12–13).

For every revenue row (channel, day, gross) we look up, *as of that day*:
  - the channel's manager            → manager incentive at their manager rate
  - the manager's team and its lead  → team-lead incentive at the lead's rate
Rates, managers, teams and leads are all effective-dated, so a handover or rate change
in the middle of a month splits that month correctly, and nothing in a past month moves
when today's assignments change.

Slide 13 example: $1,000 gross on Kapil YT-01, Ananya 1 % (manager) and Kabir 0.5 %
(her team lead) → $10 and $5, both on gross (before the CMS fee).
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Channel,
    ChannelManagerAssignment,
    Employee,
    IncentiveRate,
    Organization,
    RevenueFact,
    TeamLeadAssignment,
    TeamMembership,
)
from app.services.cms_fees import money
from app.services.settlement import fx_rate, month_end


def _on(rows: list, day: date):
    """The effective-dated row covering `day`, if any."""
    for r in rows:
        if r.start_date <= day and (r.end_date is None or r.end_date >= day):
            return r
    return None


class Timeline:
    """Everything needed to answer "who managed / led what on day X" for one company."""

    def __init__(self, db: Session, org: Organization):
        self.managers: dict[uuid.UUID, list[ChannelManagerAssignment]] = defaultdict(list)
        for a in db.scalars(
            select(ChannelManagerAssignment).where(
                ChannelManagerAssignment.organization_id == org.id
            )
        ):
            self.managers[a.channel_id].append(a)
        self.memberships: dict[uuid.UUID, list[TeamMembership]] = defaultdict(list)
        for m in db.scalars(select(TeamMembership).where(TeamMembership.organization_id == org.id)):
            self.memberships[m.employee_id].append(m)
        self.leads: dict[uuid.UUID, list[TeamLeadAssignment]] = defaultdict(list)
        for lead in db.scalars(
            select(TeamLeadAssignment).where(TeamLeadAssignment.organization_id == org.id)
        ):
            self.leads[lead.team_id].append(lead)
        self.rates: dict[tuple[uuid.UUID, str], list[tuple[date, Decimal]]] = defaultdict(list)
        for r in db.scalars(select(IncentiveRate).where(IncentiveRate.organization_id == org.id)):
            self.rates[(r.employee_id, r.kind)].append((r.effective_from, r.rate_pct))
        for key in self.rates:
            self.rates[key].sort()
        self.names = dict(
            db.execute(
                select(Employee.id, Employee.full_name).where(Employee.organization_id == org.id)
            ).all()
        )

    def manager(self, channel_id: uuid.UUID, day: date) -> uuid.UUID | None:
        a = _on(self.managers.get(channel_id, []), day)
        return a.employee_id if a else None

    def lead_of(self, employee_id: uuid.UUID, day: date) -> uuid.UUID | None:
        m = _on(self.memberships.get(employee_id, []), day)
        if m is None:
            return None
        lead = _on(self.leads.get(m.team_id, []), day)
        if lead is None or lead.employee_id == employee_id:
            return None
        return lead.employee_id

    def rate(self, employee_id: uuid.UUID, kind: str, day: date) -> Decimal | None:
        current = None
        for start, pct in self.rates.get((employee_id, kind), []):
            if start <= day:
                current = pct
        return current

    def earners(self, channel_id: uuid.UUID, day: date) -> list[tuple[uuid.UUID, str]]:
        """[(employee, kind)] earning on this channel on this day."""
        out = []
        manager = self.manager(channel_id, day)
        if manager:
            out.append((manager, "manager"))
            lead = self.lead_of(manager, day)
            if lead:
                out.append((lead, "team_lead"))
        return out


@dataclass
class Line:
    employee_id: uuid.UUID
    channel_id: uuid.UUID
    kind: str
    currency: str
    days: int = 0
    gross: Decimal = Decimal(0)
    amount: Decimal = Decimal(0)
    rates: set[Decimal] = field(default_factory=set)


@dataclass
class IncentiveCalc:
    lines: list[Line]
    amount_base: dict[tuple, Decimal]
    total_base: Decimal
    warnings: list[str]


def calculate(db: Session, org: Organization, month: date) -> IncentiveCalc:
    timeline = Timeline(db, org)
    # Deal partners run their own channels: no Taggify incentive on those.
    facts = db.scalars(
        select(RevenueFact)
        .join(Channel, Channel.id == RevenueFact.channel_id)
        .where(
            RevenueFact.organization_id == org.id,
            RevenueFact.day >= month,
            RevenueFact.day < month_end(month),
            Channel.partner_id.is_(None),
        )
    ).all()
    lines: dict[tuple, Line] = {}
    missing_rate: set[tuple[uuid.UUID, str]] = set()
    unmanaged: set[uuid.UUID] = set()
    for f in facts:
        earners = timeline.earners(f.channel_id, f.day)
        if not earners:
            unmanaged.add(f.channel_id)
        for employee_id, kind in earners:
            key = (employee_id, f.channel_id, kind, f.currency)
            line = lines.setdefault(key, Line(employee_id, f.channel_id, kind, f.currency))
            line.days += 1
            line.gross += f.gross_amount
            rate = timeline.rate(employee_id, kind, f.day)
            if rate is None:
                missing_rate.add((employee_id, kind))
                continue
            line.rates.add(rate)
            line.amount += f.gross_amount * rate / 100

    warnings = [
        f"{timeline.names.get(e, 'Someone')} has no {'manager' if k == 'manager' else 'team-lead'} "
        "incentive rate for part of this month — counted as 0."
        for e, k in sorted(missing_rate, key=lambda x: (timeline.names.get(x[0], ""), x[1]))
    ]
    if unmanaged:
        warnings.append(f"{len(unmanaged)} channel(s) earned revenue on days with no manager.")

    amount_base: dict[tuple, Decimal] = {}
    total = Decimal(0)
    fx_missing: set[str] = set()
    for key, line in lines.items():
        line.amount = money(line.amount)
        line.gross = money(line.gross)
        rate = fx_rate(db, org, month, line.currency)
        if rate is None:
            fx_missing.add(line.currency)
            amount_base[key] = Decimal("0.00")
            continue
        amount_base[key] = money(line.amount * rate)
        total += amount_base[key]
    for cur in sorted(fx_missing):
        warnings.append(
            f"No {cur}→{org.base_currency} rate for this month; those incentives show as 0."
        )
    return IncentiveCalc(list(lines.values()), amount_base, money(total), warnings)


def rate_label(rates: set[Decimal]) -> str:
    if not rates:
        return "—"
    return " → ".join(f"{r.normalize():f}%" for r in sorted(rates))
