#!/bin/sh
set -e

python - <<'PY'
import os
import time
import psycopg2

url = os.environ.get("DATABASE_URL")
if not url:
    raise SystemExit("DATABASE_URL not set")

max_attempts = 30
for attempt in range(1, max_attempts + 1):
    try:
        conn = psycopg2.connect(url.replace("postgresql+psycopg2://", "postgresql://"))
        conn.close()
        break
    except Exception:
        if attempt == max_attempts:
            raise
        time.sleep(1)
PY

alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
