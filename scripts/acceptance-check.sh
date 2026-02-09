#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.local/acceptance"
BACKEND_LOG="$LOG_DIR/backend.log"
BACKEND_PORT="${BACKEND_PORT:-18080}"
BACKEND_TIMEOUT_SEC="${BACKEND_TIMEOUT_SEC:-60}"

SKIP_COMPOSE=0
SKIP_FRONTEND=0
SKIP_BACKEND=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-compose) SKIP_COMPOSE=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --skip-backend) SKIP_BACKEND=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: scripts/acceptance-check.sh [options]

Options:
  --skip-compose   Skip docker compose config validation
  --skip-frontend  Skip frontend build validation
  --skip-backend   Skip backend health smoke test
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 2
      ;;
  esac
  shift
done

mkdir -p "$LOG_DIR"

PASSED=()
FAILED=()

mark_pass() {
  PASSED+=("$1")
  echo "[PASS] $1"
}

mark_fail() {
  FAILED+=("$1")
  echo "[FAIL] $1"
}

detect_compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  return 1
}

run_compose_config_check() {
  local compose_cmd
  if ! compose_cmd="$(detect_compose_cmd)"; then
    mark_fail "compose config check (docker compose not available)"
    return
  fi

  if (
    cd "$ROOT_DIR" && \
    $compose_cmd -f docker-compose.yml config -q && \
    $compose_cmd -f docker-compose.yml -f docker-compose.determined.yml config -q
  ); then
    mark_pass "compose config check"
  else
    mark_fail "compose config check"
  fi
}

run_frontend_build_check() {
  if ! command -v npm >/dev/null 2>&1; then
    mark_fail "frontend build check (npm not available)"
    return
  fi

  local npm_cache="$ROOT_DIR/.local/npm-cache"
  if (
    cd "$ROOT_DIR" && \
    mkdir -p "$npm_cache" && \
    (npm ci --no-audit --no-fund --cache "$npm_cache" || npm install --no-audit --no-fund --cache "$npm_cache") && \
    npm run build
  ); then
    mark_pass "frontend build check"
  else
    mark_fail "frontend build check"
  fi
}

backend_pid=""
cleanup_backend() {
  if [ -n "$backend_pid" ] && kill -0 "$backend_pid" >/dev/null 2>&1; then
    kill "$backend_pid" >/dev/null 2>&1 || true
    wait "$backend_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup_backend EXIT

run_backend_health_check() {
  if ! command -v curl >/dev/null 2>&1; then
    mark_fail "backend health check (curl not available)"
    return
  fi

  rm -f "$BACKEND_LOG"
  local db_path="$LOG_DIR/acceptance.db"
  rm -f "$db_path"

  (
    cd "$ROOT_DIR"
    BACKEND_PORT="$BACKEND_PORT" \
    DATABASE_URL="sqlite:///$db_path" \
    LOCAL_EXECUTOR_MODE="${LOCAL_EXECUTOR_MODE:-mock}" \
    DETERMINED_MOCK="${DETERMINED_MOCK:-1}" \
    SEED_MARL_ENVS="${SEED_MARL_ENVS:-0}" \
    FRONTEND_DIST="${FRONTEND_DIST:-$ROOT_DIR/dist}" \
    ./scripts/backend-local-up.sh
  ) >"$BACKEND_LOG" 2>&1 &
  backend_pid="$!"

  local i
  for i in $(seq 1 "$BACKEND_TIMEOUT_SEC"); do
    if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/healthz" >/dev/null 2>&1; then
      mark_pass "backend health check"
      cleanup_backend
      backend_pid=""
      return
    fi
    if ! kill -0 "$backend_pid" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  mark_fail "backend health check"
  echo "--- backend log tail ---"
  tail -n 80 "$BACKEND_LOG" || true
  echo "------------------------"
  cleanup_backend
  backend_pid=""
}

echo "=== RL Platform Acceptance Check ==="
echo "Root: $ROOT_DIR"

if [ "$SKIP_COMPOSE" -eq 0 ]; then
  run_compose_config_check
else
  echo "[SKIP] compose config check"
fi

if [ "$SKIP_FRONTEND" -eq 0 ]; then
  run_frontend_build_check
else
  echo "[SKIP] frontend build check"
fi

if [ "$SKIP_BACKEND" -eq 0 ]; then
  run_backend_health_check
else
  echo "[SKIP] backend health check"
fi

echo
echo "=== Acceptance Summary ==="
if [ "${#PASSED[@]}" -gt 0 ]; then
  for item in "${PASSED[@]}"; do
    echo "[PASS] $item"
  done
fi
if [ "${#FAILED[@]}" -gt 0 ]; then
  for item in "${FAILED[@]}"; do
    echo "[FAIL] $item"
  done
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  exit 1
fi

echo "All checks passed."
