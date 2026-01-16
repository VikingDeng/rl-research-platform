#!/bin/bash
set -e

# === RL Platform: User-Space Launcher (No Docker/Sudo) ===
# Prerequisite: You MUST build the frontend locally and upload the 'dist' folder!
# Run 'npm run build' in 'apps/portal-frontend' on your local machine first.

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"
FRONTEND_DIST="$ROOT_DIR/apps/portal-frontend/dist"
RUNS_DIR="$ROOT_DIR/.local/runs"

# Colors
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}=== Starting RL Research Platform (User Mode) ===${NC}"

# 0. Check for Frontend Build
if [ ! -d "$FRONTEND_DIST" ]; then
    echo "Error: Frontend build not found at $FRONTEND_DIST"
    echo "Please run 'npm run build' locally and upload the 'dist' folder."
    exit 1
fi

# 1. Setup Python Environment
echo -e "${GREEN}[1/4] Setting up Python Virtual Environment...${NC}"
mkdir -p "$RUNS_DIR"
cd "$BACKEND_DIR"

if [ ! -d ".venv" ]; then
    echo "Creating .venv..."
    python3 -m venv .venv
    source .venv/bin/activate
    echo "Installing dependencies (this may take a while)..."
    pip install -r requirements.txt
    pip install -r runner/requirements.txt tensorboard
else
    source .venv/bin/activate
fi

# 2. Database & Seeding (Using SQLite for User Mode)
echo -e "${GREEN}[2/4] Initializing Database...${NC}"
export DATABASE_URL="sqlite:///$ROOT_DIR/rl_platform.db"

# Run Migrations using python3 -m to ensure it finds the venv's alembic
python3 -m alembic upgrade head

# Run Seed
export PYTHONPATH=$BACKEND_DIR
python3 runner/scripts/patch_db.py || python3 -c "from scripts.seed_full import seed; seed()" || echo "Seed skipped or failed."

# 3. Start TensorBoard
echo -e "${GREEN}[3/4] Starting TensorBoard...${NC}"
python3 -m tensorboard --logdir "$RUNS_DIR" --port 6006 --bind_all > "$ROOT_DIR/tensorboard.log" 2>&1 &
TB_PID=$!
echo "TensorBoard running on port 6006 (PID: $TB_PID)"

# 4. Start Backend (Hosting Frontend)
echo -e "${GREEN}[4/4] Starting Backend & Frontend...${NC}"
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo -e "${GREEN}>>> Platform is Ready! <<<${NC}"
echo "Web UI: http://<your-ip>:8000"
echo "TensorBoard: http://<your-ip>:6006"
echo "Press Ctrl+C to stop."

cleanup() {
    echo "Stopping services..."
    kill $TB_PID
    kill $BACKEND_PID
    exit 0
}
trap cleanup SIGINT SIGTERM

wait
