"""Month close (PDF slide 16 step 8): lock a month so its numbers cannot silently move.

While a month is closed:
  - revenue for its days cannot be imported or changed,
  - FX rates, fee tiers and incentive rates that would re-price it cannot be added,
  - slot, manager and team changes cannot be back-dated into it,
  - its incentive run is locked.
Cash receipts, statements and adjustments are still accepted: money arrives after a
month ends, and corrections are recorded as adjustments rather than edits.
"""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import MonthClose, Organization


class MonthClosedError(Exception):
    pass


def closed_months(db: Session, org: Organization) -> set[date]:
    return set(db.scalars(select(MonthClose.month).where(MonthClose.organization_id == org.id)))


def latest_closed(db: Session, org: Organization) -> date | None:
    return db.scalar(select(func.max(MonthClose.month)).where(MonthClose.organization_id == org.id))


def ensure_open(db: Session, org: Organization, day: date, what: str = "This change") -> None:
    """Refuse a change dated on or before the end of the latest closed month."""
    latest = latest_closed(db, org)
    if latest is not None and day.replace(day=1) <= latest:
        raise MonthClosedError(
            f"{what} falls in {day:%B %Y}, but months up to {latest:%B %Y} are closed. "
            "Record an adjustment instead, or reopen the month."
        )
