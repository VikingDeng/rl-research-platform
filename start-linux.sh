#!/bin/bash
set -e

# Get the directory of the script
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"
FRONTEND_DIR="$ROOT_DIR"
RUNS_DIR="$ROOT_DIR/.local/runs"

# Ensure runs directory exists for TensorBoard
mkdir -p "$RUNS_DIR"

echo "=== RL Research Platform: Linux Start Script ==="

# Trap SIGINT and SIGTERM to kill all background processes
cleanup() {
    echo ""
    echo "Stopping all services..."
    if [ ! -z "$TB_PID" ]; then kill $TB_PID; fi
    if [ ! -z "$BACKEND_PID" ]; then kill $BACKEND_PID; fi
    exit 0
}
trap cleanup SIGINT SIGTERM

# 1. Setup Backend Environment
echo "[1/3] Setting up Backend..."
cd "$BACKEND_DIR"
if [ ! -d ".venv" ]; then
    echo "Creating python virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
else
    source .venv/bin/activate
fi

# 2. Start TensorBoard (Background)
echo "[2/3] Starting TensorBoard on port 6006..."
tensorboard --logdir "$RUNS_DIR" --port 6006 --bind_all &
TB_PID=$!
echo "TensorBoard running at http://localhost:6006 (PID: $TB_PID)"

# 3. Start Backend (Background)
echo "[3/3] Starting Backend on 0.0.0.0:8000..."
# Use uvicorn directly
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "Backend running at http://localhost:8000 (PID: $BACKEND_PID)"

# 4. Start Frontend (Foreground)
echo "Starting Frontend..."
cd "$FRONTEND_DIR"
# Assuming 'npm install' has been run.
# We use 'npm run dev' and bind to 0.0.0.0 to allow remote access
# Make sure vite.config.ts has server: { host: true } or pass --host
npm run dev -- --host

# Wait for frontend to exit (this keeps the script running)
wait