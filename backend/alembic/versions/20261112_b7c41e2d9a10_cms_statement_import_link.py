"""cms statement remembers the sheet upload that wrote it

Revision ID: b7c41e2d9a10
Revises: 6ea3b261bef2
Create Date: 2026-11-12 14:50:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'b7c41e2d9a10'
down_revision: str | None = '6ea3b261bef2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('cms_statements', sa.Column('import_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f('fk_cms_statements_import_id_revenue_imports'),
        'cms_statements',
        'revenue_imports',
        ['import_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f('fk_cms_statements_import_id_revenue_imports'), 'cms_statements', type_='foreignkey'
    )
    op.drop_column('cms_statements', 'import_id')
