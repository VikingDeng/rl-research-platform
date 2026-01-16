"""registry governance fields and template project scope

Revision ID: 0007_registry_governance
Revises: 0006_algo_versions
Create Date: 2026-01-15 19:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_registry_governance"
down_revision = "0006_algo_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("algos", sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("algo_versions", sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("envs", sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("env_versions", sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("templates", sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("template_versions", sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("plugins", sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("plugin_versions", sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.false()))

    op.execute(
        "INSERT INTO projects (id, name, description, tags, created_at, updated_at) "
        "SELECT 'system', 'System', 'System generated runs', ARRAY['system'], now(), now() "
        "WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id='system');"
    )
    op.add_column(
        "templates",
        sa.Column("project_id", sa.String(), nullable=False, server_default="system"),
    )
    op.create_index("ix_templates_project_id", "templates", ["project_id"])
    op.create_foreign_key(
        "fk_templates_project_id",
        "templates",
        "projects",
        ["project_id"],
        ["id"],
    )
    op.execute("UPDATE templates SET project_id='system' WHERE project_id IS NULL;")

    op.alter_column("algos", "archived", server_default=None)
    op.alter_column("algo_versions", "frozen", server_default=None)
    op.alter_column("envs", "archived", server_default=None)
    op.alter_column("env_versions", "frozen", server_default=None)
    op.alter_column("templates", "archived", server_default=None)
    op.alter_column("template_versions", "frozen", server_default=None)
    op.alter_column("plugins", "archived", server_default=None)
    op.alter_column("plugin_versions", "frozen", server_default=None)
    op.alter_column("templates", "project_id", server_default=None)


def downgrade() -> None:
    op.drop_constraint("fk_templates_project_id", "templates", type_="foreignkey")
    op.drop_index("ix_templates_project_id", table_name="templates")
    op.drop_column("templates", "project_id")

    op.drop_column("plugin_versions", "frozen")
    op.drop_column("plugins", "archived")
    op.drop_column("template_versions", "frozen")
    op.drop_column("templates", "archived")
    op.drop_column("env_versions", "frozen")
    op.drop_column("envs", "archived")
    op.drop_column("algo_versions", "frozen")
    op.drop_column("algos", "archived")
