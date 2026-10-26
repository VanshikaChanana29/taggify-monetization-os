"""Delete a whole company and everything in it (super admin only, cannot be undone).

Rows are removed table by table, children before parents, so foreign keys that refuse a
delete (e.g. a CMS partner still used by a channel) never get in the way. Founders keep
their login: they only lose their access to this company. The audit log keeps its entries
(they lose the company link) plus one entry recording the deletion. Uploaded files are
removed from storage after the database commit.
"""

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    Base,
    Channel,
    CmsStatement,
    ContentDeal,
    ContentOwner,
    DealDocument,
    Employee,
    IncentiveLine,
    IncentiveRun,
    Membership,
    Organization,
    RevenueFact,
)


def impact(db: Session, org: Organization) -> dict[str, int]:
    """What deleting the company would remove, for the warning."""

    def count(model) -> int:
        return (
            db.scalar(
                select(func.count()).select_from(model).where(model.organization_id == org.id)
            )
            or 0
        )

    files = count(DealDocument) + (
        db.scalar(
            select(func.count())
            .select_from(CmsStatement)
            .where(CmsStatement.organization_id == org.id, CmsStatement.storage_key.is_not(None))
        )
        or 0
    )
    return {
        "content_owners": count(ContentOwner),
        "deals": count(ContentDeal),
        "channels": count(Channel),
        "people": count(Employee),
        "revenue_rows": count(RevenueFact),
        "files": files,
        "founders": count(Membership),
    }


def delete_company(db: Session, org: Organization) -> list[str]:
    """Delete the company's rows. Returns the storage keys to remove once committed."""
    keys = [
        k
        for k in db.scalars(
            select(DealDocument.storage_key).where(DealDocument.organization_id == org.id)
        )
        if k
    ] + [
        k
        for k in db.scalars(
            select(CmsStatement.storage_key).where(CmsStatement.organization_id == org.id)
        )
        if k
    ]
    # Incentive lines have no company column and block deleting channels/people: go first.
    runs = select(IncentiveRun.id).where(IncentiveRun.organization_id == org.id)
    db.execute(delete(IncentiveLine).where(IncentiveLine.run_id.in_(runs)))
    for table in reversed(Base.metadata.sorted_tables):
        if table.name == AuditLog.__tablename__ or "organization_id" not in table.c:
            continue
        db.execute(delete(table).where(table.c.organization_id == org.id))
    db.execute(delete(Organization).where(Organization.id == org.id))
    return keys
