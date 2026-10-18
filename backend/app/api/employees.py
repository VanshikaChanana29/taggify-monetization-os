import uuid
from collections import defaultdict
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Auth, AuthContext, client_ip
from app.core.database import DbSession
from app.models import (
    Channel,
    ChannelManagerAssignment,
    ContentDeal,
    DealSlot,
    Employee,
    EmployeeRole,
    IncentiveRate,
    Organization,
    SlotAssignment,
    Team,
    TeamLeadAssignment,
    TeamMembership,
)
from app.schemas.channels import ManagerHistoryItem, PersonRef
from app.schemas.people import (
    EmployeeDetail,
    EmployeeIn,
    EmployeeOut,
    ManagedChannel,
    RoleRef,
    TeamMembershipItem,
    TeamRef,
)
from app.services.assignments import AssignmentError
from app.services.audit import record_audit
from app.services.deals import company_today
from app.services.month_close import MonthClosedError, ensure_open
from app.services.teams import open_memberships, set_team, team_leads_for

# A company's roster is a few dozen people: returned whole and filtered in the browser.
router = APIRouter(prefix="/employees", tags=["people"])

TRACKED = (
    "full_name",
    "role_id",
    "email",
    "phone",
    "join_date",
    "monthly_salary",
    "salary_currency",
    "is_active",
    "notes",
)


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if value is None or isinstance(value, bool | str | int):
        return value
    return str(value)


def _get(db: Session, ctx: AuthContext, employee_id: uuid.UUID) -> Employee:
    employee = db.scalar(
        select(Employee).where(
            Employee.id == employee_id, Employee.organization_id == ctx.organization.id
        )
    )
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    return employee


def _channel_names(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    names: dict[uuid.UUID, list[str]] = defaultdict(list)
    for employee_id, name in db.execute(
        select(ChannelManagerAssignment.employee_id, Channel.name)
        .join(Channel, Channel.id == ChannelManagerAssignment.channel_id)
        .where(
            ChannelManagerAssignment.employee_id.in_(ids),
            ChannelManagerAssignment.end_date.is_(None),
        )
        .order_by(Channel.name)
    ):
        names[employee_id].append(name)
    return names


def _current_rates(db: Session, ids: list[uuid.UUID]) -> dict[tuple[uuid.UUID, str], Decimal]:
    """The rate in force today for each (person, kind): the latest that has started."""
    org = db.get(Organization, db.get(Employee, ids[0]).organization_id)
    today = company_today(org)
    rates: dict[tuple[uuid.UUID, str], Decimal] = {}
    for r in db.scalars(
        select(IncentiveRate)
        .where(IncentiveRate.employee_id.in_(ids), IncentiveRate.effective_from <= today)
        .order_by(IncentiveRate.effective_from.desc())
    ):
        rates.setdefault((r.employee_id, r.kind), r.rate_pct)
    return rates


def _outs(db: Session, people: list[Employee]) -> list[EmployeeOut]:
    ids = [p.id for p in people]
    channels = _channel_names(db, ids) if ids else {}
    rates = _current_rates(db, ids) if ids else {}
    memberships = open_memberships(db, ids)
    leads = team_leads_for(db, ids)
    led: dict[uuid.UUID, list[TeamRef]] = defaultdict(list)
    if ids:
        for a in db.scalars(
            select(TeamLeadAssignment).where(
                TeamLeadAssignment.employee_id.in_(ids), TeamLeadAssignment.end_date.is_(None)
            )
        ):
            led[a.employee_id].append(TeamRef(id=a.team.id, name=a.team.name))
    out = []
    for e in people:
        m = memberships.get(e.id)
        lead = leads.get(e.id)
        out.append(
            EmployeeOut(
                id=e.id,
                full_name=e.full_name,
                role=RoleRef(
                    id=e.role.id,
                    name=e.role.name,
                    can_manage_youtube=e.role.can_manage_youtube,
                    can_manage_facebook=e.role.can_manage_facebook,
                    can_lead_team=e.role.can_lead_team,
                ),
                team=TeamRef(id=m.team.id, name=m.team.name) if m else None,
                team_lead=PersonRef(id=lead.id, name=lead.full_name) if lead else None,
                leads_teams=sorted(led.get(e.id, []), key=lambda t: t.name),
                email=e.email,
                phone=e.phone,
                join_date=e.join_date,
                monthly_salary=e.monthly_salary,
                salary_currency=e.salary_currency,
                is_active=e.is_active,
                notes=e.notes,
                channel_count=len(channels.get(e.id, [])),
                channel_names=channels.get(e.id, []),
                manager_rate=rates.get((e.id, "manager")),
                team_lead_rate=rates.get((e.id, "team_lead")),
                created_at=e.created_at,
            )
        )
    return out


def _role(db: Session, ctx: AuthContext, role_id: uuid.UUID) -> EmployeeRole:
    role = db.scalar(
        select(EmployeeRole).where(
            EmployeeRole.id == role_id, EmployeeRole.organization_id == ctx.organization.id
        )
    )
    if role is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Role not found")
    return role


def _team(db: Session, ctx: AuthContext, team_id: uuid.UUID | None) -> Team | None:
    if team_id is None:
        return None
    team = db.scalar(
        select(Team).where(Team.id == team_id, Team.organization_id == ctx.organization.id)
    )
    if team is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Team not found")
    return team


def _check_current_duties(
    db: Session, employee: Employee, role: EmployeeRole, active: bool
) -> None:
    """A role change or deactivation must not orphan channels or teams this person runs."""
    managed = db.scalars(
        select(Channel)
        .join(ChannelManagerAssignment, ChannelManagerAssignment.channel_id == Channel.id)
        .where(
            ChannelManagerAssignment.employee_id == employee.id,
            ChannelManagerAssignment.end_date.is_(None),
        )
    ).all()
    led = db.scalars(
        select(Team)
        .join(TeamLeadAssignment, TeamLeadAssignment.team_id == Team.id)
        .where(TeamLeadAssignment.employee_id == employee.id, TeamLeadAssignment.end_date.is_(None))
    ).all()
    led_names = ", ".join(t.name for t in led)
    if not active:
        if managed:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{employee.full_name} still manages {len(managed)} channel(s). "
                "Reassign them first.",
            )
        if led:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{employee.full_name} leads {led_names}. Hand the team over first.",
            )
        return
    blocked = [c.name for c in managed if not role.can_manage(c.platform)]
    if blocked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"The role {role.name} cannot manage {', '.join(blocked)}. "
            "Reassign those channels first.",
        )
    if led and not role.can_lead_team:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"The role {role.name} cannot lead a team, and {employee.full_name} leads "
            f"{led_names}. Hand the team over first.",
        )


