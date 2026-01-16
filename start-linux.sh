#!/bin/bash
set -e

# === RL Platform: User-Space Launcher ===
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"
FRONTEND_DIST="$ROOT_DIR/apps/portal-frontend/dist"
RUNS_DIR="$ROOT_DIR/.local/runs"

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}=== Starting RL Research Platform ===${NC}"

# 1. Environment Setup
mkdir -p "$RUNS_DIR"
cd "$BACKEND_DIR"

if [ ! -z "$CONDA_DEFAULT_ENV" ]; then
    echo "Using existing Conda environment: $CONDA_DEFAULT_ENV"
else
    if [ ! -d ".venv" ]; then
        python3 -m venv .venv
    fi
    source .venv/bin/activate
fi

echo "Ensuring dependencies..."
pip install -r requirements.txt > /dev/null
pip install -r runner/requirements.txt tensorboard > /dev/null

# 2. Database Initialization & Seeding (Direct Python Logic)
echo -e "${GREEN}[2/4] Initializing Database & Seeding...${NC}"
export DATABASE_URL="sqlite:///rl_platform.db"
export PYTHONPATH=$BACKEND_DIR
# This one script now does EVERYTHING: Create tables + Seed data
python3 scripts/init_db_direct.py

# 3. Start TensorBoard
echo -e "${GREEN}[3/4] Starting TensorBoard...${NC}"
python3 -m tensorboard --logdir "$RUNS_DIR" --port 6006 --bind_all > "$ROOT_DIR/tensorboard.log" 2>&1 &
TB_PID=$!

# 4. Start Backend
echo -e "${GREEN}[4/4] Starting Backend & Frontend...${NC}"
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo -e "${GREEN}>>> Platform is Ready! http://localhost:8000 <<<${NC}"

cleanup() {
    kill $TB_PID $BACKEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM
wait