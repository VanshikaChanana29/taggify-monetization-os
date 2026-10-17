import uuid

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Auth, AuthContext, client_ip
from app.core.database import DbSession
from app.models import ChannelManagerAssignment, Employee, Team, TeamLeadAssignment, TeamMembership
from app.schemas.channels import PersonRef
from app.schemas.people import TeamDetail, TeamHistoryItem, TeamIn, TeamLeadIn, TeamOut
from app.services.assignments import AssignmentError
from app.services.audit import record_audit
from app.services.deals import company_today
from app.services.teams import open_leads, set_team_lead

# Founder-defined teams. Few per company: returned whole.
router = APIRouter(prefix="/teams", tags=["people"])


def _get(db: Session, ctx: AuthContext, team_id: uuid.UUID) -> Team:
    team = db.scalar(
        select(Team).where(Team.id == team_id, Team.organization_id == ctx.organization.id)
    )
    if team is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")
    return team


def _employee(db: Session, ctx: AuthContext, employee_id: uuid.UUID) -> Employee:
    employee = db.scalar(
        select(Employee).where(
            Employee.id == employee_id, Employee.organization_id == ctx.organization.id
        )
    )
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    return employee


def _outs(db: Session, teams: list[Team]) -> list[TeamOut]:
    ids = [t.id for t in teams]
    members = (
        dict(
            db.execute(
                select(TeamMembership.team_id, func.count())
                .where(TeamMembership.team_id.in_(ids), TeamMembership.end_date.is_(None))
                .group_by(TeamMembership.team_id)
            ).all()
        )
        if ids
        else {}
    )
    channels = (
        dict(
            db.execute(
                select(TeamMembership.team_id, func.count(ChannelManagerAssignment.id))
                .join(
                    ChannelManagerAssignment,
                    ChannelManagerAssignment.employee_id == TeamMembership.employee_id,
                )
                .where(
                    TeamMembership.team_id.in_(ids),
                    TeamMembership.end_date.is_(None),
                    ChannelManagerAssignment.end_date.is_(None),
                )
                .group_by(TeamMembership.team_id)
            ).all()
        )
        if ids
        else {}
    )
    leads = open_leads(db, ids)
    out = []
    for t in teams:
        lead = leads.get(t.id)
        out.append(
            TeamOut(
                id=t.id,
                name=t.name,
                description=t.description,
                is_active=t.is_active,
                lead=PersonRef(id=lead.employee.id, name=lead.employee.full_name) if lead else None,
                lead_since=lead.start_date if lead else None,
                member_count=members.get(t.id, 0),
                channel_count=channels.get(t.id, 0),
                created_at=t.created_at,
            )
        )
    return out


def _unique(db: Session, ctx: AuthContext, name: str, exclude: uuid.UUID | None = None) -> None:
    stmt = select(Team.id).where(
        Team.organization_id == ctx.organization.id, func.lower(Team.name) == name.lower()
    )
    if exclude:
        stmt = stmt.where(Team.id != exclude)
    if db.scalar(stmt):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A team named '{name}' exists")


@router.get("")
def list_teams(ctx: Auth, db: DbSession) -> list[TeamOut]:
    teams = db.scalars(
        select(Team).where(Team.organization_id == ctx.organization.id).order_by(Team.name)
    ).all()
    return _outs(db, list(teams))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_team(body: TeamIn, ctx: Auth, request: Request, db: DbSession) -> TeamOut:
    _unique(db, ctx, body.name)
    team = Team(
        organization_id=ctx.organization.id,
        name=body.name,
        description=body.description,
        is_active=body.is_active,
    )
    db.add(team)
    db.flush()
    if body.lead_id:
        today = company_today(ctx.organization)
        try:
            set_team_lead(db, team, _employee(db, ctx, body.lead_id), effective=today, today=today)
        except AssignmentError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    record_audit(
        db,
        "team.created",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="team",
        entity_id=team.id,
        details={"name": team.name},
        ip=client_ip(request),
    )
    db.commit()
    db.expire_all()
    return _outs(db, [_get(db, ctx, team.id)])[0]


@router.put("/{team_id}")
def update_team(
    team_id: uuid.UUID, body: TeamIn, ctx: Auth, request: Request, db: DbSession
) -> TeamOut:
    team = _get(db, ctx, team_id)
    _unique(db, ctx, body.name, exclude=team.id)
    if team.is_active and not body.is_active:
        members = _outs(db, [team])[0].member_count
        if members:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{team.name} still has {members} member(s). Move them first.",
            )
    changes = {
        f: [getattr(team, f), getattr(body, f)]
        for f in ("name", "description", "is_active")
        if getattr(team, f) != getattr(body, f)
    }
    team.name, team.description, team.is_active = body.name, body.description, body.is_active
    if changes:
        record_audit(
            db,
            "team.updated",
            organization_id=ctx.organization.id,
            user_id=ctx.user.id,
            entity_type="team",
            entity_id=team.id,
            details={"name": team.name, "changes": changes},
            ip=client_ip(request),
        )
    db.commit()
    return _outs(db, [team])[0]


@router.post("/{team_id}/lead")
def change_lead(
    team_id: uuid.UUID, body: TeamLeadIn, ctx: Auth, request: Request, db: DbSession
) -> TeamOut:
    team = _get(db, ctx, team_id)
    employee = _employee(db, ctx, body.employee_id) if body.employee_id else None
    today = company_today(ctx.organization)
    effective = body.effective_date or today
    try:
        closed = set_team_lead(db, team, employee, effective=effective, today=today)
    except AssignmentError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    record_audit(
        db,
        "team.lead_changed",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="team",
        entity_id=team.id,
        details={
            "name": team.name,
            "changes": {
                "lead": [
                    closed.employee.full_name if closed else None,
                    employee.full_name if employee else None,
                ]
            },
            "effective_date": str(effective),
        },
        ip=client_ip(request),
    )
    db.commit()
    db.expire_all()
    return _outs(db, [_get(db, ctx, team.id)])[0]


@router.get("/{team_id}")
def team_detail(team_id: uuid.UUID, ctx: Auth, db: DbSession) -> TeamDetail:
    team = _get(db, ctx, team_id)
    memberships = db.scalars(
        select(TeamMembership)
        .where(TeamMembership.team_id == team.id)
        .order_by(TeamMembership.start_date.desc(), TeamMembership.created_at.desc())
    ).all()
    leads = db.scalars(
        select(TeamLeadAssignment)
        .where(TeamLeadAssignment.team_id == team.id)
        .order_by(TeamLeadAssignment.start_date.desc(), TeamLeadAssignment.created_at.desc())
    ).all()

    def item(row: TeamMembership | TeamLeadAssignment) -> TeamHistoryItem:
        return TeamHistoryItem(
            id=row.id,
            person=PersonRef(id=row.employee.id, name=row.employee.full_name),
            start_date=row.start_date,
            end_date=row.end_date,
        )

    return TeamDetail(
        **_outs(db, [team])[0].model_dump(),
        members=sorted(
            (
                PersonRef(id=m.employee.id, name=m.employee.full_name)
                for m in memberships
                if m.end_date is None
            ),
            key=lambda p: p.name,
        ),
        lead_history=[item(a) for a in leads],
        member_history=[item(m) for m in memberships],
    )
