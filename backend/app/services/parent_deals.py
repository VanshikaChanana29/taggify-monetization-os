"""Parent deals: one contract with a content owner holding several shows (founders, 17 Nov 2026).

e.g. Sony, ₹1 Cr, Jan 2026 → Dec 2027, with 10 shows under it. Rules:

* every show has the parent's owner and deal type, and its term lies inside the parent's;
* for fee deals the shows' own amounts (same currency) add up to at most the parent's amount,
  e.g. shows of ₹30L + ₹25L + ₹20L leave ₹25L for more shows;
* the parent's amount cannot go below what its shows already hold, and its dates must still
  cover every show.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ContentDeal, ParentDeal
from app.schemas.deals import DealIn, ParentDealIn

PAYS_FEE = ("fixed_fee", "hybrid")


class ParentDealError(Exception):
    pass


def amount_text(amount: Decimal, currency: str | None) -> str:
    return f"{currency or ''} {amount:,.2f}".strip()


def parent_status(parent: ParentDeal, today: date) -> str:
    if today < parent.term_start:
        return "upcoming"
    if today > parent.term_end:
        return "expired"
    return "active"


def allotted(db: Session, parent_id: uuid.UUID, without: uuid.UUID | None = None) -> Decimal:
    """What the parent's shows' own amounts add up to (leaving one show out, if given)."""
    stmt = select(func.coalesce(func.sum(ContentDeal.fee_amount), 0)).where(
        ContentDeal.parent_id == parent_id
    )
    if without is not None:
        stmt = stmt.where(ContentDeal.id != without)
    return Decimal(db.scalar(stmt))


def check_show(db: Session, parent: ParentDeal, body: DealIn, show_id: uuid.UUID | None) -> None:
    """Can this show (new, or show_id being edited) sit under this parent as given?"""
    if body.deal_type != parent.deal_type:
        raise ParentDealError(
            f"{parent.name} is a {parent.deal_type.replace('_', ' ')} deal; "
            "its shows must be the same type"
        )
    if body.term_start < parent.term_start or body.term_end > parent.term_end:
        raise ParentDealError(
            f"The show's term must be within the deal's term "
            f"({parent.term_start:%d %b %Y} → {parent.term_end:%d %b %Y})"
        )
    if parent.deal_type not in PAYS_FEE or parent.amount is None:
        return
    if body.currency != parent.currency:
        raise ParentDealError(f"The show's amount must be in {parent.currency}, like the deal")
    left = parent.amount - allotted(db, parent.id, without=show_id)
    if (body.fee_amount or Decimal(0)) > left:
        raise ParentDealError(
            f"Only {amount_text(max(left, Decimal(0)), parent.currency)} is left in "
            f"{parent.name} (of {amount_text(parent.amount, parent.currency)}). "
            "Keep the show's amount at that or less, or raise the deal amount first"
        )


def check_parent_update(db: Session, parent: ParentDeal, body: ParentDealIn) -> None:
    """The new parent values must still hold every show already under it."""
    shows = list(parent.shows)
    if not shows:
        return
    if body.deal_type != parent.deal_type:
        raise ParentDealError("The deal type cannot change once the deal has shows")
    if body.currency != parent.currency:
        raise ParentDealError("The currency cannot change once the deal has shows")
    first = min(s.term_start for s in shows)
    last = max(s.term_end for s in shows)
    if body.term_start > first or body.term_end < last:
        raise ParentDealError(
            f"The deal's term must still cover all its shows ({first:%d %b %Y} → {last:%d %b %Y})"
        )
    if body.amount is not None:
        held = allotted(db, parent.id)
        if body.amount < held:
            raise ParentDealError(
                f"The shows already hold {amount_text(held, body.currency)}; "
                "the deal amount cannot be less than that"
            )


def mirrors(parent: ParentDeal, show: ContentDeal) -> bool:
    """A parent made for this one show (e.g. every deal from before parent deals): it holds
    only this show and has the same name, amount and dates, so it follows the show's edits."""
    return (
        [s.id for s in parent.shows] == [show.id]
        and parent.name == show.title
        and parent.amount == (show.fee_amount if show.deal_type in PAYS_FEE else None)
        and parent.currency == (show.currency if show.deal_type in PAYS_FEE else None)
        and parent.deal_type == show.deal_type
        and (parent.term_start, parent.term_end) == (show.term_start, show.term_end)
    )


def follow_show(parent: ParentDeal, body: DealIn) -> None:
    """Copy a single show's edits to the parent that mirrors it."""
    fee = body.deal_type in PAYS_FEE
    parent.name = body.title
    parent.deal_type = body.deal_type
    parent.amount = body.fee_amount if fee else None
    parent.currency = body.currency if fee else None
    parent.term_start, parent.term_end = body.term_start, body.term_end


def parent_for_show(org_id: uuid.UUID, body: DealIn) -> ParentDeal:
    """A parent deal for a show saved without one: same owner, type, amount and dates."""
    return ParentDeal(
        organization_id=org_id,
        owner_id=body.owner_id,
        name=body.title,
        deal_type=body.deal_type,
        amount=body.fee_amount if body.deal_type in PAYS_FEE else None,
        currency=body.currency if body.deal_type in PAYS_FEE else None,
        term_start=body.term_start,
        term_end=body.term_end,
    )
