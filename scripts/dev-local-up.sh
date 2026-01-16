#!/bin/sh
set -e

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script targets macOS. Use scripts/dev-linux-up.sh on Linux."
  exit 1
fi

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"
LOCAL_DATA_DIR="$ROOT_DIR/.local"
MINIO_DIR="$LOCAL_DATA_DIR/minio"
MINIO_PID="$MINIO_DIR/minio.pid"

mkdir -p "$LOCAL_DATA_DIR"

if [ ! -d "$BACKEND_DIR" ]; then
  echo "Backend not found at $BACKEND_DIR"
  exit 1
fi

if command -v brew >/dev/null 2>&1; then
  if ! brew list --versions postgresql@16 >/dev/null 2>&1; then
    brew install postgresql@16
  fi
  if ! brew list --versions minio >/dev/null 2>&1; then
    brew tap minio/stable
    brew install minio/stable/minio
  fi
else
  echo "Homebrew not found. Please install Postgres 16 and MinIO manually."
  exit 1
fi

PG_BIN="$(brew --prefix postgresql@16)/bin"
export PATH="$PG_BIN:$PATH"

brew services start postgresql@16 >/dev/null 2>&1 || true

if [ -f "$BACKEND_DIR/.env" ]; then
  set -a
  . "$BACKEND_DIR/.env"
  set +a
fi

if [ -z "$DATABASE_URL" ]; then
  DATABASE_URL="postgresql+psycopg2://rl:rl@localhost:5432/rl_platform"
fi

DB_INFO=$(python3 - <<'PY'
import os
import urllib.parse

url = os.environ.get("DATABASE_URL", "postgresql+psycopg2://rl:rl@localhost:5432/rl_platform")
url = url.replace("postgresql+psycopg2://", "postgresql://")
parsed = urllib.parse.urlparse(url)
user = parsed.username or "rl"
password = parsed.password or "rl"
host = parsed.hostname or "localhost"
port = parsed.port or 5432
db = (parsed.path or "/rl_platform").lstrip("/")
print("|".join([user, password, host, str(port), db]))
PY
)

IFS='|' read -r DB_USER DB_PASS DB_HOST DB_PORT DB_NAME <<EOF
$DB_INFO
EOF

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
  echo "Postgres is not ready on $DB_HOST:$DB_PORT"
  exit 1
fi

ROLE_EXISTS=$("$PG_BIN/psql" -h "$DB_HOST" -p "$DB_PORT" -tAc "select 1 from pg_roles where rolname='${DB_USER}';" postgres || true)
if [ "$ROLE_EXISTS" != "1" ]; then
  "$PG_BIN/createuser" -h "$DB_HOST" -p "$DB_PORT" -s "$DB_USER"
fi

"$PG_BIN/psql" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "alter user ${DB_USER} with password '${DB_PASS}';" >/dev/null

DB_EXISTS=$("$PG_BIN/psql" -h "$DB_HOST" -p "$DB_PORT" -tAc "select 1 from pg_database where datname='${DB_NAME}';" postgres || true)
if [ "$DB_EXISTS" != "1" ]; then
  "$PG_BIN/createdb" -h "$DB_HOST" -p "$DB_PORT" -O "$DB_USER" "$DB_NAME"
fi

mkdir -p "$MINIO_DIR"
if [ -f "$MINIO_PID" ]; then
  if kill -0 "$(cat "$MINIO_PID")" 2>/dev/null; then
    echo "MinIO already running (pid $(cat "$MINIO_PID"))"
  else
    rm -f "$MINIO_PID"
  fi
fi

if [ ! -f "$MINIO_PID" ]; then
  MINIO_ROOT_USER="${S3_ACCESS_KEY:-minioadmin}" \
  MINIO_ROOT_PASSWORD="${S3_SECRET_KEY:-minioadmin}" \
  nohup minio server "$MINIO_DIR/data" --console-address ":9001" > "$MINIO_DIR/minio.log" 2>&1 &
  echo $! > "$MINIO_PID"
  echo "MinIO started (pid $(cat "$MINIO_PID"))"
fi

cd "$BACKEND_DIR"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

. .venv/bin/activate
python -m pip install -r requirements.txt

alembic upgrade head

exec python -m uvicorn app.main:app --reload --port 8000
