import uuid

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Auth, AuthContext, client_ip
from app.core.database import DbSession
from app.models import Channel, ChannelManagerAssignment, Employee, EmployeeRole, TeamLeadAssignment
from app.schemas.people import RoleIn, RoleOut
from app.services.audit import record_audit

# Founder-defined job roles. Few per company: returned whole.
router = APIRouter(prefix="/employee-roles", tags=["people"])

TRACKED = ("name", "can_manage_youtube", "can_manage_facebook", "can_lead_team")


def _counts(db: Session, organization_id: uuid.UUID) -> dict[uuid.UUID, int]:
    return dict(
        db.execute(
            select(Employee.role_id, func.count())
            .where(Employee.organization_id == organization_id)
            .group_by(Employee.role_id)
        ).all()
    )


def _out(role: EmployeeRole, count: int) -> RoleOut:
    return RoleOut(
        id=role.id,
        name=role.name,
        can_manage_youtube=role.can_manage_youtube,
        can_manage_facebook=role.can_manage_facebook,
        can_lead_team=role.can_lead_team,
        people_count=count,
    )


def _get(db: Session, ctx: AuthContext, role_id: uuid.UUID) -> EmployeeRole:
    role = db.scalar(
        select(EmployeeRole).where(
            EmployeeRole.id == role_id, EmployeeRole.organization_id == ctx.organization.id
        )
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    return role


def _unique(db: Session, ctx: AuthContext, name: str, exclude: uuid.UUID | None = None) -> None:
    stmt = select(EmployeeRole.id).where(
        EmployeeRole.organization_id == ctx.organization.id,
        func.lower(EmployeeRole.name) == name.lower(),
    )
    if exclude:
        stmt = stmt.where(EmployeeRole.id != exclude)
    if db.scalar(stmt):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A role named '{name}' exists")


def _check_permissions_still_hold(db: Session, role: EmployeeRole, body: RoleIn) -> None:
    """Refuse to take away a permission that people with this role are using right now."""
    for platform, flag in (("youtube", "can_manage_youtube"), ("facebook", "can_manage_facebook")):
        if getattr(role, flag) and not getattr(body, flag):
            using = db.scalars(
                select(Employee.full_name)
                .join(ChannelManagerAssignment, ChannelManagerAssignment.employee_id == Employee.id)
                .join(Channel, Channel.id == ChannelManagerAssignment.channel_id)
                .where(
                    Employee.role_id == role.id,
                    ChannelManagerAssignment.end_date.is_(None),
                    Channel.platform == platform,
                )
                .distinct()
            ).all()
            if using:
                kind = "YouTube channels" if platform == "youtube" else "Facebook pages"
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"{', '.join(using)} manage {kind} with this role. Reassign those first.",
                )
    if role.can_lead_team and not body.can_lead_team:
        leading = db.scalars(
            select(Employee.full_name)
            .join(TeamLeadAssignment, TeamLeadAssignment.employee_id == Employee.id)
            .where(Employee.role_id == role.id, TeamLeadAssignment.end_date.is_(None))
            .distinct()
        ).all()
        if leading:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{', '.join(leading)} lead a team with this role. Hand those teams over first.",
            )


@router.get("")
def list_roles(ctx: Auth, db: DbSession) -> list[RoleOut]:
    counts = _counts(db, ctx.organization.id)
    rows = db.scalars(
        select(EmployeeRole)
        .where(EmployeeRole.organization_id == ctx.organization.id)
        .order_by(EmployeeRole.name)
    )
    return [_out(r, counts.get(r.id, 0)) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_role(body: RoleIn, ctx: Auth, request: Request, db: DbSession) -> RoleOut:
    _unique(db, ctx, body.name)
    role = EmployeeRole(organization_id=ctx.organization.id, **body.model_dump())
    db.add(role)
    db.flush()
    record_audit(
        db,
        "role.created",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="employee_role",
        entity_id=role.id,
        details={"name": role.name},
        ip=client_ip(request),
    )
    db.commit()
    return _out(role, 0)


@router.put("/{role_id}")
def update_role(
    role_id: uuid.UUID, body: RoleIn, ctx: Auth, request: Request, db: DbSession
) -> RoleOut:
    role = _get(db, ctx, role_id)
    _unique(db, ctx, body.name, exclude=role.id)
    _check_permissions_still_hold(db, role, body)
    new = body.model_dump()
    changes = {f: [getattr(role, f), new[f]] for f in TRACKED if getattr(role, f) != new[f]}
    for f in TRACKED:
        setattr(role, f, new[f])
    if changes:
        record_audit(
            db,
            "role.updated",
            organization_id=ctx.organization.id,
            user_id=ctx.user.id,
            entity_type="employee_role",
            entity_id=role.id,
            details={"name": role.name, "changes": changes},
            ip=client_ip(request),
        )
    db.commit()
    return _out(role, _counts(db, ctx.organization.id).get(role.id, 0))


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(role_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    role = _get(db, ctx, role_id)
    count = _counts(db, ctx.organization.id).get(role.id, 0)
    if count:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{count} person(s) have the role {role.name}. Give them another role first.",
        )
    record_audit(
        db,
        "role.deleted",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="employee_role",
        entity_id=role.id,
        details={"name": role.name},
        ip=client_ip(request),
    )
    db.delete(role)
    db.commit()
