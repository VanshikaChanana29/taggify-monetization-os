"""Super admin: create companies and manage which founders can log in to which company."""

import uuid

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import SuperAdmin, client_ip
from app.core.database import DbSession
from app.core.security import hash_password
from app.models import Membership, Organization, User
from app.schemas.admin import (
    AddMembershipRequest,
    AdminCreateUserRequest,
    AdminMembershipOut,
    AdminOrganizationOut,
    AdminUserOut,
    CreateOrganizationRequest,
    ResetPasswordRequest,
)
from app.services.audit import record_audit
from app.services.auth import normalize_email, revoke_sessions

router = APIRouter(prefix="/admin", tags=["admin"])


def _user_out(user: User) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_superadmin=user.is_superadmin,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        memberships=sorted(
            (
                AdminMembershipOut(
                    organization_id=m.organization_id,
                    organization_name=m.organization.name,
                    is_active=m.is_active,
                )
                for m in user.memberships
            ),
            key=lambda m: m.organization_name,
        ),
    )


def _get_user(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


def _get_org(db: Session, organization_id: uuid.UUID) -> Organization:
    org = db.get(Organization, organization_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    return org


def _get_membership(db: Session, user_id: uuid.UUID, organization_id: uuid.UUID) -> Membership:
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == user_id, Membership.organization_id == organization_id
        )
    )
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User is not a member of that company")
    return membership


# ---- Companies ------------------------------------------------------------------------


@router.get("/organizations")
def list_organizations(ctx: SuperAdmin, db: DbSession) -> list[AdminOrganizationOut]:
    active_users = dict(
        db.execute(
            select(Membership.organization_id, func.count())
            .where(Membership.is_active.is_(True))
            .group_by(Membership.organization_id)
        ).all()
    )
    return [
        AdminOrganizationOut(
            id=org.id,
            name=org.name,
            slug=org.slug,
            base_currency=org.base_currency,
            active_users=active_users.get(org.id, 0),
            created_at=org.created_at,
        )
        for org in db.scalars(select(Organization).order_by(Organization.name))
    ]


@router.post("/organizations", status_code=status.HTTP_201_CREATED)
def create_organization(
    body: CreateOrganizationRequest, ctx: SuperAdmin, request: Request, db: DbSession
) -> AdminOrganizationOut:
    if db.scalar(select(Organization).where(Organization.slug == body.slug)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Company '{body.slug}' already exists")

    org = Organization(name=body.name.strip(), slug=body.slug, base_currency=body.base_currency)
    db.add(org)
    db.flush()
    record_audit(
        db,
        "org.created",
        organization_id=org.id,
        user_id=ctx.user.id,
        entity_type="organization",
        entity_id=org.id,
        details={"name": org.name, "slug": org.slug},
        ip=client_ip(request),
    )
    db.commit()
    db.refresh(org)
    return AdminOrganizationOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        base_currency=org.base_currency,
        active_users=0,
        created_at=org.created_at,
    )


# ---- Users ----------------------------------------------------------------------------


@router.get("/users")
def list_users(ctx: SuperAdmin, db: DbSession) -> list[AdminUserOut]:
    users = db.scalars(
        select(User).options(selectinload(User.memberships)).order_by(User.full_name)
    ).all()
    return [_user_out(u) for u in users]


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(
    body: AdminCreateUserRequest, ctx: SuperAdmin, request: Request, db: DbSession
) -> AdminUserOut:
    org = _get_org(db, body.organization_id)
    email = normalize_email(body.email)
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A user with this email already exists — add them to the company instead",
        )

    user = User(
        email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password)
    )
    db.add(Membership(user=user, organization_id=org.id))
    db.flush()
    record_audit(
        db,
        "user.created",
        organization_id=org.id,
        user_id=ctx.user.id,
        entity_type="user",
        entity_id=user.id,
        details={"email": email, "full_name": user.full_name},
        ip=client_ip(request),
    )
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.post("/users/{user_id}/memberships")
def add_membership(
    user_id: uuid.UUID,
    body: AddMembershipRequest,
    ctx: SuperAdmin,
    request: Request,
    db: DbSession,
) -> AdminUserOut:
    user = _get_user(db, user_id)
    org = _get_org(db, body.organization_id)
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.organization_id == org.id
        )
    )
    if membership:
        membership.is_active = True
    else:
        db.add(Membership(user_id=user.id, organization_id=org.id))
    record_audit(
        db,
        "user.added_to_org",
        organization_id=org.id,
        user_id=ctx.user.id,
        entity_type="user",
        entity_id=user.id,
        details={"email": user.email},
        ip=client_ip(request),
    )
    db.commit()
    db.refresh(user)
    return _user_out(user)


def _set_membership_active(
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    active: bool,
    ctx: SuperAdmin,
    request: Request,
    db: Session,
) -> AdminUserOut:
    if not active and user_id == ctx.user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot remove your own access")

    membership = _get_membership(db, user_id, organization_id)
    membership.is_active = active
    if not active:
        revoke_sessions(db, user_id, organization_id=organization_id)
    record_audit(
        db,
        "user.activated" if active else "user.deactivated",
        organization_id=organization_id,
        user_id=ctx.user.id,
        entity_type="user",
        entity_id=user_id,
        details={"email": membership.user.email},
        ip=client_ip(request),
    )
    db.commit()
    user = _get_user(db, user_id)
    db.refresh(user)
    return _user_out(user)


@router.post("/users/{user_id}/memberships/{organization_id}/deactivate")
def deactivate_membership(
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    ctx: SuperAdmin,
    request: Request,
    db: DbSession,
) -> AdminUserOut:
    return _set_membership_active(user_id, organization_id, False, ctx, request, db)


@router.post("/users/{user_id}/memberships/{organization_id}/activate")
def activate_membership(
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    ctx: SuperAdmin,
    request: Request,
    db: DbSession,
) -> AdminUserOut:
    return _set_membership_active(user_id, organization_id, True, ctx, request, db)


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: uuid.UUID,
    body: ResetPasswordRequest,
    ctx: SuperAdmin,
    request: Request,
    db: DbSession,
) -> None:
    if user_id == ctx.user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Use My account to change your own password"
        )

    user = _get_user(db, user_id)
    user.password_hash = hash_password(body.password)
    user.failed_login_count = 0
    user.locked_until = None
    revoke_sessions(db, user_id)
    # One entry per company, so each company's activity log shows it.
    for org_id in [m.organization_id for m in user.memberships] or [None]:
        record_audit(
            db,
            "user.password_reset",
            organization_id=org_id,
            user_id=ctx.user.id,
            entity_type="user",
            entity_id=user_id,
            details={"email": user.email},
            ip=client_ip(request),
        )
    db.commit()
