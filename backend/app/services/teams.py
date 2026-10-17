"""Roles and teams: who is in which team, who leads it — with history.

As with slot and manager assignments, nothing is edited in place: a change closes the
open row and opens a new one, so incentives can be attributed to the team lead of the
day (PDF slide 13) even after people move.
"""

import uuid
from collections.abc import Iterable
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Employee,
    EmployeeRole,
    Organization,
    Team,
    TeamLeadAssignment,
    TeamMembership,
)
from app.models.people import DEFAULT_ROLES
from app.services.assignments import AssignmentError


def seed_default_roles(db: Session, organization: Organization) -> None:
    """Give a new company the roles from the PDF roster; founders can change them later."""
    for name, youtube, facebook, lead in DEFAULT_ROLES:
        db.add(
            EmployeeRole(
                organization_id=organization.id,
                name=name,
                can_manage_youtube=youtube,
                can_manage_facebook=facebook,
                can_lead_team=lead,
            )
        )


def open_memberships(
    db: Session, employee_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, TeamMembership]:
    ids = list(employee_ids)
    if not ids:
        return {}
    rows = db.scalars(
        select(TeamMembership).where(
            TeamMembership.employee_id.in_(ids), TeamMembership.end_date.is_(None)
        )
    )
    return {m.employee_id: m for m in rows}


def open_leads(db: Session, team_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, TeamLeadAssignment]:
    ids = list(team_ids)
    if not ids:
        return {}
    rows = db.scalars(
        select(TeamLeadAssignment).where(
            TeamLeadAssignment.team_id.in_(ids), TeamLeadAssignment.end_date.is_(None)
        )
    )
    return {a.team_id: a for a in rows}


def team_leads_for(db: Session, employee_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Employee]:
    """Current team lead of each person (nobody leads themselves)."""
    memberships = open_memberships(db, employee_ids)
    leads = open_leads(db, {m.team_id for m in memberships.values()})
    out = {}
    for employee_id, m in memberships.items():
        lead = leads.get(m.team_id)
        if lead and lead.employee_id != employee_id:
            out[employee_id] = lead.employee
    return out


def _check_date(effective: date, previous_start: date | None, today: date) -> None:
    if effective > today:
        raise AssignmentError("The effective date cannot be in the future.")
    if previous_start and effective < previous_start:
        raise AssignmentError(
            "The effective date cannot be before the current one started "
            f"({previous_start:%d %b %Y})."
        )


def set_team(
    db: Session, employee: Employee, team: Team | None, *, effective: date, today: date
) -> bool:
    """Move a person to a team (or out of all teams). Returns False if nothing changed."""
    current = open_memberships(db, [employee.id]).get(employee.id)
    if (current.team_id if current else None) == (team.id if team else None):
        return False
    if team is not None and not team.is_active:
        raise AssignmentError(f"{team.name} is inactive.")
    _check_date(effective, current.start_date if current else None, today)
    if current:
        current.end_date = (
            effective if team is None else max(current.start_date, effective - timedelta(days=1))
        )
        db.flush()
    if team is not None:
        db.add(
            TeamMembership(
                organization_id=employee.organization_id,
                employee_id=employee.id,
                team_id=team.id,
                start_date=effective,
            )
        )
    return True


def set_team_lead(
    db: Session, team: Team, employee: Employee | None, *, effective: date, today: date
) -> TeamLeadAssignment | None:
    """Hand a team to a new lead (or leave it without one). Returns the closed row."""
    current = open_leads(db, [team.id]).get(team.id)
    if employee is not None:
        if current and current.employee_id == employee.id:
            raise AssignmentError(f"{employee.full_name} already leads {team.name}.")
        if not employee.is_active:
            raise AssignmentError(f"{employee.full_name} is inactive.")
        if not employee.role.can_lead_team:
            raise AssignmentError(
                f"{employee.full_name}'s role ({employee.role.name}) cannot lead a team. "
                "Allow it under Settings → Roles, or pick someone else."
            )
    elif current is None:
        raise AssignmentError(f"{team.name} has no lead.")
    _check_date(effective, current.start_date if current else None, today)
    if current:
        current.end_date = (
            effective
            if employee is None
            else max(current.start_date, effective - timedelta(days=1))
        )
        db.flush()
    if employee is not None:
        db.add(
            TeamLeadAssignment(
                organization_id=team.organization_id,
                team_id=team.id,
                employee_id=employee.id,
                start_date=effective,
            )
        )
    return current
