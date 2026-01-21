#!/bin/bash
set -e

# === RL Platform: User-Space Launcher ===
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"
export FRONTEND_DIST="$ROOT_DIR/dist"
export DISABLE_CSP="1"
RUNS_DIR="$ROOT_DIR/.local/runs"
NODE_DIR="$ROOT_DIR/.local/node"
# Using Node v20.19.0 (LTS) to satisfy Vite/React plugin engine requirements
NODE_VER="v20.19.0"
NODE_ROOT="$NODE_DIR/$NODE_VER"
NODE_DIST="node-$NODE_VER-linux-x64"

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}=== Starting RL Research Platform ===${NC}"

# 0. Ensure Frontend Build (User-Space Node)
if [ ! -f "$FRONTEND_DIST/index.html" ]; then
    echo -e "${GREEN}[0/4] Frontend build not found. Setting up User-Space Node.js...${NC}"
    
    # Check/Install Node
    if [ ! -d "$NODE_ROOT/bin" ]; then
        echo "Downloading Node.js $NODE_VER..."
        mkdir -p "$NODE_ROOT"
        curl -L "https://nodejs.org/dist/$NODE_VER/$NODE_DIST.tar.xz" | tar -xJ -C "$NODE_ROOT" --strip-components=1
    fi
    
    # Temporarily add to PATH
    export PATH="$NODE_ROOT/bin:$PATH"
    echo "Node version: $(node -v)"
    echo "NPM version: $(npm -v)"

    echo "Building Frontend..."
    cd "$ROOT_DIR"
    # Clean install to avoid version conflicts
    rm -rf node_modules
    
    # Prefer lockfile for reproducible builds
    if [ -f package-lock.json ]; then
        npm ci
    else
        npm install
    fi
    
    npm run build
    
    if [ ! -d "$FRONTEND_DIST" ]; then
        echo "Error: Build failed, dist directory not found."
        exit 1
    fi
    
    echo "Frontend built successfully at $FRONTEND_DIST"
else
    echo -e "${GREEN}[0/4] Frontend build found at $FRONTEND_DIST. Skipping build.${NC}"
fi

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
pip install "setuptools<66" wheel > /dev/null 2>&1
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
