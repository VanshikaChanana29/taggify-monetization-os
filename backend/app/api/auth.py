from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from app.api.deps import CurrentUser, client_ip
from app.core.config import get_settings
from app.core.database import DbSession
from app.core.security import hash_password, utcnow, verify_password
from app.models import Membership, Organization, User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    MeOut,
    OrganizationOut,
    SwitchOrganizationRequest,
    UserOut,
)
from app.services.audit import record_audit
from app.services.auth import (
    AccountLockedError,
    LoginError,
    authenticate,
    create_session,
    revoke_sessions,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _me(user: User, organization: Organization | None) -> MeOut:
    return MeOut(
        user=UserOut.model_validate(user),
        organization=OrganizationOut.model_validate(organization) if organization else None,
        organizations=[
            OrganizationOut.model_validate(m.organization) for m in user.memberships if m.is_active
        ],
    )


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response, db: DbSession) -> MeOut:
    ip = client_ip(request)
    try:
        user, membership = authenticate(db, body.email, body.password, ip)
    except AccountLockedError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from exc
    except LoginError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    organization = membership.organization if membership else None
    org_id = organization.id if organization else None
    token = create_session(db, user.id, org_id, ip, request.headers.get("user-agent"))
    record_audit(db, "auth.login", organization_id=org_id, user_id=user.id, ip=ip)
    db.commit()

    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return _me(user, organization)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(ctx: CurrentUser, request: Request, response: Response, db: DbSession) -> None:
    ctx.session.revoked_at = utcnow()
    record_audit(
        db,
        "auth.logout",
        organization_id=ctx.session.active_organization_id,
        user_id=ctx.user.id,
        ip=client_ip(request),
    )
    db.commit()
    response.delete_cookie(get_settings().session_cookie_name, path="/")


@router.get("/me")
def me(ctx: CurrentUser) -> MeOut:
    return _me(ctx.user, ctx.organization)


@router.post("/switch-organization")
def switch_organization(
    body: SwitchOrganizationRequest, ctx: CurrentUser, request: Request, db: DbSession
) -> MeOut:
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == ctx.user.id,
            Membership.organization_id == body.organization_id,
            Membership.is_active.is_(True),
        )
    )
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to that company")

    ctx.session.active_organization_id = membership.organization_id
    ctx.user.last_organization_id = membership.organization_id
    record_audit(
        db,
        "auth.switch_organization",
        organization_id=membership.organization_id,
        user_id=ctx.user.id,
        details={
            "from": ctx.organization.slug if ctx.organization else None,
            "to": membership.organization.slug,
        },
        ip=client_ip(request),
    )
    db.commit()
    return _me(ctx.user, membership.organization)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordRequest, ctx: CurrentUser, request: Request, db: DbSession
) -> None:
    if not verify_password(ctx.user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")

    ctx.user.password_hash = hash_password(body.new_password)
    revoke_sessions(db, ctx.user.id, except_session_id=ctx.session.id)
    record_audit(
        db,
        "auth.password_changed",
        organization_id=ctx.session.active_organization_id,
        user_id=ctx.user.id,
        ip=client_ip(request),
    )
    db.commit()