@router.get("")
def list_employees(ctx: Auth, db: DbSession) -> list[EmployeeOut]:
    rows = db.scalars(
        select(Employee)
        .where(Employee.organization_id == ctx.organization.id)
        .order_by(Employee.full_name)
    ).all()
    return _outs(db, list(rows))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_employee(body: EmployeeIn, ctx: Auth, request: Request, db: DbSession) -> EmployeeOut:
    _role(db, ctx, body.role_id)
    team = _team(db, ctx, body.team_id)
    employee = Employee(
        organization_id=ctx.organization.id,
        **body.model_dump(exclude={"team_id", "team_effective_date"}),
    )
    db.add(employee)
    db.flush()
    if team:
        today = company_today(ctx.organization)
        try:
            set_team(db, employee, team, effective=body.team_effective_date or today, today=today)
        except AssignmentError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    record_audit(
        db,
        "employee.created",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="employee",
        entity_id=employee.id,
        details={"name": employee.full_name, "team": team.name if team else None},
        ip=client_ip(request),
    )
    db.commit()
    db.expire_all()
    return _outs(db, [_get(db, ctx, employee.id)])[0]


@router.put("/{employee_id}")
def update_employee(
    employee_id: uuid.UUID, body: EmployeeIn, ctx: Auth, request: Request, db: DbSession
) -> EmployeeOut:
    employee = _get(db, ctx, employee_id)
    role = _role(db, ctx, body.role_id)
    team = _team(db, ctx, body.team_id)
    _check_current_duties(db, employee, role, body.is_active)

    new = body.model_dump(exclude={"team_id", "team_effective_date"})
    changes = {
        f: [_jsonable(getattr(employee, f)), _jsonable(new[f])]
        for f in TRACKED
        if _jsonable(getattr(employee, f)) != _jsonable(new[f])
    }
    if "role_id" in changes:
        changes["role"] = [employee.role.name, role.name]
        del changes["role_id"]
    old_team = open_memberships(db, [employee.id]).get(employee.id)
    old_team_name = old_team.team.name if old_team else None
    for f in TRACKED:
        setattr(employee, f, new[f])

    today = company_today(ctx.organization)
    target = team if body.is_active else None  # a deactivated person leaves their team
    current_team = old_team.team_id if old_team else None
    if current_team != (target.id if target else None):
        try:
            ensure_open(db, ctx.organization, body.team_effective_date or today, "This team change")
        except MonthClosedError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    try:
        moved = set_team(
            db, employee, target, effective=body.team_effective_date or today, today=today
        )
    except AssignmentError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    if moved:
        changes["team"] = [old_team_name, target.name if target else None]

    if changes:
        record_audit(
            db,
            "employee.updated",
            organization_id=ctx.organization.id,
            user_id=ctx.user.id,
            entity_type="employee",
            entity_id=employee.id,
            details={"name": employee.full_name, "changes": changes},
            ip=client_ip(request),
        )
    db.commit()
    db.expire_all()
    return _outs(db, [_get(db, ctx, employee_id)])[0]


