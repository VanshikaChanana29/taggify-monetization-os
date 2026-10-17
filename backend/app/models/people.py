import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, OrgScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.channels import Channel

# Seeded into every new company; founders can rename, change or add to them.
DEFAULT_ROLES = (
    # name, manages YouTube, manages Facebook, can lead a team
    ("Channel manager", True, False, False),
    ("FB page manager", False, True, False),
    ("Team lead", True, True, True),
    ("Rights coordinator", False, False, False),
    ("Finance analyst", False, False, False),
)


class EmployeeRole(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A job role defined by the founders, with what people in it are allowed to do."""

    __tablename__ = "employee_roles"
    __table_args__ = (UniqueConstraint("organization_id", "name"),)

    name: Mapped[str] = mapped_column(String(80))
    can_manage_youtube: Mapped[bool] = mapped_column(default=False)
    can_manage_facebook: Mapped[bool] = mapped_column(default=False)
    can_lead_team: Mapped[bool] = mapped_column(default=False)

    def can_manage(self, platform: str) -> bool:
        return self.can_manage_youtube if platform == "youtube" else self.can_manage_facebook


class Team(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A group of people under one team lead (who earns the lead incentive on its channels)."""

    __tablename__ = "teams"
    __table_args__ = (UniqueConstraint("organization_id", "name"),)

    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")


class Employee(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """A team member. Employees never log in; founders track who handles what."""

    __tablename__ = "employees"

    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(30))
    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employee_roles.id", ondelete="RESTRICT"), index=True
    )
    join_date: Mapped[date | None] = mapped_column(Date)
    monthly_salary: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    salary_currency: Mapped[str] = mapped_column(String(3), default="INR")
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")
    notes: Mapped[str | None] = mapped_column(Text)

    role: Mapped[EmployeeRole] = relationship(lazy="joined")


class TeamMembership(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Which team a person was in, and when. One open membership per person."""

    __tablename__ = "team_memberships"
    __table_args__ = (
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="date_order"),
        Index(
            "uq_team_memberships_open_employee",
            "employee_id",
            unique=True,
            postgresql_where=text("end_date IS NULL"),
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), index=True
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), index=True
    )
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)

    team: Mapped[Team] = relationship(lazy="joined")
    employee: Mapped[Employee] = relationship(lazy="joined")


class TeamLeadAssignment(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Who led a team, and when. One open lead per team."""

    __tablename__ = "team_lead_assignments"
    __table_args__ = (
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="date_order"),
        Index(
            "uq_team_lead_assignments_open_team",
            "team_id",
            unique=True,
            postgresql_where=text("end_date IS NULL"),
        ),
    )

    team_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), index=True
    )
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)

    team: Mapped[Team] = relationship(lazy="joined")
    employee: Mapped[Employee] = relationship(lazy="joined")


class ChannelManagerAssignment(UUIDPrimaryKeyMixin, OrgScopedMixin, TimestampMixin, Base):
    """Who manages a channel, and since when. Closed rows keep the history."""

    __tablename__ = "channel_manager_assignments"
    __table_args__ = (
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="date_order"),
        Index(
            "uq_channel_manager_assignments_open_channel",
            "channel_id",
            unique=True,
            postgresql_where=text("end_date IS NULL"),
        ),
    )

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="RESTRICT"), index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), index=True
    )
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)

    channel: Mapped[Channel] = relationship(lazy="joined")
    employee: Mapped[Employee] = relationship(lazy="joined")
