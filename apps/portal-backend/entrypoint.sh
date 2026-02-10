#!/bin/sh
set -e

echo "=== RL Platform: Startup Sequence ==="

APP_ROOT="/app"
BACKEND_DIR="$APP_ROOT/apps/portal-backend"
PYTHON_BIN="${BACKEND_PYTHON:-python}"

export PYTHONPATH="${PYTHONPATH:-$BACKEND_DIR}"
export BACKEND_DIR="${BACKEND_DIR}"
export FRONTEND_DIST="${FRONTEND_DIST:-$APP_ROOT/dist}"
export LOCAL_RUN_ROOT="${LOCAL_RUN_ROOT:-$APP_ROOT/.local/runs}"
# 使用绝对路径确保数据库文件位置一致
export DATABASE_URL="${DATABASE_URL:-sqlite:///$BACKEND_DIR/rl_platform.db}"
export BACKEND_PYTHON="$PYTHON_BIN"

mkdir -p "$LOCAL_RUN_ROOT" "$APP_ROOT/.local/artifacts"

# Wait for Postgres only when DATABASE_URL uses postgresql.
"$PYTHON_BIN" - <<'PY'
import os
import socket
import sys
import time
import urllib.parse

database_url = os.getenv("DATABASE_URL", "")
if not database_url.startswith("postgresql"):
    print("[entrypoint] DATABASE_URL is not PostgreSQL, skip DB host wait.")
    raise SystemExit(0)

parsed = urllib.parse.urlparse(database_url.replace("postgresql+psycopg2://", "postgresql://"))
host = parsed.hostname or "postgres"
port = parsed.port or 5432

for attempt in range(60):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2.0)
    try:
        sock.connect((host, port))
        print(f"[entrypoint] PostgreSQL reachable at {host}:{port}.")
        raise SystemExit(0)
    except OSError:
        time.sleep(2)
    finally:
        sock.close()

print(f"[entrypoint] PostgreSQL not reachable at {host}:{port}.")
raise SystemExit(1)
PY

echo "[entrypoint] Initializing database..."
if ! "$PYTHON_BIN" "$BACKEND_DIR/scripts/init_db_direct.py"; then
  echo "[entrypoint] ERROR: Database initialization failed!"
  exit 1
fi

if echo "$DATABASE_URL" | grep -q '^postgresql'; then
  echo "[entrypoint] Applying DB patches (v2)..."
  if ! "$PYTHON_BIN" "$BACKEND_DIR/scripts/patch_db_v2.py"; then
    echo "[entrypoint] WARNING: DB patch failed, continuing anyway..."
  fi
fi

# 验证数据库表是否存在
echo "[entrypoint] Verifying database tables..."
"$PYTHON_BIN" - <<'PY'
import os
import sys
from pathlib import Path

backend_dir = os.getenv("BACKEND_DIR", "/app/apps/portal-backend")
sys.path.insert(0, backend_dir)

# 确保使用相同的数据库 URL
database_url = os.getenv("DATABASE_URL", f"sqlite:///{backend_dir}/rl_platform.db")
print(f"[entrypoint] Database URL: {database_url}")

from app.db.session import engine
from sqlalchemy import inspect, text

# 检查数据库文件是否存在（对于 SQLite）
if database_url.startswith("sqlite"):
    db_path = database_url.replace("sqlite:///", "")
    if not Path(db_path).exists():
        print(f"[entrypoint] ERROR: Database file does not exist: {db_path}")
        sys.exit(1)
    print(f"[entrypoint] Database file exists: {db_path}")

inspector = inspect(engine)
tables = inspector.get_table_names()
print(f"[entrypoint] Found tables: {tables}")

required_tables = ["jobs", "runs", "projects", "algos", "env_specs"]
missing = [t for t in required_tables if t not in tables]

if missing:
    print(f"[entrypoint] ERROR: Missing required tables: {missing}")
    print(f"[entrypoint] Existing tables: {tables}")
    print(f"[entrypoint] Attempting to create missing tables...")
    
    # 尝试重新创建表
    from app.db.base import Base
    from app.db import models
    # 确保所有模型都被导入
    from app.db.models import (  # noqa: F401
        Project, Algo, AlgoVersion, EnvSpec, EnvVersion, Template, TemplateVersion,
        Run, Job, Checkpoint, Dataset, EvalProtocol, Plugin, PluginVersion,
        SystemSetting, OpponentPool, OpponentPoolVersion, OpponentPoolMember,
        Artifact, EvalResult, MatrixResult, Webhook, RegisteredModel, ModelVersion
    )
    
    print(f"[entrypoint] Registered tables in metadata: {list(Base.metadata.tables.keys())}")
    Base.metadata.create_all(bind=engine)
    
    # 再次检查
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    missing = [t for t in required_tables if t not in tables]
    
    if missing:
        print(f"[entrypoint] ERROR: Still missing tables after recreation: {missing}")
        sys.exit(1)
    else:
        print(f"[entrypoint] Successfully created missing tables. All tables: {tables}")
else:
    print(f"[entrypoint] Database verification passed. Found {len(tables)} tables.")
PY

if [ $? -ne 0 ]; then
  echo "[entrypoint] ERROR: Database verification failed!"
  exit 1
fi

echo "[entrypoint] Seeding defaults..."
/bin/sh "$APP_ROOT/scripts/seed-full.sh"

if [ "${SEED_MARL_ENVS:-0}" = "1" ]; then
  echo "[entrypoint] Seeding comprehensive MARL envs..."
  "$PYTHON_BIN" "$APP_ROOT/scripts/seed_marl_envs.py"
fi

if [ "${START_TENSORBOARD:-1}" = "1" ]; then
  echo "[entrypoint] Starting TensorBoard..."
  if command -v tensorboard >/dev/null 2>&1; then
    tensorboard --logdir "$LOCAL_RUN_ROOT" --port 6006 --bind_all &
  else
    echo "[entrypoint] tensorboard CLI not found; skipping."
  fi
fi

echo "[entrypoint] Starting FastAPI..."
cd "$BACKEND_DIR"
exec "$PYTHON_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-7860}"
