"""Who occupies which slot, and who manages which channel — with full history.

Assignments are never deleted or edited in place: changing hands closes the open row
(end_date) and opens a new one, so past revenue and incentives can always be attributed
to the channel/employee that held the slot at the time.
"""

import uuid
from collections.abc import Iterable
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Channel,
    ChannelManagerAssignment,
    ContentDeal,
    DealSlot,
    Employee,
    SlotAssignment,
)
from app.services.deals import effective_status

OCCUPIED_STATUSES = ("reserved", "pending_whitelist", "active")


class AssignmentError(Exception):
    """A rule was broken; the message is shown to the founder."""


def open_slot_assignment(db: Session, slot_id: uuid.UUID) -> SlotAssignment | None:
    return db.scalar(
        select(SlotAssignment).where(
            SlotAssignment.slot_id == slot_id, SlotAssignment.end_date.is_(None)
        )
    )


def open_slot_assignments(
    db: Session, slot_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, SlotAssignment]:
    ids = list(slot_ids)
    if not ids:
        return {}
    rows = db.scalars(
        select(SlotAssignment).where(
            SlotAssignment.slot_id.in_(ids), SlotAssignment.end_date.is_(None)
        )
    )
    return {a.slot_id: a for a in rows}


def open_managers(
    db: Session, channel_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, ChannelManagerAssignment]:
    ids = list(channel_ids)
    if not ids:
        return {}
    rows = db.scalars(
        select(ChannelManagerAssignment).where(
            ChannelManagerAssignment.channel_id.in_(ids),
            ChannelManagerAssignment.end_date.is_(None),
        )
    )
    return {m.channel_id: m for m in rows}


def _check_start(effective: date, previous_start: date | None, today: date) -> None:
    if effective > today:
        raise AssignmentError("The effective date cannot be in the future.")
    if previous_start and effective < previous_start:
        raise AssignmentError(
            "The effective date cannot be before the current holder started "
            f"({previous_start:%d %b %Y})."
        )


def _check_channel_for_slot(
    db: Session, deal: ContentDeal, slot: DealSlot, channel: Channel, today: date
) -> None:
    if channel.status != "active":
        raise AssignmentError(f"{channel.name} is inactive.")
    if channel.platform != slot.platform:
        raise AssignmentError(
            f"{slot.code} is a {slot.platform.title()} slot; "
            f"{channel.name} is a {channel.platform.title()} channel."
        )
    status = effective_status(deal, today)
    if status in ("expired", "terminated"):
        raise AssignmentError(f"The deal is {status}; its slots cannot take new channels.")
    clash = db.scalar(
        select(DealSlot)
        .join(SlotAssignment, SlotAssignment.slot_id == DealSlot.id)
        .where(
            DealSlot.deal_id == deal.id,
            SlotAssignment.channel_id == channel.id,
            SlotAssignment.end_date.is_(None),
        )
    )
    if clash:
        raise AssignmentError(f"{channel.name} already holds {clash.code} in this deal.")


def assign_channel(
    db: Session,
    deal: ContentDeal,
    slot: DealSlot,
    channel: Channel,
    *,
    status: str,
    effective: date,
    today: date,
    notes: str | None,
) -> SlotAssignment:
    if open_slot_assignment(db, slot.id):
        raise AssignmentError(f"{slot.code} already has a channel. Use Replace instead.")
    _check_start(effective, None, today)
    _check_channel_for_slot(db, deal, slot, channel, today)
    assignment = SlotAssignment(
        organization_id=deal.organization_id,
        slot_id=slot.id,
        channel_id=channel.id,
        start_date=effective,
        notes=notes,
    )
    db.add(assignment)
    slot.status = status
    return assignment


def replace_channel(
    db: Session,
    deal: ContentDeal,
    slot: DealSlot,
    channel: Channel,
    *,
    status: str,
    effective: date,
    today: date,
    notes: str | None,
) -> tuple[SlotAssignment, SlotAssignment]:
    current = open_slot_assignment(db, slot.id)
    if current is None:
        raise AssignmentError(f"{slot.code} has no channel to replace. Use Assign instead.")
    if current.channel_id == channel.id:
        raise AssignmentError(f"{channel.name} already holds {slot.code}.")
    _check_start(effective, current.start_date, today)
    _check_channel_for_slot(db, deal, slot, channel, today)
    # The old channel held the slot up to the day before the new one took over.
    current.end_date = max(current.start_date, effective - timedelta(days=1))
    current.end_reason = "replaced"
    db.flush()  # free the "one open assignment per slot" index before opening the next
    new = SlotAssignment(
        organization_id=deal.organization_id,
        slot_id=slot.id,
        channel_id=channel.id,
        start_date=effective,
        start_reason="replacement",
        notes=notes,
    )
    db.add(new)
    slot.status = status
    return current, new


def unassign_channel(
    db: Session, slot: DealSlot, *, effective: date, today: date, notes: str | None
) -> SlotAssignment:
    current = open_slot_assignment(db, slot.id)
    if current is None:
        raise AssignmentError(f"{slot.code} has no channel.")
    _check_start(effective, current.start_date, today)
    current.end_date = effective
    current.end_reason = "unassigned"
    if notes:
        current.notes = notes
    slot.status = "unassigned"
    return current


def check_slot_status_change(db: Session, slot: DealSlot, new_status: str) -> None:
    """Manual status edits must agree with whether a channel holds the slot."""
    has_channel = open_slot_assignment(db, slot.id) is not None
    if has_channel and new_status == "unassigned":
        raise AssignmentError(f"Unassign the channel from {slot.code} first.")
    if not has_channel and new_status in ("pending_whitelist", "active"):
        raise AssignmentError(f"Assign a channel to {slot.code} first.")


def set_manager(
    db: Session,
    channel: Channel,
    employee: Employee | None,
    *,
    effective: date,
    today: date,
) -> tuple[ChannelManagerAssignment | None, ChannelManagerAssignment | None]:
    """Hand a channel to a new manager (or to nobody). Returns (closed, opened)."""
    current = open_managers(db, [channel.id]).get(channel.id)
    if employee is not None and current and current.employee_id == employee.id:
        raise AssignmentError(f"{employee.full_name} already manages {channel.name}.")
    if employee is None and current is None:
        raise AssignmentError(f"{channel.name} has no manager.")
    if employee is not None and not employee.is_active:
        raise AssignmentError(f"{employee.full_name} is inactive.")
    if employee is not None and not employee.role.can_manage(channel.platform):
        kind = "YouTube channels" if channel.platform == "youtube" else "Facebook pages"
        raise AssignmentError(
            f"{employee.full_name}'s role ({employee.role.name}) cannot manage {kind}. "
            "Allow it under Settings → Roles, or pick someone else."
        )
    _check_start(effective, current.start_date if current else None, today)

    closed = None
    if current:
        current.end_date = (
            effective
            if employee is None
            else max(current.start_date, effective - timedelta(days=1))
        )
        closed = current
        db.flush()
    opened = None
    if employee is not None:
        opened = ChannelManagerAssignment(
            organization_id=channel.organization_id,
            channel_id=channel.id,
            employee_id=employee.id,
            start_date=effective,
        )
        db.add(opened)
    return closed, opened
