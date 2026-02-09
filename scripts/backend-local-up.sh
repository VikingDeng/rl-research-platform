#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"
BACKEND_PORT="${BACKEND_PORT:-8000}"

if [ ! -d "$BACKEND_DIR" ]; then
  echo "Backend directory not found: $BACKEND_DIR"
  exit 1
fi

export FRONTEND_DIST="${FRONTEND_DIST:-$ROOT_DIR/dist}"
export DISABLE_CSP="${DISABLE_CSP:-1}"
export DATABASE_URL="${DATABASE_URL:-sqlite:///rl_platform.db}"
export DATABASE_FALLBACK_URL="${DATABASE_FALLBACK_URL:-sqlite:///$BACKEND_DIR/rl_platform.db}"
export LOCAL_EXECUTOR_MODE="${LOCAL_EXECUTOR_MODE:-mock}"
export DETERMINED_MOCK="${DETERMINED_MOCK:-1}"
export PYTHONPATH="$BACKEND_DIR"

python_has_backend_deps() {
  local py_bin="$1"
  "$py_bin" - <<'PY'
import importlib.util
import sys
required = ["fastapi", "sqlalchemy", "uvicorn", "pydantic", "alembic"]
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
    print("missing:" + ",".join(missing))
    sys.exit(1)
sys.exit(0)
PY
}

choose_python() {
  local candidates=()
  if [ -n "${BACKEND_PYTHON:-}" ]; then
    candidates+=("$BACKEND_PYTHON")
  fi
  candidates+=(
    "$BACKEND_DIR/.venv/bin/python3"
    "$HOME/miniconda3/envs/rl-platform/bin/python3"
  )
  if command -v python3 >/dev/null 2>&1; then
    candidates+=("$(command -v python3)")
  fi

  for py in "${candidates[@]}"; do
    if [ -x "$py" ] && python_has_backend_deps "$py" >/dev/null 2>&1; then
      echo "$py"
      return 0
    fi
  done
  return 1
}

PY_BIN="$(choose_python || true)"
if [ -z "$PY_BIN" ]; then
  echo "No Python interpreter with backend dependencies found."
  echo "Set BACKEND_PYTHON=/path/to/python (with fastapi/sqlalchemy/uvicorn/alembic installed)."
  exit 1
fi

echo "[backend-local-up] Using Python: $PY_BIN"
echo "[backend-local-up] DATABASE_URL=$DATABASE_URL"

cd "$BACKEND_DIR"

# Ensure schema + seed baseline env/algo records.
"$PY_BIN" scripts/init_db_direct.py

if [ "${SEED_MARL_ENVS:-0}" = "1" ]; then
  "$PY_BIN" scripts/seed_marl_envs.py
fi

exec "$PY_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT"
