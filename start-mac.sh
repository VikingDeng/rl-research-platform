#!/bin/bash
set -e

if [ "$(uname -s)" != "Darwin" ]; then
    echo "This script targets macOS."
    exit 1
fi

# === RL Platform: User-Space Launcher (macOS) ===
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"
export FRONTEND_DIST="$ROOT_DIR/dist"
export DISABLE_CSP="1"
export LOCAL_EXECUTOR_MODE="real"
export DETERMINED_MOCK="0"
export RUNTIME_AUTO_INSTALL="1"
SETUP_DIR="$ROOT_DIR/.local/setup"
EXTRAS_MARKER="$SETUP_DIR/rl_extras_installed"
ORBIT_MARKER="$SETUP_DIR/orbitzoo_installed"
ORBIT_PY_FILE="$SETUP_DIR/orbitzoo_python"
ORBIT_OREKIT_FILE="$SETUP_DIR/orbitzoo_orekit_path"
ORBIT_OREKIT_ZIP_FILE="$SETUP_DIR/orbitzoo_orekit_zip"
OREKIT_CACHE="$ROOT_DIR/.local/orbitzoo/orekit-data.zip"
ORBITZOO_ROOT="$ROOT_DIR/.local/orbitzoo"
ORBITZOO_REPO_DEFAULT="$ORBITZOO_ROOT/orbit_zoo"
ORBITZOO_GIT_URL_DEFAULT="https://github.com/orbitzoo/orbit_zoo.git"
ORBITZOO_OREKIT_DIR_DEFAULT="$ORBITZOO_ROOT/orekit-data"
MINICONDA_ROOT="$ROOT_DIR/.local/miniconda"
RUNS_DIR="$ROOT_DIR/.local/runs"
NODE_DIR="$ROOT_DIR/.local/node"
NODE_VER="v20.19.0"
NODE_ROOT="$NODE_DIR/$NODE_VER"
SEED_MARL_ENVS="${SEED_MARL_ENVS:-1}"
RUN_TESTS="${RUN_TESTS:-1}"

ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
    NODE_DIST="node-$NODE_VER-darwin-arm64"
    MINICONDA_DIST="Miniconda3-latest-MacOSX-arm64.sh"
else
    NODE_DIST="node-$NODE_VER-darwin-x64"
    MINICONDA_DIST="Miniconda3-latest-MacOSX-x86_64.sh"
fi

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}=== Starting RL Research Platform (macOS) ===${NC}"

# 0. Ensure Frontend Build (User-Space Node)
if [ ! -f "$FRONTEND_DIST/index.html" ] || [ -z "$(ls -A $FRONTEND_DIST/assets 2>/dev/null)" ]; then
    echo -e "${GREEN}[0/4] Frontend build invalid or missing. Setting up User-Space Node.js...${NC}"

    if [ ! -d "$NODE_ROOT/bin" ]; then
        echo "Downloading Node.js $NODE_VER..."
        mkdir -p "$NODE_ROOT"
        curl -L "https://nodejs.org/dist/$NODE_VER/$NODE_DIST.tar.gz" | tar -xz -C "$NODE_ROOT" --strip-components=1
    fi

    export PATH="$NODE_ROOT/bin:$PATH"
    echo "Node version: $(node -v)"
    echo "NPM version: $(npm -v)"

    echo "Building Frontend..."
    cd "$ROOT_DIR"
    rm -rf node_modules
    if [ -f package-lock.json ]; then
        npm ci
    else
        npm install
    fi
    echo "Generating OpenAPI client..."
    npx openapi-typescript docs/openapi_v1.yaml -o apps/portal-frontend/src/api/generated/types.ts
    npx openapi-typescript-codegen --input docs/openapi_v1.yaml --output apps/portal-frontend/src/api/generated --client fetch
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
mkdir -p "$SETUP_DIR"
cd "$BACKEND_DIR"

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate

echo "Ensuring dependencies..."
pip install "setuptools<66" wheel > /dev/null 2>&1
pip install "gym==0.26.2" > /dev/null 2>&1
pip install --no-build-isolation -c ../../constraints.txt -r requirements.txt > /dev/null
pip install --no-build-isolation -c ../../constraints.txt "python-multipart==0.0.13" > /dev/null
pip install --no-build-isolation -c ../../constraints.txt -r runner/requirements.txt tensorboard > /dev/null

echo "Installing Ray RLLib (No Deps mode)..."
pip install --no-deps "ray[rllib]>=2.9.0" "dm-tree" "lz4" "scipy" "typer" > /dev/null

# 1.5 Ensure conda (auto-install Miniconda if missing)
if ! command -v conda >/dev/null 2>&1; then
    if [ ! -x "$MINICONDA_ROOT/bin/conda" ]; then
        echo -e "${GREEN}[1.5/4] Installing Miniconda (user-space)...${NC}"
        curl -L "https://repo.anaconda.com/miniconda/$MINICONDA_DIST" -o "$SETUP_DIR/miniconda.sh"
        bash "$SETUP_DIR/miniconda.sh" -b -p "$MINICONDA_ROOT"
        rm -f "$SETUP_DIR/miniconda.sh"
    fi
    export PATH="$MINICONDA_ROOT/bin:$PATH"
