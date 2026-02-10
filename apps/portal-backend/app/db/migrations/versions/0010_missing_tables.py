"""missing tables

Revision ID: 0010_missing_tables
Revises: 0009_eval_protocol_grid
Create Date: 2026-02-09 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0010_missing_tables"
down_revision = "0009_eval_protocol_grid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add missing columns to existing tables
    op.add_column("projects", sa.Column("git_repo", sa.String(), nullable=True))
    op.add_column("projects", sa.Column("git_branch", sa.String(), nullable=True, server_default="main"))
    
    op.add_column("runs", sa.Column("group_id", sa.String(), nullable=True))
    op.add_column("runs", sa.Column("git_branch", sa.String(), nullable=True))
    op.add_column("runs", sa.Column("git_commit", sa.String(), nullable=True))
    op.create_index("ix_runs_group_id", "runs", ["group_id"])

    # 2. datasets
    op.create_table(
        "datasets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("format", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # 3. registered_models
    op.create_table(
        "registered_models",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # 4. model_versions
    op.create_table(
        "model_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("model_id", sa.String(), sa.ForeignKey("registered_models.id"), nullable=False),
        sa.Column("checkpoint_id", sa.String(), sa.ForeignKey("checkpoints.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("stage", sa.String(), nullable=False, server_default="None"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_model_versions_model_id", "model_versions", ["model_id"])
    op.create_index("ix_model_versions_checkpoint_id", "model_versions", ["checkpoint_id"])


def downgrade() -> None:
    op.drop_index("ix_model_versions_checkpoint_id", table_name="model_versions")
    op.drop_index("ix_model_versions_model_id", table_name="model_versions")
    op.drop_table("model_versions")
    op.drop_table("registered_models")
    op.drop_table("datasets")
    
    op.drop_index("ix_runs_group_id", table_name="runs")
    op.drop_column("runs", "git_commit")
    op.drop_column("runs", "git_branch")
    op.drop_column("runs", "group_id")
    
    op.drop_column("projects", "git_branch")
    op.drop_column("projects", "git_repo")
