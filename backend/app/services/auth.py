import uuid
from datetime import timedelta

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    hash_password,
    hash_token,
    new_session_token,
    password_needs_rehash,
    utcnow,
    verify_password,
)
from app.models import Membership, User, UserSession
from app.services.audit import record_audit

INVALID_CREDENTIALS = "Invalid email or password"


class LoginError(Exception):
    pass


class AccountLockedError(LoginError):
    pass


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_new_email(email: str) -> str:
    """Same rules as the API's EmailStr, for places that take raw input (the CLI)."""
    try:
        result = validate_email(email.strip(), check_deliverability=False)
        return normalize_email(result.normalized)
    except EmailNotValidError as exc:
        raise ValueError(str(exc)) from exc


def authenticate(
    db: Session, email: str, password: str, ip: str | None
) -> tuple[User, Membership | None]:
    """Check credentials and return the user plus the membership to start the session in.

    The membership is None only for a super admin who belongs to no company.
    Failed attempts are counted per user; after too many the account is locked for a while.
    Commits failure bookkeeping itself, so it survives the caller raising an HTTP error.
    """
    settings = get_settings()
    now = utcnow()
    email = normalize_email(email)
    user = db.scalar(select(User).where(User.email == email))
    first_org_id = user.memberships[0].organization_id if user and user.memberships else None

    if user and user.locked_until and user.locked_until > now:
        minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
        raise AccountLockedError(f"Too many failed attempts. Try again in {minutes} minutes.")

    if not verify_password(user.password_hash if user else None, password):
        if user:
            user.failed_login_count += 1
            if user.failed_login_count >= settings.max_failed_logins:
                user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
                user.failed_login_count = 0
                record_audit(
                    db, "auth.locked", organization_id=first_org_id, user_id=user.id, ip=ip
                )
        record_audit(
            db,
            "auth.login_failed",
            organization_id=first_org_id,
            user_id=user.id if user else None,
            details={"email": email},
            ip=ip,
        )
        db.commit()
        raise LoginError(INVALID_CREDENTIALS)

    active = [m for m in user.memberships if m.is_active]
    if not active and not user.is_superadmin:
        record_audit(db, "auth.login_denied", organization_id=first_org_id, user_id=user.id, ip=ip)
        db.commit()
        raise LoginError("Your access has been deactivated.")

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    last_used = next((m for m in active if m.organization_id == user.last_organization_id), None)
    return user, (last_used or (active[0] if active else None))


def create_session(
    db: Session,
    user_id: uuid.UUID,
    organization_id: uuid.UUID | None,
    ip: str | None,
    user_agent: str | None,
) -> str:
    """Store a new session and return the raw token for the cookie. The caller commits."""
    token = new_session_token()
    db.add(
        UserSession(
            user_id=user_id,
            active_organization_id=organization_id,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(days=get_settings().session_days),
            last_seen_at=utcnow(),
            ip=ip,
            user_agent=(user_agent or "")[:255] or None,
        )
    )
    return token


def revoke_sessions(
    db: Session,
    user_id: uuid.UUID,
    *,
    organization_id: uuid.UUID | None = None,
    except_session_id: uuid.UUID | None = None,
) -> None:
    """Log a user out everywhere (or only from one company). The caller commits."""
    stmt = (
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    if organization_id is not None:
        stmt = stmt.where(UserSession.active_organization_id == organization_id)
    if except_session_id is not None:
        stmt = stmt.where(UserSession.id != except_session_id)
    db.execute(stmt)
