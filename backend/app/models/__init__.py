# Import every model module here so Alembic autogenerate can see all tables.
from app.models.audit import AuditLog
from app.models.base import Base
from app.models.channels import Channel, CmsPartner, SlotAssignment
from app.models.content import ContentDeal, ContentOwner, DealEpisodeRange, DealSlot
from app.models.finance import (
    BankReceipt,
    CmsAdjustment,
    CmsFeeSchedule,
    CmsStatement,
    FxRate,
    RevenueFact,
    RevenueImport,
)
from app.models.organization import Organization
from app.models.payouts import (
    DealExpense,
    DealInstallment,
    IncentiveLine,
    IncentiveRate,
    IncentiveRun,
    MonthClose,
)
from app.models.people import (
    ChannelManagerAssignment,
    Employee,
    EmployeeRole,
    Team,
    TeamLeadAssignment,
    TeamMembership,
)
from app.models.session import UserSession
from app.models.user import Membership, User

__all__ = [
    "MonthClose",
    "IncentiveRun",
    "IncentiveRate",
    "IncentiveLine",
    "DealInstallment",
    "DealExpense",
    "RevenueImport",
    "RevenueFact",
    "FxRate",
    "CmsStatement",
    "CmsFeeSchedule",
    "CmsAdjustment",
    "BankReceipt",
    "AuditLog",
    "Base",
    "Channel",
    "ChannelManagerAssignment",
    "CmsPartner",
    "ContentDeal",
    "ContentOwner",
    "DealEpisodeRange",
    "DealSlot",
    "Employee",
    "EmployeeRole",
    "Membership",
    "Organization",
    "SlotAssignment",
    "Team",
    "TeamLeadAssignment",
    "TeamMembership",
    "User",
    "UserSession",
]
