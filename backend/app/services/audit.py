import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog


def record_audit(
    db: Session,
    action: str,
    *,
    organization_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | str | None = None,
    details: dict[str, Any] | None = None,
    ip: str | None = None,
) -> None:
    """Add an audit entry to the current transaction. The caller commits."""
    db.add(
        AuditLog(
            action=action,
            organization_id=organization_id,
            user_id=user_id,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else None,
            details=details or {},
            ip=ip,
        )
    )
