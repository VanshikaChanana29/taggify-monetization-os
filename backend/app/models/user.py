import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.organization import Organization


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A person who can log in: a founder of a company, or the super admin.

    The super admin runs the tool: creates companies and their founders. Employees are
    not users — they are data (Part 3).
    """

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(254), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_superadmin: Mapped[bool] = mapped_column(default=False, server_default="false")
    # Company picked last in the header; login opens it again if access is still active.
    last_organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL")
    )
    failed_login_count: Mapped[int] = mapped_column(default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", order_by="Membership.created_at"
    )


class Membership(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Which company a user can see. Deactivating a membership removes access to that company."""

    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "organization_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")

    user: Mapped[User] = relationship(back_populates="memberships")
    organization: Mapped[Organization] = relationship(lazy="joined")
