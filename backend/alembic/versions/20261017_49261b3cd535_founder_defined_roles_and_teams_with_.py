"""founder defined roles and teams with history

Revision ID: 49261b3cd535
Revises: 8170f725c3e4
Create Date: 2026-10-17 16:58:11.458161

Replaces the fixed employees.role string with founder-defined roles, and the
reports_to tree with teams (lead + members), both with effective-dated history.
Existing data is converted: each company gets the default roles, every employee
is mapped to the matching role, and every person someone reported to becomes
the lead of a team containing those people.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "49261b3cd535"
down_revision: str | None = "8170f725c3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# old role code -> (name, manages YouTube, manages Facebook, can lead a team)
ROLES = {
    "channel_manager": ("Channel manager", True, False, False),
    "fb_page_manager": ("FB page manager", False, True, False),
    "team_lead": ("Team lead", True, True, True),
    "rights_coordinator": ("Rights coordinator", False, False, False),
    "finance_analyst": ("Finance analyst", False, False, False),
    "other": ("Other", False, False, False),
}


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def _org_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["organization_id"],
        ["organizations.id"],
        name=op.f(f"fk_{table}_organization_id_organizations"),
        ondelete="CASCADE",
    )


def _history_table(name: str, owner_col: str, owner_table: str, other_col: str, other_table: str, open_index: str, open_col: str) -> None:
    op.create_table(
        name,
        sa.Column(owner_col, sa.Uuid(), nullable=False),
        sa.Column(other_col, sa.Uuid(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("end_date IS NULL OR end_date >= start_date", name=op.f(f"ck_{name}_date_order")),
        sa.ForeignKeyConstraint([owner_col], [f"{owner_table}.id"], name=op.f(f"fk_{name}_{owner_col}_{owner_table}"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint([other_col], [f"{other_table}.id"], name=op.f(f"fk_{name}_{other_col}_{other_table}"), ondelete="RESTRICT"),
        _org_fk(name),
        sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{name}")),
    )
    op.create_index(op.f(f"ix_{name}_{owner_col}"), name, [owner_col])
    op.create_index(op.f(f"ix_{name}_{other_col}"), name, [other_col])
    op.create_index(op.f(f"ix_{name}_organization_id"), name, ["organization_id"])
    op.create_index(open_index, name, [open_col], unique=True, postgresql_where=sa.text("end_date IS NULL"))


def upgrade() -> None:
    op.create_table(
        "employee_roles",
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("can_manage_youtube", sa.Boolean(), nullable=False),
        sa.Column("can_manage_facebook", sa.Boolean(), nullable=False),
        sa.Column("can_lead_team", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        _org_fk("employee_roles"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_employee_roles")),
        sa.UniqueConstraint("organization_id", "name", name=op.f("uq_employee_roles_organization_id_name")),
    )
    op.create_index(op.f("ix_employee_roles_organization_id"), "employee_roles", ["organization_id"])

    op.create_table(
        "teams",
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        _org_fk("teams"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_teams")),
        sa.UniqueConstraint("organization_id", "name", name=op.f("uq_teams_organization_id_name")),
    )
    op.create_index(op.f("ix_teams_organization_id"), "teams", ["organization_id"])

    _history_table("team_memberships", "employee_id", "employees", "team_id", "teams", "uq_team_memberships_open_employee", "employee_id")
    _history_table("team_lead_assignments", "team_id", "teams", "employee_id", "employees", "uq_team_lead_assignments_open_team", "team_id")

    # ---- Data: default roles for every company, plus "Other" where it is in use ----------
    for code, (name, yt, fb, lead) in ROLES.items():
        condition = (
            "EXISTS (SELECT 1 FROM employees e WHERE e.organization_id = o.id AND e.role = :code)"
            if code == "other"
            else "TRUE"
        )
        op.get_bind().execute(
            sa.text(
                "INSERT INTO employee_roles (id, organization_id, name, can_manage_youtube, can_manage_facebook, can_lead_team) "
                f"SELECT gen_random_uuid(), o.id, :name, :yt, :fb, :lead FROM organizations o WHERE {condition}"
            ),
            {"code": code, "name": name, "yt": yt, "fb": fb, "lead": lead},
        )

    op.add_column("employees", sa.Column("role_id", sa.Uuid(), nullable=True))
    for code, (name, *_) in ROLES.items():
        op.get_bind().execute(
            sa.text(
                "UPDATE employees e SET role_id = r.id FROM employee_roles r "
                "WHERE r.organization_id = e.organization_id AND r.name = :name AND e.role = :code"
            ),
            {"code": code, "name": name},
        )
    op.alter_column("employees", "role_id", nullable=False)
    op.create_foreign_key(op.f("fk_employees_role_id_employee_roles"), "employees", "employee_roles", ["role_id"], ["id"], ondelete="RESTRICT")
    op.create_index(op.f("ix_employees_role_id"), "employees", ["role_id"])

    # ---- Data: everyone who had reports becomes the lead of "<name>'s team" ----------------
    op.execute(
        """
        INSERT INTO teams (id, organization_id, name)
        SELECT gen_random_uuid(), lead.organization_id, lead.full_name || '''s team'
        FROM employees lead
        WHERE EXISTS (SELECT 1 FROM employees e WHERE e.reports_to_id = lead.id)
        """
    )
    op.execute(
        """
        INSERT INTO team_lead_assignments (id, organization_id, team_id, employee_id, start_date)
        SELECT gen_random_uuid(), lead.organization_id, t.id, lead.id, lead.created_at::date
        FROM employees lead
        JOIN teams t ON t.organization_id = lead.organization_id AND t.name = lead.full_name || '''s team'
        """
    )
    op.execute(
        """
        INSERT INTO team_memberships (id, organization_id, employee_id, team_id, start_date)
        SELECT gen_random_uuid(), e.organization_id, e.id, tla.team_id, e.created_at::date
        FROM employees e
        JOIN team_lead_assignments tla ON tla.employee_id = e.reports_to_id
        """
    )

    op.drop_index(op.f("ix_employees_reports_to_id"), table_name="employees")
    op.drop_constraint(op.f("fk_employees_reports_to_id_employees"), "employees", type_="foreignkey")
    op.drop_column("employees", "reports_to_id")
    op.drop_column("employees", "role")


def downgrade() -> None:
    op.add_column("employees", sa.Column("role", sa.String(length=30), nullable=True))
    op.add_column("employees", sa.Column("reports_to_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE employees SET role = 'other'")
    for code, (name, *_) in ROLES.items():
        op.get_bind().execute(
            sa.text("UPDATE employees e SET role = :code FROM employee_roles r WHERE r.id = e.role_id AND r.name = :name"),
            {"code": code, "name": name},
        )
    op.alter_column("employees", "role", nullable=False)
    op.execute(
        """
        UPDATE employees e SET reports_to_id = tla.employee_id
        FROM team_memberships tm
        JOIN team_lead_assignments tla ON tla.team_id = tm.team_id AND tla.end_date IS NULL
        WHERE tm.employee_id = e.id AND tm.end_date IS NULL AND tla.employee_id <> e.id
        """
    )
    op.create_foreign_key(op.f("fk_employees_reports_to_id_employees"), "employees", "employees", ["reports_to_id"], ["id"], ondelete="SET NULL")
    op.create_index(op.f("ix_employees_reports_to_id"), "employees", ["reports_to_id"])
    op.drop_index(op.f("ix_employees_role_id"), table_name="employees")
    op.drop_constraint(op.f("fk_employees_role_id_employee_roles"), "employees", type_="foreignkey")
    op.drop_column("employees", "role_id")
    op.drop_table("team_lead_assignments")
    op.drop_table("team_memberships")
    op.drop_table("teams")
    op.drop_table("employee_roles")
