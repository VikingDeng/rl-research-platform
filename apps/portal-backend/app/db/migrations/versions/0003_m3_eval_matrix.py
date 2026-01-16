"""m3 eval protocol versioning and matrix fields

Revision ID: 0003_m3_eval_matrix
Revises: 0002_job_executor
Create Date: 2025-02-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_m3_eval_matrix"
down_revision = "0002_job_executor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("eval_protocols", sa.Column("protocol_key", sa.String(), nullable=True))
    op.add_column("eval_protocols", sa.Column("version", sa.String(), nullable=True, server_default="1.0.0"))
    op.execute("UPDATE eval_protocols SET protocol_key = id WHERE protocol_key IS NULL")
    op.execute("UPDATE eval_protocols SET version = '1.0.0' WHERE version IS NULL")
    op.alter_column("eval_protocols", "protocol_key", nullable=False)
    op.alter_column("eval_protocols", "version", nullable=False, server_default=None)
    op.create_index("ix_eval_protocols_protocol_key", "eval_protocols", ["protocol_key"])

    op.add_column("opponent_pools", sa.Column("pool_key", sa.String(), nullable=True))
    op.execute("UPDATE opponent_pools SET pool_key = id WHERE pool_key IS NULL")
    op.alter_column("opponent_pools", "pool_key", nullable=False)
    op.create_index("ix_opponent_pools_pool_key", "opponent_pools", ["pool_key"])

    op.add_column("eval_results", sa.Column("summary", postgresql.JSONB(), nullable=True))
    op.add_column("eval_results", sa.Column("ci", postgresql.JSONB(), nullable=True))

    op.add_column("matrix_results", sa.Column("labels", postgresql.ARRAY(sa.String()), nullable=True))
    op.add_column("matrix_results", sa.Column("matrix", postgresql.JSONB(), nullable=True))
    op.add_column("matrix_results", sa.Column("ranking", postgresql.JSONB(), nullable=True))
    op.add_column("matrix_results", sa.Column("meta", postgresql.JSONB(), nullable=True))
    op.add_column("matrix_results", sa.Column("artifacts", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("matrix_results", "artifacts")
    op.drop_column("matrix_results", "meta")
    op.drop_column("matrix_results", "ranking")
    op.drop_column("matrix_results", "matrix")
    op.drop_column("matrix_results", "labels")

    op.drop_column("eval_results", "ci")
    op.drop_column("eval_results", "summary")

    op.drop_index("ix_opponent_pools_pool_key", table_name="opponent_pools")
    op.drop_column("opponent_pools", "pool_key")

    op.drop_index("ix_eval_protocols_protocol_key", table_name="eval_protocols")
    op.drop_column("eval_protocols", "version")
    op.drop_column("eval_protocols", "protocol_key")