@router.get("/{employee_id}")
def employee_detail(employee_id: uuid.UUID, ctx: Auth, db: DbSession) -> EmployeeDetail:
    employee = _get(db, ctx, employee_id)
    history = db.scalars(
        select(ChannelManagerAssignment)
        .where(ChannelManagerAssignment.employee_id == employee.id)
        .order_by(
            ChannelManagerAssignment.start_date.desc(), ChannelManagerAssignment.created_at.desc()
        )
    ).all()
    current = [m for m in history if m.end_date is None]

    deals: dict[uuid.UUID, list[str]] = defaultdict(list)
    if current:
        rows = db.execute(
            select(SlotAssignment.channel_id, ContentDeal.title, DealSlot.number, DealSlot.platform)
            .join(DealSlot, DealSlot.id == SlotAssignment.slot_id)
            .join(ContentDeal, ContentDeal.id == DealSlot.deal_id)
            .where(
                SlotAssignment.channel_id.in_([m.channel_id for m in current]),
                SlotAssignment.end_date.is_(None),
            )
        ).all()
        for channel_id, title, number, platform in rows:
            prefix = "YT" if platform == "youtube" else "FB"
            deals[channel_id].append(f"{title} · {prefix}-{number:02d}")

    led_team_ids = [
        a.team_id
        for a in db.scalars(
            select(TeamLeadAssignment).where(
                TeamLeadAssignment.employee_id == employee.id,
                TeamLeadAssignment.end_date.is_(None),
            )
        )
    ]
    members = (
        db.scalars(
            select(TeamMembership).where(
                TeamMembership.team_id.in_(led_team_ids),
                TeamMembership.end_date.is_(None),
                TeamMembership.employee_id != employee.id,
            )
        ).all()
        if led_team_ids
        else []
    )
    team_history = db.scalars(
        select(TeamMembership)
        .where(TeamMembership.employee_id == employee.id)
        .order_by(TeamMembership.start_date.desc(), TeamMembership.created_at.desc())
    ).all()

    return EmployeeDetail(
        **_outs(db, [employee])[0].model_dump(),
        channels=[
            ManagedChannel(
                channel_id=m.channel_id,
                channel_name=m.channel.name,
                platform=m.channel.platform,  # type: ignore[arg-type]
                since=m.start_date,
                deals=deals.get(m.channel_id, []),
            )
            for m in current
        ],
        team_members=sorted(
            (PersonRef(id=m.employee.id, name=m.employee.full_name) for m in members),
            key=lambda p: p.name,
        ),
        history=[
            ManagerHistoryItem(
                id=m.id,
                channel_id=m.channel_id,
                channel_name=m.channel.name,
                employee=PersonRef(id=employee.id, name=employee.full_name),
                start_date=m.start_date,
                end_date=m.end_date,
            )
            for m in history
        ],
        team_history=[
            TeamMembershipItem(
                id=m.id,
                team=TeamRef(id=m.team.id, name=m.team.name),
                start_date=m.start_date,
                end_date=m.end_date,
            )
            for m in team_history
        ],
    )
