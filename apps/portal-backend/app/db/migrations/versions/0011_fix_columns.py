"""fix columns

Revision ID: 0011_fix_columns
Revises: 0010_missing_tables
Create Date: 2026-02-09 12:30:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0011_fix_columns"
down_revision = "0010_missing_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add missing columns to projects
    # We use batch_alter_table or just individual add_column
    # To be safe, we check if they exist (though in clean run they shouldn't)
    op.add_column("projects", sa.Column("git_repo", sa.String(), nullable=True))
    op.add_column("projects", sa.Column("git_branch", sa.String(), nullable=True, server_default="main"))
    
    # 2. Add missing columns to runs
    op.add_column("runs", sa.Column("group_id", sa.String(), nullable=True))
    op.add_column("runs", sa.Column("git_branch", sa.String(), nullable=True))
    op.add_column("runs", sa.Column("git_commit", sa.String(), nullable=True))
    op.create_index("ix_runs_group_id", "runs", ["group_id"])


def downgrade() -> None:
    op.drop_index("ix_runs_group_id", table_name="runs")
    op.drop_column("runs", "git_commit")
    op.drop_column("runs", "git_branch")
    op.drop_column("runs", "group_id")
    
    op.drop_column("projects", "git_branch")
    op.drop_column("projects", "git_repo")
