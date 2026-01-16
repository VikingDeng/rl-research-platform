#!/bin/sh
set -e

echo "=== RL Platform: Startup Sequence ==="

# 1. Wait for Postgres to be ready
# We use a simple loop to check connection
until curl -s http://postgres:5432 || [ $? -eq 52 ]; do
  echo "Waiting for Postgres at postgres:5432..."
  sleep 2
done
echo "Postgres is up!"

# 2. Run Database Migrations
echo "Running alembic migrations..."
cd /app
alembic upgrade head

# 3. Seed Initial Data (Env, Algos, Templates)
echo "Seeding default data..."
# Run the seed logic from scripts/seed-full.sh 
# But wait, seed-full.sh is a shell script that wraps python. 
# Inside the container, we can just run the python part directly or use the script.
# Since we have the venv/dependencies in global python in container:
export PYTHONPATH=$PYTHONPATH:/app
/bin/sh /app/seed-full.sh

# 4. Start Services
echo "Starting TensorBoard and FastAPI..."
tensorboard --logdir /app/.local/runs --port 6006 --bind_all &
exec uvicorn app.main:app --host 0.0.0.0 --port 8000