"""add algo versions and template algo linkage

Revision ID: 0006_algo_versions
Revises: 0005_env_version_active
Create Date: 2026-01-15 18:20:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0006_algo_versions"
down_revision = "0005_env_version_active"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "algo_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("algo_id", sa.String(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("entrypoint", sa.String(), nullable=False),
        sa.Column("package", sa.String(), nullable=True),
        sa.Column("artifact_uri", sa.String(), nullable=True),
        sa.Column("config_schema", postgresql.JSONB(), nullable=True),
        sa.Column("default_config", postgresql.JSONB(), nullable=True),
        sa.Column("resource_profile", postgresql.JSONB(), nullable=True),
        sa.Column("env_constraints", postgresql.JSONB(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_algo_versions_algo_id", "algo_versions", ["algo_id"])
    op.create_foreign_key(
        "fk_algo_versions_algo_id",
        "algo_versions",
        "algos",
        ["algo_id"],
        ["id"],
    )
    op.alter_column("algo_versions", "active", server_default=None)

    op.add_column("template_versions", sa.Column("algo_version_id", sa.String(), nullable=True))
    op.create_index("ix_template_versions_algo_version_id", "template_versions", ["algo_version_id"])
    op.create_foreign_key(
        "fk_template_versions_algo_version_id",
        "template_versions",
        "algo_versions",
        ["algo_version_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_template_versions_algo_version_id", "template_versions", type_="foreignkey")
    op.drop_index("ix_template_versions_algo_version_id", table_name="template_versions")
    op.drop_column("template_versions", "algo_version_id")

    op.drop_constraint("fk_algo_versions_algo_id", "algo_versions", type_="foreignkey")
    op.drop_index("ix_algo_versions_algo_id", table_name="algo_versions")
    op.drop_table("algo_versions")
