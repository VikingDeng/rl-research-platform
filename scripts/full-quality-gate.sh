#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="full"
RUN_PYTEST=1
SKIP_COMPOSE=0
SKIP_FRONTEND=0
SKIP_BACKEND=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --quick) MODE="quick" ;;
    --full) MODE="full" ;;
    --skip-pytest) RUN_PYTEST=0 ;;
    --skip-compose) SKIP_COMPOSE=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --skip-backend) SKIP_BACKEND=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: scripts/full-quality-gate.sh [options]

Options:
  --quick        Run quick gate (no real-chain smoke)
  --full         Run full gate (includes real-chain smoke) [default]
  --skip-pytest  Skip backend regression pytest set
  --skip-compose Skip docker compose config validation
  --skip-frontend Skip frontend build validation
  --skip-backend Skip backend health smoke validation
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

run_compile_check() {
  if (
    cd "$ROOT_DIR" && \
    python3 -m compileall -q apps/portal-backend/app apps/portal-backend/runner
  ); then
    mark_pass "python compile check"
  else
    mark_fail "python compile check"
  fi
}

choose_pytest_python() {
  local candidates=()
  if [ -n "${BACKEND_PYTHON:-}" ] && [ -x "${BACKEND_PYTHON}" ]; then
    candidates+=("${BACKEND_PYTHON}")
  fi
  if [ -x "$ROOT_DIR/apps/portal-backend/.venv/bin/python3" ]; then
    candidates+=("$ROOT_DIR/apps/portal-backend/.venv/bin/python3")
  fi
  if [ -x "$HOME/miniconda3/envs/rl-platform/bin/python3" ]; then
    candidates+=("$HOME/miniconda3/envs/rl-platform/bin/python3")
  fi
  if command -v python3 >/dev/null 2>&1; then
    candidates+=("$(command -v python3)")
  fi

  local py
  for py in "${candidates[@]}"; do
    if "$py" - <<'PY' >/dev/null 2>&1
import importlib.util
import sys
required = ["pytest", "fastapi", "sqlalchemy", "pydantic", "alembic", "python_multipart"]
missing = [name for name in required if importlib.util.find_spec(name) is None]
sys.exit(1 if missing else 0)
PY
    then
      echo "$py"
      return 0
    fi
  done
  return 1
}

run_backend_pytest_regressions() {
  local py_bin
  if ! py_bin="$(choose_pytest_python)"; then
    mark_fail "backend regression pytest (python not found)"
    return
  fi

  if (
    cd "$ROOT_DIR/apps/portal-backend" && \
    USE_TESTCONTAINERS=false "$py_bin" -m pytest -q \
      tests/test_runner_integration.py::test_runner_integration \
      tests/test_platform_fixes.py::test_init_db_direct_sqlite_bootstrap_is_supported \
      tests/test_platform_fixes.py::test_artifact_manifest_written \
      tests/test_platform_fixes.py::test_matrix_materialization_includes_replay_payload
  ); then
    mark_pass "backend regression pytest"
  else
    mark_fail "backend regression pytest"
  fi
}

run_acceptance_gate() {
  local args=()
  if [ "$MODE" = "full" ]; then
    args+=(--with-real-chain)
  fi
  if [ "$SKIP_COMPOSE" -eq 1 ]; then
    args+=(--skip-compose)
  fi
  if [ "$SKIP_FRONTEND" -eq 1 ]; then
    args+=(--skip-frontend)
  fi
  if [ "$SKIP_BACKEND" -eq 1 ]; then
    args+=(--skip-backend)
  fi

  if (
    cd "$ROOT_DIR" && \
    ./scripts/acceptance-check.sh "${args[@]}"
  ); then
    mark_pass "acceptance gate (${MODE})"
  else
    mark_fail "acceptance gate (${MODE})"
  fi
}

echo "=== RL Platform Full Quality Gate ==="
echo "Root: $ROOT_DIR"
echo "Mode: $MODE"

run_compile_check
run_acceptance_gate

if [ "$RUN_PYTEST" -eq 1 ]; then
  run_backend_pytest_regressions
else
  echo "[SKIP] backend regression pytest"
fi

echo
echo "=== Quality Gate Summary ==="
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
