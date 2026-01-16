"""init

Revision ID: 0001_init
Revises: 
Create Date: 2025-02-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "algos",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )

    op.create_table(
        "templates",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("default_config", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )

    op.create_table(
        "template_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("template_id", sa.String(), sa.ForeignKey("templates.id"), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("default_config", postgresql.JSONB(), nullable=True),
        sa.Column("network_template", postgresql.JSONB(), nullable=True),
        sa.Column("env_constraints", postgresql.JSONB(), nullable=True),
        sa.Column("wrappers", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_index("ix_template_versions_template_id", "template_versions", ["template_id"])

    op.create_table(
        "envs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("versions", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("maps", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
    )

    op.create_table(
        "env_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("env_id", sa.String(), sa.ForeignKey("envs.id"), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("api_mode", sa.String(), nullable=False),
        sa.Column("default_image_digest", sa.String(), nullable=True),
        sa.Column("map_sets", postgresql.JSONB(), nullable=True),
        sa.Column("scenario_schema", postgresql.JSONB(), nullable=True),
    )

    op.create_index("ix_env_versions_env_id", "env_versions", ["env_id"])

    op.create_table(
        "plugins",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("author", sa.String(), nullable=True),
        sa.Column("installed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_table(
        "plugin_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("plugin_id", sa.String(), sa.ForeignKey("plugins.id"), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("wheel_uri", sa.String(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("manifest", postgresql.JSONB(), nullable=True),
    )

    op.create_index("ix_plugin_versions_plugin_id", "plugin_versions", ["plugin_id"])

    op.create_table(
        "runs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("template_version_id", sa.String(), sa.ForeignKey("template_versions.id"), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("algo", sa.String(), nullable=False),
        sa.Column("env", sa.String(), nullable=False),
        sa.Column("duration", sa.String(), nullable=True),
        sa.Column("gpu", sa.Integer(), nullable=True),
        sa.Column("created", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("config", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("git", postgresql.JSONB(), nullable=True),
        sa.Column("metrics", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )

    op.create_index("ix_runs_project_id", "runs", ["project_id"])

    op.create_table(
        "jobs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("message", sa.Text(), nullable=True),
    )

    op.create_index("ix_jobs_run_id", "jobs", ["run_id"])

    op.create_table(
        "checkpoints",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("metrics", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_index("ix_checkpoints_run_id", "checkpoints", ["run_id"])

    op.create_table(
        "eval_protocols",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("env_id", sa.String(), nullable=False),
        sa.Column("env_version", sa.String(), nullable=True),
        sa.Column("map_set", sa.String(), nullable=True),
        sa.Column("eval_seeds", postgresql.ARRAY(sa.Integer()), nullable=False, server_default="{}"),
        sa.Column("episodes_per_match", sa.Integer(), nullable=False),
        sa.Column("timeout_sec", sa.Integer(), nullable=True),
        sa.Column("metrics", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("opponent_pool_id", sa.String(), nullable=True),
        sa.Column("opponent_pool_version", sa.String(), nullable=True),
        sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "opponent_pools",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("env", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("frozen", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "opponent_pool_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("pool_id", sa.String(), sa.ForeignKey("opponent_pools.id"), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_index("ix_opponent_pool_versions_pool_id", "opponent_pool_versions", ["pool_id"])

    op.create_table(
        "opponent_pool_members",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("pool_id", sa.String(), sa.ForeignKey("opponent_pools.id"), nullable=False),
        sa.Column("snapshot_id", sa.String(), nullable=False),
    )

    op.create_index("ix_opponent_pool_members_pool_id", "opponent_pool_members", ["pool_id"])

    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("size", sa.String(), nullable=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("last_modified", sa.String(), nullable=False),
        sa.Column("object_key", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_index("ix_artifacts_run_id", "artifacts", ["run_id"])

    op.create_table(
        "eval_results",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("run_id", sa.String(), sa.ForeignKey("runs.id"), nullable=True),
        sa.Column("protocol_id", sa.String(), nullable=False),
        sa.Column("metrics", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("artifact_url", sa.String(), nullable=True),
    )

    op.create_table(
        "matrix_results",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("protocol_id", sa.String(), nullable=True),
        sa.Column("pool_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("cells", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("summary", postgresql.JSONB(), nullable=True),
        sa.Column("export_url", sa.String(), nullable=True),
    )

    op.create_table(
        "webhooks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("url", sa.String(), nullable=False),
        sa.Column("events", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("secret", sa.String(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("webhooks")
    op.drop_table("matrix_results")
    op.drop_table("eval_results")
    op.drop_index("ix_artifacts_run_id", table_name="artifacts")
    op.drop_table("artifacts")
    op.drop_index("ix_opponent_pool_members_pool_id", table_name="opponent_pool_members")
    op.drop_table("opponent_pool_members")
    op.drop_index("ix_opponent_pool_versions_pool_id", table_name="opponent_pool_versions")
    op.drop_table("opponent_pool_versions")
    op.drop_table("opponent_pools")
    op.drop_table("eval_protocols")
    op.drop_index("ix_checkpoints_run_id", table_name="checkpoints")
    op.drop_table("checkpoints")
    op.drop_index("ix_jobs_run_id", table_name="jobs")
    op.drop_table("jobs")
    op.drop_index("ix_runs_project_id", table_name="runs")
    op.drop_table("runs")
    op.drop_index("ix_plugin_versions_plugin_id", table_name="plugin_versions")
    op.drop_table("plugin_versions")
    op.drop_table("plugins")
    op.drop_index("ix_env_versions_env_id", table_name="env_versions")
    op.drop_table("env_versions")
    op.drop_table("envs")
    op.drop_index("ix_template_versions_template_id", table_name="template_versions")
    op.drop_table("template_versions")
    op.drop_table("templates")
    op.drop_table("algos")
    op.drop_table("projects")
