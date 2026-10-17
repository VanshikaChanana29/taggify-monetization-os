"""CMS commission maths (PDF slide 9).

Example (slide 9): tiers 0 → 20 %, 20 000 → 15 %, whole-revenue, gross 25 000
    → the 15 % tier is reached, fee = 25 000 × 15 % = 3 750, net due = 21 250.
The same tiers as marginal bands would charge 20 % on the first 20 000 and 15 % on the
remaining 5 000 = 4 750.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CmsFeeSchedule

CENT = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _tiers(schedule: CmsFeeSchedule) -> list[tuple[Decimal, Decimal]]:
    return sorted((Decimal(t["from_amount"]), Decimal(t["rate_pct"])) for t in schedule.tiers)


def compute_fee(gross: Decimal, tier_type: str, tiers: list[tuple[Decimal, Decimal]]) -> Decimal:
    if gross <= 0 or not tiers:
        return Decimal("0.00")
    if tier_type == "whole":
        rate = Decimal(0)
        for start, tier_rate in tiers:
            if gross >= start:
                rate = tier_rate
        return money(gross * rate / 100)
    fee = Decimal(0)
    for i, (start, rate) in enumerate(tiers):
        end = tiers[i + 1][0] if i + 1 < len(tiers) else None
        band = (min(gross, end) if end is not None else gross) - start
        if band > 0:
            fee += band * rate / 100
    return money(fee)


def fee_for(gross: Decimal, schedule: CmsFeeSchedule) -> Decimal:
    return compute_fee(gross, schedule.tier_type, _tiers(schedule))


def schedule_for(db: Session, cms_partner_id, month: date) -> CmsFeeSchedule | None:
    """The schedule in force on the first day of the month."""
    return db.scalar(
        select(CmsFeeSchedule)
        .where(
            CmsFeeSchedule.cms_partner_id == cms_partner_id,
            CmsFeeSchedule.effective_from <= month,
        )
        .order_by(CmsFeeSchedule.effective_from.desc())
        .limit(1)
    )


def allocate(total: Decimal, weights: dict) -> dict:
    """Split `total` in proportion to weights; the rounding remainder goes to the largest."""
    weight_sum = sum(weights.values())
    if not weights or weight_sum == 0:
        return {k: Decimal("0.00") for k in weights}
    shares = {k: money(total * w / weight_sum) for k, w in weights.items()}
    remainder = total - sum(shares.values())
    if remainder:
        biggest = max(weights, key=lambda k: weights[k])
        shares[biggest] += remainder
    return shares
