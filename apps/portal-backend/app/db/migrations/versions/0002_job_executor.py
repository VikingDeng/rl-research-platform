"""add job executor fields

Revision ID: 0002_job_executor
Revises: 0001_init
Create Date: 2025-02-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_job_executor"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("backend_ref", sa.String(), nullable=True))
    op.add_column("jobs", sa.Column("executor", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "executor")
    op.drop_column("jobs", "backend_ref")
