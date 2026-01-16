#!/bin/sh
set -e

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script targets macOS. Use scripts/dev-linux-down.sh on Linux."
  exit 1
fi

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
MINIO_PID="$ROOT_DIR/.local/minio/minio.pid"

if [ -f "$MINIO_PID" ]; then
  PID=$(cat "$MINIO_PID")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "MinIO stopped (pid $PID)"
  fi
  rm -f "$MINIO_PID"
fi

echo "If you want to stop Postgres: brew services stop postgresql@16"
