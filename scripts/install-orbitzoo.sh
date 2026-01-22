#!/bin/sh
set -e

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"
RUNNER_REQ="$BACKEND_DIR/runner/requirements.txt"
SETUP_DIR="$ROOT_DIR/.local/setup"
OREKIT_DIR="$ROOT_DIR/.local/orbitzoo"

if ! command -v conda >/dev/null 2>&1; then
  echo "conda not found. Install Anaconda/Miniconda first."
  exit 1
fi

ENV_NAME="${ORBITZOO_ENV:-orbit_zoo}"

if conda env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
  echo "Conda env $ENV_NAME already exists. Reusing."
else
  echo "Creating conda env: $ENV_NAME"
  conda create -y -n "$ENV_NAME" python=3.10 numpy=1.24.4 orekit=12.2 pettingzoo=1.24.3 pygame=2.6.0 -c conda-forge
fi

echo "Activating conda env: $ENV_NAME"
# shellcheck disable=SC1091
. "$(conda info --base)/etc/profile.d/conda.sh"
conda activate "$ENV_NAME"

TORCH_SPEC="${ORBITZOO_TORCH_SPEC:-torch==2.4.1+cu121 torchvision torchaudio}"
TORCH_INDEX="${ORBITZOO_TORCH_INDEX:-https://download.pytorch.org/whl/cu121}"
echo "Installing torch: $TORCH_SPEC"
if [ -n "$TORCH_INDEX" ]; then
  pip install $TORCH_SPEC --index-url "$TORCH_INDEX"
else
  pip install $TORCH_SPEC
fi

echo "Installing play3d"
pip install play3d==0.1.5

echo "Installing runner requirements inside OrbitZoo env"
pip install -r "$RUNNER_REQ"
pip install --no-deps "ray[rllib]==2.9.0" "dm-tree" "lz4" "scipy" "typer"

if [ -n "$ORBITZOO_REPO" ]; then
  echo "Installing OrbitZoo from $ORBITZOO_REPO"
  if [ -f "$ORBITZOO_REPO/setup.py" ] || [ -f "$ORBITZOO_REPO/pyproject.toml" ]; then
    pip install -e "$ORBITZOO_REPO"
  else
    echo "OrbitZoo repo has no setup.py/pyproject.toml. Falling back to .pth path injection."
    python - <<'PY'
import os
from pathlib import Path
import site

repo = Path(os.environ.get("ORBITZOO_REPO", "")).resolve()
if not repo.exists():
    raise SystemExit(f"ORBITZOO_REPO not found: {repo}")

candidate = repo / "src"
target_path = candidate if candidate.exists() else repo
site_dir = Path(site.getsitepackages()[0])
site_dir.mkdir(parents=True, exist_ok=True)
pth_file = site_dir / "orbitzoo.pth"
pth_file.write_text(str(target_path) + "\n", encoding="utf-8")
print(f"[OrbitZoo] Added {target_path} to {pth_file}")
PY
  fi
else
  echo "ORBITZOO_REPO not set. Export it to your OrbitZoo repo path."
  exit 1
fi

if [ -z "$ORBITZOO_OREKIT_DATA_ZIP" ]; then
  echo "ORBITZOO_OREKIT_DATA_ZIP not set. Provide the orekit-data.zip path."
  exit 1
fi
if [ ! -f "$ORBITZOO_OREKIT_DATA_ZIP" ]; then
  echo "orekit-data.zip not found at $ORBITZOO_OREKIT_DATA_ZIP"
  exit 1
fi

mkdir -p "$OREKIT_DIR"
cp -f "$ORBITZOO_OREKIT_DATA_ZIP" "$OREKIT_DIR/orekit-data.zip"
if command -v unzip >/dev/null 2>&1; then
  unzip -o "$OREKIT_DIR/orekit-data.zip" -d "$OREKIT_DIR/orekit-data" >/dev/null
else
  ORBITZOO_ROOT_PATH="$OREKIT_DIR" python - <<'PY'
import os
import zipfile
from pathlib import Path
root = Path(os.environ.get("ORBITZOO_ROOT_PATH", "."))
zip_path = root / "orekit-data.zip"
dest = root / "orekit-data"
dest.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(zip_path, "r") as zf:
    zf.extractall(dest)
PY
fi

python - <<'PY'
import importlib
ok = False
for name in ("orbitzoo", "orbit_zoo"):
    try:
        importlib.import_module(name)
        ok = True
        break
    except Exception:
        pass
if not ok:
    raise SystemExit("OrbitZoo import failed after installation.")
PY

mkdir -p "$SETUP_DIR"
python -c "import sys; print(sys.executable)" > "$SETUP_DIR/orbitzoo_python"

echo "OrbitZoo setup complete. orekit-data.zip cached at $OREKIT_DIR/orekit-data.zip"
