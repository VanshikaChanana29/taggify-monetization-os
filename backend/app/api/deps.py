from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import DbSession
from app.core.security import hash_token, utcnow
from app.models import Membership, Organization, User, UserSession

LAST_SEEN_RESOLUTION = timedelta(minutes=5)


@dataclass
class SessionContext:
    """The logged-in user. `organization` is None only for a super admin with no company."""

    user: User
    session: UserSession
    organization: Organization | None


@dataclass
class AuthContext:
    """The logged-in user and the company they are currently working in."""

    user: User
    organization: Organization
    session: UserSession


def client_ip(request: Request) -> str | None:
    # Requests arrive through the Next.js proxy, which sets X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else None


def get_session_context(request: Request, db: DbSession) -> SessionContext:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        raise unauthorized

    now = utcnow()
    session = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == hash_token(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now,
        )
    )
    if session is None:
        raise unauthorized

    organization = None
    if session.active_organization_id is not None:
        membership = db.scalar(
            select(Membership).where(
                Membership.user_id == session.user_id,
                Membership.organization_id == session.active_organization_id,
                Membership.is_active.is_(True),
            )
        )
        if membership is None:
            # Access to this company was removed after login.
            session.revoked_at = now
            db.commit()
            raise unauthorized
        organization = membership.organization

    if session.last_seen_at is None or now - session.last_seen_at > LAST_SEEN_RESOLUTION:
        session.last_seen_at = now
        db.commit()

    return SessionContext(user=session.user, session=session, organization=organization)


CurrentUser = Annotated[SessionContext, Depends(get_session_context)]


def get_auth_context(ctx: CurrentUser) -> AuthContext:
    if ctx.organization is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Select a company first")
    return AuthContext(user=ctx.user, organization=ctx.organization, session=ctx.session)


def require_superadmin(ctx: CurrentUser) -> SessionContext:
    if not ctx.user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Super admin only")
    return ctx


Auth = Annotated[AuthContext, Depends(get_auth_context)]
SuperAdmin = Annotated[SessionContext, Depends(require_superadmin)]
