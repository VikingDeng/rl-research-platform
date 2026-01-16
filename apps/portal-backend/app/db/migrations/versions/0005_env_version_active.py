"""add env version active flag

Revision ID: 0005_env_version_active
Revises: 0004_env_entrypoint
Create Date: 2026-01-15 16:25:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_env_version_active"
down_revision = "0004_env_entrypoint"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("env_versions", sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.alter_column("env_versions", "active", server_default=None)


def downgrade() -> None:
    op.drop_column("env_versions", "active")
