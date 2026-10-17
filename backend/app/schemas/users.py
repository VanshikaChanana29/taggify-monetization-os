import uuid
from datetime import datetime

from pydantic import BaseModel


class MemberOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    is_active: bool
    last_login_at: datetime | None
    added_at: datetime
