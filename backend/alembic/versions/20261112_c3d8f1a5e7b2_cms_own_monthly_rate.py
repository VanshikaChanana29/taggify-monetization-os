"""each cms's own monthly rate, from its sheet or set by hand

Revision ID: c3d8f1a5e7b2
Revises: b7c41e2d9a10
Create Date: 2026-11-12 16:10:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'c3d8f1a5e7b2'
down_revision: str | None = 'b7c41e2d9a10'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('cms_fx_rates',
    sa.Column('cms_partner_id', sa.Uuid(), nullable=False),
    sa.Column('month', sa.Date(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('sheet_rate', sa.Numeric(precision=18, scale=6), nullable=True),
    sa.Column('manual_rate', sa.Numeric(precision=18, scale=6), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['cms_partner_id'], ['cms_partners.id'], name=op.f('fk_cms_fx_rates_cms_partner_id_cms_partners'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_cms_fx_rates_organization_id_organizations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_cms_fx_rates')),
    sa.UniqueConstraint('cms_partner_id', 'month', 'currency', name=op.f('uq_cms_fx_rates_cms_partner_id_month_currency'))
    )
    op.create_index(op.f('ix_cms_fx_rates_cms_partner_id'), 'cms_fx_rates', ['cms_partner_id'], unique=False)
    op.create_index(op.f('ix_cms_fx_rates_organization_id'), 'cms_fx_rates', ['organization_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_cms_fx_rates_organization_id'), table_name='cms_fx_rates')
    op.drop_index(op.f('ix_cms_fx_rates_cms_partner_id'), table_name='cms_fx_rates')
    op.drop_table('cms_fx_rates')
