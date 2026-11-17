"""parent deals: one contract with several shows under it

Every existing deal gets its own parent deal with the same id, name, owner, type, amount and
dates, so nothing changes for it. Installments, deal partners' shares and their contributions
move from the show to the parent (same id, so the rows keep pointing at the right deal).

Revision ID: 5a1f0c9e2b47
Revises: c3d8f1a5e7b2
Create Date: 2026-11-17 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '5a1f0c9e2b47'
down_revision: str | None = 'c3d8f1a5e7b2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MOVED = ('deal_installments', 'deal_partner_shares', 'partner_contributions')


def upgrade() -> None:
    op.create_table('parent_deals',
    sa.Column('owner_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('deal_type', sa.String(length=20), nullable=False),
    sa.Column('amount', sa.Numeric(precision=18, scale=2), nullable=True),
    sa.Column('currency', sa.String(length=3), nullable=True),
    sa.Column('term_start', sa.Date(), nullable=False),
    sa.Column('term_end', sa.Date(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('term_end > term_start', name=op.f('ck_parent_deals_term_order')),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_parent_deals_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['owner_id'], ['content_owners.id'], name=op.f('fk_parent_deals_owner_id_content_owners'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_parent_deals'))
    )
    op.create_index(op.f('ix_parent_deals_organization_id'), 'parent_deals', ['organization_id'], unique=False)
    op.create_index(op.f('ix_parent_deals_owner_id'), 'parent_deals', ['owner_id'], unique=False)

    # One parent per existing deal, sharing its id.
    op.execute(
        """
        INSERT INTO parent_deals (id, organization_id, owner_id, name, deal_type, amount,
                                  currency, term_start, term_end, created_at, updated_at)
        SELECT id, organization_id, owner_id, title, deal_type, fee_amount,
               currency, term_start, term_end, created_at, updated_at
        FROM content_deals
        """
    )
    op.add_column('content_deals', sa.Column('parent_id', sa.Uuid(), nullable=True))
    op.execute('UPDATE content_deals SET parent_id = id')
    op.alter_column('content_deals', 'parent_id', nullable=False)
    op.create_index(op.f('ix_content_deals_parent_id'), 'content_deals', ['parent_id'], unique=False)
    op.create_foreign_key(op.f('fk_content_deals_parent_id_parent_deals'), 'content_deals', 'parent_deals', ['parent_id'], ['id'], ondelete='RESTRICT')

    # Installments, partner shares and contributions: deal_id (show) -> parent_id (same id).
    op.drop_constraint('uq_deal_partner_shares_deal_id_partner_id', 'deal_partner_shares', type_='unique')
    for table in MOVED:
        op.drop_constraint(f'fk_{table}_deal_id_content_deals', table, type_='foreignkey')
        op.drop_index(f'ix_{table}_deal_id', table_name=table)
        op.alter_column(table, 'deal_id', new_column_name='parent_id')
        op.create_index(op.f(f'ix_{table}_parent_id'), table, ['parent_id'], unique=False)
        op.create_foreign_key(op.f(f'fk_{table}_parent_id_parent_deals'), table, 'parent_deals', ['parent_id'], ['id'], ondelete='CASCADE')
    op.create_unique_constraint(op.f('uq_deal_partner_shares_parent_id_partner_id'), 'deal_partner_shares', ['parent_id', 'partner_id'])


def downgrade() -> None:
    # Each parent's rows go back to its first show (lossy when a parent has several shows).
    op.drop_constraint('uq_deal_partner_shares_parent_id_partner_id', 'deal_partner_shares', type_='unique')
    for table in MOVED:
        op.drop_constraint(f'fk_{table}_parent_id_parent_deals', table, type_='foreignkey')
        op.drop_index(f'ix_{table}_parent_id', table_name=table)
        op.execute(
            f"""
            UPDATE {table} t SET parent_id = (
                SELECT d.id FROM content_deals d WHERE d.parent_id = t.parent_id
                ORDER BY d.created_at LIMIT 1
            )
            """
        )
        op.execute(f'DELETE FROM {table} WHERE parent_id IS NULL')
        op.alter_column(table, 'parent_id', new_column_name='deal_id')
        op.create_index(f'ix_{table}_deal_id', table, ['deal_id'], unique=False)
        op.create_foreign_key(f'fk_{table}_deal_id_content_deals', table, 'content_deals', ['deal_id'], ['id'], ondelete='CASCADE')
    op.create_unique_constraint('uq_deal_partner_shares_deal_id_partner_id', 'deal_partner_shares', ['deal_id', 'partner_id'])

    op.drop_constraint(op.f('fk_content_deals_parent_id_parent_deals'), 'content_deals', type_='foreignkey')
    op.drop_index(op.f('ix_content_deals_parent_id'), table_name='content_deals')
    op.drop_column('content_deals', 'parent_id')
    op.drop_index(op.f('ix_parent_deals_owner_id'), table_name='parent_deals')
    op.drop_index(op.f('ix_parent_deals_organization_id'), table_name='parent_deals')
    op.drop_table('parent_deals')
