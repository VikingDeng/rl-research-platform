"""eval protocol scenario grid and opponent sampling

Revision ID: 0009_eval_protocol_grid
Revises: 0008_settings
Create Date: 2026-01-19 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_eval_protocol_grid"
down_revision = "0008_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("eval_protocols", sa.Column("scenario_grid", sa.JSON(), nullable=True))
    op.add_column("eval_protocols", sa.Column("opponent_sampling", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("eval_protocols", "opponent_sampling")
    op.drop_column("eval_protocols", "scenario_grid")
