import uuid
from datetime import date, datetime, time, timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import Auth
from app.api.pagination import Page, Pagination, paginate
from app.core.database import DbSession
from app.models import AuditLog, User
from app.schemas.audit import AuditActorOut, AuditLogOut

router = APIRouter(prefix="/audit-logs", tags=["audit"])


def _day_start(day: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=tz)


@router.get("")
def list_audit_logs(
    ctx: Auth,
    db: DbSession,
    pagination: Pagination,
    action: Annotated[list[str] | None, Query(description="Repeat to match any of several")] = None,
    user_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sort: Literal["newest", "oldest"] = "newest",
) -> Page[AuditLogOut]:
    # Dates are calendar days in the company's timezone, both ends inclusive.
    tz = ZoneInfo(ctx.organization.timezone)
    stmt = select(AuditLog).where(AuditLog.organization_id == ctx.organization.id)
    if action:
        stmt = stmt.where(AuditLog.action.in_(action))
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= _day_start(date_from, tz))
    if date_to:
        stmt = stmt.where(AuditLog.created_at < _day_start(date_to + timedelta(days=1), tz))
    order = AuditLog.created_at.asc() if sort == "oldest" else AuditLog.created_at.desc()
    # id as a tie-breaker keeps page boundaries stable for events in the same instant.
    stmt = stmt.order_by(order, AuditLog.id)

    logs, total = paginate(db, stmt, pagination)
    return Page(
        items=[
            AuditLogOut(
                id=log.id,
                action=log.action,
                user_name=log.user.full_name if log.user else None,
                entity_type=log.entity_type,
                entity_id=log.entity_id,
                details=log.details,
                ip=log.ip,
                created_at=log.created_at,
            )
            for log in logs
        ],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/actors")
def list_audit_actors(ctx: Auth, db: DbSession) -> list[AuditActorOut]:
    """Everyone who appears in this company's activity, for the "Who" filter."""
    rows = db.execute(
        select(User.id, User.full_name)
        .join(AuditLog, AuditLog.user_id == User.id)
        .where(AuditLog.organization_id == ctx.organization.id)
        .distinct()
        .order_by(User.full_name)
    ).all()
    return [AuditActorOut(id=row.id, name=row.full_name) for row in rows]