fi

# 1.6 Prepare OrbitZoo repo + orekit data (one-time)
if [ ! -f "$ORBIT_MARKER" ]; then
    export ORBITZOO_REPO="${ORBITZOO_REPO:-$ORBITZOO_REPO_DEFAULT}"
    export ORBITZOO_GIT_URL="${ORBITZOO_GIT_URL:-$ORBITZOO_GIT_URL_DEFAULT}"
    mkdir -p "$ORBITZOO_ROOT"
    if [ ! -d "$ORBITZOO_REPO/.git" ]; then
        if ! command -v git >/dev/null 2>&1; then
            echo "git is required to clone OrbitZoo. Please install git and re-run."
            exit 1
        fi
        echo -e "${GREEN}[1.6/4] Cloning OrbitZoo...${NC}"
        git clone "$ORBITZOO_GIT_URL" "$ORBITZOO_REPO"
    fi
    export ORBITZOO_OREKIT_DATA_ZIP="${ORBITZOO_OREKIT_DATA_ZIP:-$OREKIT_CACHE}"
    if [ ! -f "$ORBITZOO_OREKIT_DATA_ZIP" ]; then
        echo -e "${GREEN}[1.6/4] Downloading orekit-data.zip...${NC}"
        curl -fL "https://gitlab.orekit.org/orekit/orekit-data/-/archive/main/orekit-data-main.zip" -o "$ORBITZOO_OREKIT_DATA_ZIP" \
          || curl -fL "https://gitlab.orekit.org/orekit/orekit-data/-/archive/master/orekit-data-master.zip" -o "$ORBITZOO_OREKIT_DATA_ZIP" \
          || { echo "Failed to download orekit-data.zip. Please check network or set ORBITZOO_OREKIT_DATA_ZIP."; exit 1; }
    fi
    echo -e "${GREEN}[1.6/4] Installing OrbitZoo runtime...${NC}"
    /bin/sh "$ROOT_DIR/scripts/install-orbitzoo.sh"
    touch "$ORBIT_MARKER"
else
    echo -e "${GREEN}[1.6/4] OrbitZoo runtime already installed. Skipping.${NC}"
    if [ -z "$ORBITZOO_OREKIT_DATA_ZIP" ] && [ -f "$OREKIT_CACHE" ]; then
        export ORBITZOO_OREKIT_DATA_ZIP="$OREKIT_CACHE"
    fi
    export ORBITZOO_REPO="${ORBITZOO_REPO:-$ORBITZOO_REPO_DEFAULT}"
fi

if [ -f "$ORBIT_PY_FILE" ]; then
    export RUNNER_PYTHON="$(cat "$ORBIT_PY_FILE")"
fi
if [ -f "$ORBIT_OREKIT_FILE" ]; then
    export ORBITZOO_OREKIT_DATA_DIR="$(cat "$ORBIT_OREKIT_FILE")"
fi
if [ -f "$ORBIT_OREKIT_ZIP_FILE" ]; then
    export ORBITZOO_OREKIT_DATA_ZIP="$(cat "$ORBIT_OREKIT_ZIP_FILE")"
fi

export ORBITZOO_OREKIT_DATA_DIR="${ORBITZOO_OREKIT_DATA_DIR:-$ORBITZOO_OREKIT_DIR_DEFAULT}"
export OREKIT_DATA_PATH="${OREKIT_DATA_PATH:-$ORBITZOO_OREKIT_DATA_DIR}"

# 1.7 Install extra environments into runner python (one-time)
if [ ! -f "$EXTRAS_MARKER" ]; then
    echo -e "${GREEN}[1.7/4] Installing RL environment extras...${NC}"
    RL_EXTRAS_PYTHON="${RUNNER_PYTHON:-}" /bin/sh "$ROOT_DIR/scripts/install-rl-extras.sh"
    touch "$EXTRAS_MARKER"
else
    echo -e "${GREEN}[1.7/4] RL extras already installed. Skipping.${NC}"
fi

# 2. Database Initialization & Seeding
echo -e "${GREEN}[2/4] Initializing Database & Seeding...${NC}"
export DATABASE_URL="sqlite:///rl_platform.db"
export PYTHONPATH=$BACKEND_DIR
python3 scripts/init_db_direct.py

echo -e "${GREEN}[2.1/4] Seeding Default Envs & Algos...${NC}"
/bin/sh "$ROOT_DIR/scripts/seed-full.sh"

if [ "$SEED_MARL_ENVS" = "1" ]; then
    echo -e "${GREEN}[2.2/4] Seeding Comprehensive MARL Envs...${NC}"
    python3 scripts/seed_marl_envs.py
else
    echo -e "${GREEN}[2.2/4] Skipping MARL env seed (SEED_MARL_ENVS=0).${NC}"
fi

if [ "$RUN_TESTS" = "1" ]; then
    echo -e "${GREEN}[2.3/4] Running Backend Tests...${NC}"
    PYTHONPATH="$BACKEND_DIR" pytest -q
else
    echo -e "${GREEN}[2.3/4] Skipping backend tests (RUN_TESTS=0).${NC}"
fi

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
