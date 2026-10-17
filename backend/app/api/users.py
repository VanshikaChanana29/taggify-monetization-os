from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.deps import Auth
from app.core.database import DbSession
from app.models import Membership
from app.schemas.users import MemberOut

# Founders can see who else has access to their company. Creating and managing
# users is super-admin only (see app/api/admin.py).
router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
def list_users(ctx: Auth, db: DbSession) -> list[MemberOut]:
    memberships = db.scalars(
        select(Membership)
        .options(joinedload(Membership.user))
        .where(Membership.organization_id == ctx.organization.id)
        .order_by(Membership.created_at)
    ).all()
    return [
        MemberOut(
            id=m.user.id,
            email=m.user.email,
            full_name=m.user.full_name,
            is_active=m.is_active,
            last_login_at=m.user.last_login_at,
            added_at=m.created_at,
        )
        for m in memberships
    ]
