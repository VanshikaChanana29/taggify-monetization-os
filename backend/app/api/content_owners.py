import uuid

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.deps import Auth, client_ip
from app.core.database import DbSession
from app.models import ContentDeal, ContentOwner
from app.schemas.deals import OwnerIn, OwnerOut
from app.services.audit import record_audit

# A company has a handful of content owners, so the list is returned whole and
# sorted/filtered/paginated in the browser.
router = APIRouter(prefix="/content-owners", tags=["content owners"])

TRACKED = ("name", "owner_type", "contact_name", "contact_email", "notes", "is_active")


def _out(owner: ContentOwner, deal_count: int) -> OwnerOut:
    return OwnerOut(
        id=owner.id,
        name=owner.name,
        owner_type=owner.owner_type,  # type: ignore[arg-type]
        contact_name=owner.contact_name,
        contact_email=owner.contact_email,
        notes=owner.notes,
        is_active=owner.is_active,
        deal_count=deal_count,
        created_at=owner.created_at,
    )


def _deal_counts(db: DbSession, organization_id: uuid.UUID) -> dict[uuid.UUID, int]:
    return dict(
        db.execute(
            select(ContentDeal.owner_id, func.count())
            .where(ContentDeal.organization_id == organization_id)
            .group_by(ContentDeal.owner_id)
        ).all()
    )


def _ensure_unique_name(db: DbSession, ctx: Auth, name: str, exclude: uuid.UUID | None = None):
    stmt = select(ContentOwner.id).where(
        ContentOwner.organization_id == ctx.organization.id,
        func.lower(ContentOwner.name) == name.lower(),
    )
    if exclude:
        stmt = stmt.where(ContentOwner.id != exclude)
    if db.scalar(stmt):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A content owner named '{name}' exists")


@router.get("")
def list_owners(ctx: Auth, db: DbSession) -> list[OwnerOut]:
    counts = _deal_counts(db, ctx.organization.id)
    owners = db.scalars(
        select(ContentOwner)
        .where(ContentOwner.organization_id == ctx.organization.id)
        .order_by(ContentOwner.name)
    )
    return [_out(o, counts.get(o.id, 0)) for o in owners]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_owner(body: OwnerIn, ctx: Auth, request: Request, db: DbSession) -> OwnerOut:
    _ensure_unique_name(db, ctx, body.name)
    owner = ContentOwner(organization_id=ctx.organization.id, **body.model_dump())
    db.add(owner)
    db.flush()
    record_audit(
        db,
        "owner.created",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="content_owner",
        entity_id=owner.id,
        details={"name": owner.name},
        ip=client_ip(request),
    )
    db.commit()
    db.refresh(owner)
    return _out(owner, 0)


@router.put("/{owner_id}")
def update_owner(
    owner_id: uuid.UUID, body: OwnerIn, ctx: Auth, request: Request, db: DbSession
) -> OwnerOut:
    owner = db.scalar(
        select(ContentOwner).where(
            ContentOwner.id == owner_id, ContentOwner.organization_id == ctx.organization.id
        )
    )
    if owner is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content owner not found")
    _ensure_unique_name(db, ctx, body.name, exclude=owner.id)

    new = body.model_dump()
    changes = {f: [getattr(owner, f), new[f]] for f in TRACKED if getattr(owner, f) != new[f]}
    for f in TRACKED:
        setattr(owner, f, new[f])
    if changes:
        record_audit(
            db,
            "owner.updated",
            organization_id=ctx.organization.id,
            user_id=ctx.user.id,
            entity_type="content_owner",
            entity_id=owner.id,
            details={"name": owner.name, "changes": changes},
            ip=client_ip(request),
        )
    db.commit()
    db.refresh(owner)
    return _out(owner, _deal_counts(db, ctx.organization.id).get(owner.id, 0))
