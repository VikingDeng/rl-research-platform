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
export DATABASE_URL="${DATABASE_URL:-sqlite:///rl_platform.db}"
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
"$PYTHON_BIN" "$BACKEND_DIR/scripts/init_db_direct.py"

echo "[entrypoint] Seeding defaults..."
/bin/sh "$APP_ROOT/scripts/seed-full.sh"

if [ "${SEED_MARL_ENVS:-0}" = "1" ]; then
  echo "[entrypoint] Seeding comprehensive MARL envs..."
  "$PYTHON_BIN" "$APP_ROOT/scripts/seed_marl_envs.py"
fi

if [ "${START_TENSORBOARD:-1}" = "1" ]; then
  echo "[entrypoint] Starting TensorBoard..."
  "$PYTHON_BIN" -m tensorboard --logdir "$LOCAL_RUN_ROOT" --port 6006 --bind_all &
fi

echo "[entrypoint] Starting FastAPI..."
cd "$BACKEND_DIR"
exec "$PYTHON_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
