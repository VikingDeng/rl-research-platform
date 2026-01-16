"""add env entrypoint and package

Revision ID: 0004_env_entrypoint
Revises: 0003_m3_eval_matrix
Create Date: 2026-01-15 16:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_env_entrypoint"
down_revision = "0003_m3_eval_matrix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("env_versions", sa.Column("entrypoint", sa.String(), nullable=True))
    op.add_column("env_versions", sa.Column("package", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("env_versions", "package")
    op.drop_column("env_versions", "entrypoint")
