import uuid

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.deps import Auth, client_ip
from app.core.database import DbSession
from app.models import Channel, CmsPartner
from app.schemas.channels import CmsIn, CmsOut
from app.services.audit import record_audit

# Few CMS partners per company: returned whole, filtered/paginated in the browser.
router = APIRouter(prefix="/cms-partners", tags=["cms partners"])

TRACKED = ("name", "platform", "notes", "is_active")


def _counts(db: DbSession, organization_id: uuid.UUID) -> dict[uuid.UUID, int]:
    return dict(
        db.execute(
            select(Channel.cms_partner_id, func.count())
            .where(Channel.organization_id == organization_id, Channel.cms_partner_id.is_not(None))
            .group_by(Channel.cms_partner_id)
        ).all()
    )


def _out(cms: CmsPartner, count: int) -> CmsOut:
    return CmsOut(
        id=cms.id,
        name=cms.name,
        platform=cms.platform,  # type: ignore[arg-type]
        notes=cms.notes,
        is_active=cms.is_active,
        channel_count=count,
        created_at=cms.created_at,
    )


def _unique(db: DbSession, ctx: Auth, name: str, exclude: uuid.UUID | None = None) -> None:
    stmt = select(CmsPartner.id).where(
        CmsPartner.organization_id == ctx.organization.id,
        func.lower(CmsPartner.name) == name.lower(),
    )
    if exclude:
        stmt = stmt.where(CmsPartner.id != exclude)
    if db.scalar(stmt):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A CMS partner named '{name}' exists")


@router.get("")
def list_cms(ctx: Auth, db: DbSession) -> list[CmsOut]:
    counts = _counts(db, ctx.organization.id)
    rows = db.scalars(
        select(CmsPartner)
        .where(CmsPartner.organization_id == ctx.organization.id)
        .order_by(CmsPartner.name)
    )
    return [_out(c, counts.get(c.id, 0)) for c in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_cms(body: CmsIn, ctx: Auth, request: Request, db: DbSession) -> CmsOut:
    _unique(db, ctx, body.name)
    cms = CmsPartner(organization_id=ctx.organization.id, **body.model_dump())
    db.add(cms)
    db.flush()
    record_audit(
        db,
        "cms.created",
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="cms_partner",
        entity_id=cms.id,
        details={"name": cms.name},
        ip=client_ip(request),
    )
    db.commit()
    db.refresh(cms)
    return _out(cms, 0)


@router.put("/{cms_id}")
def update_cms(
    cms_id: uuid.UUID, body: CmsIn, ctx: Auth, request: Request, db: DbSession
) -> CmsOut:
    cms = db.scalar(
        select(CmsPartner).where(
            CmsPartner.id == cms_id, CmsPartner.organization_id == ctx.organization.id
        )
    )
    if cms is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "CMS partner not found")
    _unique(db, ctx, body.name, exclude=cms.id)
    if body.platform != cms.platform and _counts(db, ctx.organization.id).get(cms.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Cannot change the platform while channels use this CMS"
        )
    new = body.model_dump()
    changes = {f: [getattr(cms, f), new[f]] for f in TRACKED if getattr(cms, f) != new[f]}
    for f in TRACKED:
        setattr(cms, f, new[f])
    if changes:
        record_audit(
            db,
            "cms.updated",
            organization_id=ctx.organization.id,
            user_id=ctx.user.id,
            entity_type="cms_partner",
            entity_id=cms.id,
            details={"name": cms.name, "changes": changes},
            ip=client_ip(request),
        )
    db.commit()
    db.refresh(cms)
    return _out(cms, _counts(db, ctx.organization.id).get(cms.id, 0))
