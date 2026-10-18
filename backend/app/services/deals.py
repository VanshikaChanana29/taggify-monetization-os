"""Deal rules: derived status, slot generation, and the rights check."""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.models import ContentDeal, DealSlot, Organization
from app.models.content import PLATFORMS

EXPIRING_SOON_DAYS = 90


def company_today(org: Organization) -> date:
    """Licence terms are calendar days in the company's timezone."""
    return datetime.now(ZoneInfo(org.timezone)).date()


def effective_status(deal: ContentDeal, today: date) -> str:
    """draft / upcoming / active / expired / terminated."""
    if deal.status != "active":
        return deal.status
    if today < deal.term_start:
        return "upcoming"
    if today > deal.term_end:
        return "expired"
    return "active"


def notice_deadline(deal: ContentDeal) -> date | None:
    """Last day to give renewal/termination notice: term end minus the notice period."""
    if deal.notice_period_days is None:
        return None
    return deal.term_end - timedelta(days=deal.notice_period_days)


def slot_limit(deal: ContentDeal, platform: str) -> int:
    return deal.yt_slot_limit if platform == "youtube" else deal.fb_slot_limit


class SlotInUseError(Exception):
    def __init__(self, codes: list[str]):
        self.codes = codes
        super().__init__(f"Cannot reduce slots: {', '.join(codes)} are in use. Free them first.")


def sync_slots(deal: ContentDeal) -> None:
    """Make the deal have exactly slots 1..limit per platform.

    New slots are added as unassigned. Slots above a lowered limit are removed only if
    they are unassigned; otherwise nothing changes and SlotInUseError is raised.
    """
    to_remove: list[DealSlot] = []
    in_use: list[DealSlot] = []
    for platform in PLATFORMS:
        limit = slot_limit(deal, platform)
        for slot in deal.slots:
            if slot.platform == platform and slot.number > limit:
                (to_remove if slot.status == "unassigned" else in_use).append(slot)
    if in_use:
        raise SlotInUseError(sorted(s.code for s in in_use))

    for slot in to_remove:
        deal.slots.remove(slot)
    for platform in PLATFORMS:
        have = {s.number for s in deal.slots if s.platform == platform}
        for number in range(1, slot_limit(deal, platform) + 1):
            if number not in have:
                deal.slots.append(
                    DealSlot(organization_id=deal.organization_id, platform=platform, number=number)
                )


@dataclass
class RightsResult:
    allowed: bool
    reasons: list[str] = field(default_factory=list)


PLATFORM_NAMES = {"youtube": "YouTube", "facebook": "Facebook"}


def check_rights(
    deal: ContentDeal,
    *,
    platform: str,
    on_date: date,
    episode: int | None = None,
    season: int | None = None,
    territory: str | None = None,
) -> RightsResult:
    """Can this content go on this platform, on this date, in this territory?

    Every failing rule is listed, so the founder sees all reasons at once.
    """
    reasons: list[str] = []

    if deal.status == "draft":
        reasons.append("The deal is still a draft.")
    elif deal.status == "terminated":
        reasons.append("The deal has been terminated.")

    if on_date < deal.term_start:
        reasons.append(f"The licence starts on {deal.term_start:%d %b %Y}.")
    elif on_date > deal.term_end:
        reasons.append(f"The licence ended on {deal.term_end:%d %b %Y}.")

    if slot_limit(deal, platform) == 0:
        reasons.append(f"The deal has no {PLATFORM_NAMES[platform]} slots.")

    if deal.episode_scope != "all":
        if episode is None:
            reasons.append("Enter an episode number; this deal licenses specific episodes.")
        elif deal.episode_scope == "seasons" and season is None:
            reasons.append("Enter a season; this deal licenses episodes by season.")
        else:
            covered = any(
                r.from_episode <= episode <= r.to_episode
                and (deal.episode_scope == "ranges" or r.season == season)
                for r in deal.episode_ranges
            )
            if not covered:
                label = f"S{season} E{episode}" if deal.episode_scope == "seasons" else str(episode)
                reasons.append(f"Episode {label} is outside the licensed episodes.")

    if not deal.is_worldwide:
        if not territory:
            reasons.append("Enter a territory; this deal is limited to specific countries.")
        elif territory.upper() not in deal.territories:
            reasons.append(f"{territory.upper()} is not a licensed territory.")

    return RightsResult(allowed=not reasons, reasons=reasons)
