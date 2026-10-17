import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: uuid.UUID
    action: str
    user_name: str | None
    entity_type: str | None
    entity_id: str | None
    details: dict[str, Any]
    ip: str | None
    created_at: datetime


class AuditActorOut(BaseModel):
    id: uuid.UUID
    name: str
