#!/bin/sh
set -e

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"
RUNNER_REQ="$BACKEND_DIR/runner/requirements.txt"
SETUP_DIR="$ROOT_DIR/.local/setup"
OREKIT_DIR="$ROOT_DIR/.local/orbitzoo"
OREKIT_PATH_FILE="$SETUP_DIR/orbitzoo_orekit_path"
OREKIT_ZIP_FILE="$SETUP_DIR/orbitzoo_orekit_zip"

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

echo "Installing OrbitZoo extra deps"
pip install tensorboardX
pip install "msgpack<2.0.0" shellingham

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

override = os.environ.get("ORBITZOO_PY_PATH")
candidate = repo / "src"
target_path = None
if override:
    target_path = Path(override).resolve()
elif candidate.exists():
    # Prefer src only if it contains a real package (dir with __init__.py)
    pkg_dirs = [p for p in candidate.iterdir() if p.is_dir() and (p / "__init__.py").exists()]
    if pkg_dirs:
        target_path = candidate
    else:
        target_path = repo
else:
    target_path = repo

if not target_path.exists():
    raise SystemExit(f"ORBITZOO_PY_PATH not found: {target_path}")

site_dir = Path(site.getsitepackages()[0])
site_dir.mkdir(parents=True, exist_ok=True)
pth_file = site_dir / "orbitzoo.pth"

existing = []
if pth_file.exists():
    existing = [line.strip() for line in pth_file.read_text(encoding="utf-8").splitlines() if line.strip()]

if str(target_path) not in existing:
    existing.append(str(target_path))
    pth_file.write_text("\n".join(existing) + "\n", encoding="utf-8")
    print(f"[OrbitZoo] Added {target_path} to {pth_file}")
else:
    print(f"[OrbitZoo] Path already present in {pth_file}")
PY
    python - <<'PY'
import os
from pathlib import Path
import site
import textwrap
import importlib

repo = Path(os.environ.get("ORBITZOO_REPO", "")).resolve()
site_dir = Path(site.getsitepackages()[0])
site_dir.mkdir(parents=True, exist_ok=True)

def _import_ok(name: str) -> bool:
    try:
        importlib.import_module(name)
        return True
    except Exception:
        return False

def _write_shim(module_name: str, repo_path: Path) -> None:
    shim_path = site_dir / f"{module_name}.py"
    shim_code = f"""
# Auto-generated OrbitZoo shim
import importlib.util
import sys
import os
from pathlib import Path

REPO_PATH = Path(r\"{repo_path}\").resolve()
SRC_PATH = REPO_PATH / \"src\"

def _setup_orekit():
    try:
        import orekit  # type: ignore
        try:
            orekit.initVM()
        except Exception:
            pass
        try:
            from orekit import pyhelpers as _pyhelpers  # type: ignore
        except Exception:
            _pyhelpers = None
        data_dir = os.environ.get(\"ORBITZOO_OREKIT_DATA_DIR\") or os.environ.get(\"OREKIT_DATA_PATH\")
        data_zip = os.environ.get(\"ORBITZOO_OREKIT_DATA_ZIP\")
        if not data_zip:
            for candidate in (
                REPO_PATH.parent / \"orekit-data.zip\",
                REPO_PATH.parent / \"orekit-data\" / \"orekit-data.zip\",
            ):
                if candidate.exists():
                    data_zip = str(candidate)
                    break
        def _looks_like_data(root: Path) -> bool:
            # Require EOP + UTC-TAI history (fixes IERS UTC-TAI missing errors)
            if not (root / \"Earth-Orientation-Parameters\").exists():
                return False
            for candidate in root.rglob(\"UTC-TAI.history\"):
                if candidate.is_file():
                    return True
            return False

        def _find_data(root: Path):
            if not root.exists():
                return None
            if _looks_like_data(root):
                return root
            # walk a few levels for a folder containing required dirs
            for candidate in root.rglob(\"Earth-Orientation-Parameters\"):
                parent = candidate.parent
                if _looks_like_data(parent):
                    return parent
            return None

        if not data_dir:
            default_root = REPO_PATH.parent / \"orekit-data\"
            found = _find_data(default_root)
            if found:
                data_dir = str(found)
        resolved_path = None
        if data_dir:
            data_path = Path(data_dir)
            found = _find_data(data_path)
            if found:
                resolved_path = str(found)
        if not resolved_path and data_zip and Path(data_zip).exists():
            resolved_path = str(Path(data_zip))
        def _register_data(path: str):
            try:
                from org.orekit.data import DataProvidersManager, DirectoryCrawler, ZipJarCrawler  # type: ignore
                from java.io import File  # type: ignore
                # Orekit Python binding exposes a singleton via getInstance() or getDefault()
                manager = None
                if hasattr(DataProvidersManager, "getInstance"):
                    manager = DataProvidersManager.getInstance()
                elif hasattr(DataProvidersManager, "getDefault"):
                    manager = DataProvidersManager.getDefault()
                if manager is None:
                    return False
                if str(path).lower().endswith('.zip'):
                    manager.addProvider(ZipJarCrawler(File(str(path))))
                else:
                    manager.addProvider(DirectoryCrawler(File(str(path))))
                return True
            except Exception:
                return False

        if resolved_path:
            os.environ[\"OREKIT_DATA_PATH\"] = str(resolved_path)
            _register_data(resolved_path)
            if _pyhelpers and hasattr(_pyhelpers, \"setup_orekit_data_path\"):
                try:
                    _pyhelpers.setup_orekit_data_path(str(resolved_path))
                except Exception:
                    _register_data(str(resolved_path))
            elif _pyhelpers and hasattr(_pyhelpers, \"setup_orekit_data_curdir\"):
                try:
                    cwd = os.getcwd()
                    os.chdir(str(resolved_path))
                    _pyhelpers.setup_orekit_data_curdir()
                    os.chdir(cwd)
                except Exception:
                    pass
    except Exception:
        pass

def _find_candidate():
    if not SRC_PATH.exists():
        return None
    best = None
    best_score = -1
    patterns = (\"def make_env\", \"class OrbitZoo\", \"OrbitZoo(\")
    for path in SRC_PATH.rglob(\"*.py\"):
        name = path.name.lower()
        score = 0
        if \"orbit\" in name:
            score += 3
        if \"zoo\" in name:
            score += 2
        if \"env\" in name:
            score += 1
        try:
            text = path.read_text(encoding=\"utf-8\", errors=\"ignore\")
        except Exception:
            continue
        if any(p in text for p in patterns):
            score += 4
        if score > best_score:
            best_score = score
            best = path
    return best

def _load_module(path: Path):
    spec = importlib.util.spec_from_file_location(\"orbitzoo_impl\", str(path))
    if spec is None or spec.loader is None:
        raise ImportError(f\"Failed to load OrbitZoo module from {{path}}\")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

_setup_orekit()
candidate = _find_candidate()
if candidate is None:
    raise ImportError(\"OrbitZoo shim could not locate a Python module in src/\")

_mod = _load_module(candidate)

# Export common entrypoints if they exist
make_env = getattr(_mod, \"make_env\", None) or getattr(_mod, \"make\", None)
OrbitZoo = getattr(_mod, \"OrbitZoo\", None)
if make_env is None and callable(OrbitZoo):
    def make_env(*args, **kwargs):
        return OrbitZoo(*args, **kwargs)

__all__ = [name for name in (\"make_env\", \"OrbitZoo\") if globals().get(name) is not None]
"""
    shim_path.write_text(textwrap.dedent(shim_code), encoding="utf-8")

if not _import_ok("orbitzoo"):
    _write_shim("orbitzoo", repo)
if not _import_ok("orbit_zoo"):
    _write_shim("orbit_zoo", repo)
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
DEST_ZIP="$OREKIT_DIR/orekit-data.zip"
if [ "$ORBITZOO_OREKIT_DATA_ZIP" = "$DEST_ZIP" ]; then
  echo "orekit-data.zip already in place. Skipping copy."
else
  cp -f "$ORBITZOO_OREKIT_DATA_ZIP" "$DEST_ZIP"
fi
export ORBITZOO_OREKIT_DATA_ZIP="$DEST_ZIP"
mkdir -p "$SETUP_DIR"
echo "$DEST_ZIP" > "$OREKIT_ZIP_FILE"
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

# Some tools expect a "orekit-data" folder name.
if [ -d "$OREKIT_DIR/orekit-data/orekit-data-main" ] && [ ! -e "$OREKIT_DIR/orekit-data/orekit-data" ]; then
  ln -s "orekit-data-main" "$OREKIT_DIR/orekit-data/orekit-data" || true
fi

OREKIT_DIR="$OREKIT_DIR" SETUP_DIR="$SETUP_DIR" python - <<'PY'
import os
from pathlib import Path

root = Path(os.environ.get("OREKIT_DIR", ".")).resolve()
extract_root = root / "orekit-data"

def looks_like_data(base: Path) -> bool:
    if not (base / "Earth-Orientation-Parameters").exists():
        return False
    for candidate in base.rglob("UTC-TAI.history"):
        if candidate.is_file():
            return True
    return False

def find_data_dir(base: Path):
    if not base.exists():
        return None
    if looks_like_data(base):
        return base
    for child in base.rglob("Earth-Orientation-Parameters"):
        parent = child.parent
        if looks_like_data(parent):
            return parent
    return None

data_dir = find_data_dir(extract_root) or find_data_dir(root)
if data_dir:
    setup_dir = Path(os.environ.get("SETUP_DIR", root / ".setup"))
    setup_dir.mkdir(parents=True, exist_ok=True)
    path_file = setup_dir / "orbitzoo_orekit_path"
    path_file.write_text(str(data_dir), encoding="utf-8")
    print(f"[OrbitZoo] Orekit data dir: {data_dir}")
else:
    print("[OrbitZoo] Warning: orekit data directory not found after extraction.")
PY

# If orekit data still missing, download via orekit helper (requires network).
if [ ! -f "$SETUP_DIR/orbitzoo_orekit_path" ]; then
  echo "[OrbitZoo] Downloading orekit data via orekit.pyhelpers..."
  OREKIT_DIR="$OREKIT_DIR" SETUP_DIR="$SETUP_DIR" python - <<'PY'
import os
from pathlib import Path

root = Path(os.environ.get("OREKIT_DIR", ".")).resolve()
os.chdir(root)
try:
    import orekit  # type: ignore
    try:
        orekit.initVM()
    except Exception:
        pass
    from orekit.pyhelpers import download_orekit_data_curdir  # type: ignore
    download_orekit_data_curdir()
except Exception as exc:
    print(f"[OrbitZoo] orekit data download failed: {exc}")

def looks_like_data(base: Path) -> bool:
    if not (base / "Earth-Orientation-Parameters").exists():
        return False
    for candidate in base.rglob("UTC-TAI.history"):
        if candidate.is_file():
            return True
    return False

def find_data_dir(base: Path):
    if not base.exists():
        return None
    if looks_like_data(base):
        return base
    for child in base.rglob("Earth-Orientation-Parameters"):
        parent = child.parent
        if looks_like_data(parent):
            return parent
    return None

data_dir = find_data_dir(root / "orekit-data") or find_data_dir(root)
if data_dir:
    setup_dir = Path(os.environ.get("SETUP_DIR", root / ".setup"))
    setup_dir.mkdir(parents=True, exist_ok=True)
    path_file = setup_dir / "orbitzoo_orekit_path"
    path_file.write_text(str(data_dir), encoding="utf-8")
    print(f"[OrbitZoo] Orekit data dir: {data_dir}")
else:
    print("[OrbitZoo] Warning: orekit data directory still not found.")
PY
fi

if [ -f "$SETUP_DIR/orbitzoo_orekit_path" ]; then
  export ORBITZOO_OREKIT_DATA_DIR="$(cat "$SETUP_DIR/orbitzoo_orekit_path")"
fi
if [ -f "$OREKIT_ZIP_FILE" ]; then
  export ORBITZOO_OREKIT_DATA_ZIP="$(cat "$OREKIT_ZIP_FILE")"
fi

if [ -n "$ORBITZOO_OREKIT_DATA_DIR" ]; then
  export OREKIT_DATA_PATH="$ORBITZOO_OREKIT_DATA_DIR"
fi

# Mirror Orekit data into OrbitZoo expected path if needed.
if [ -n "$ORBITZOO_OREKIT_DATA_DIR" ] && [ -n "$ORBITZOO_REPO" ]; then
  TARGET_DIR="$ORBITZOO_REPO/src/dynamics/orekit"
  TARGET_LINK="$TARGET_DIR/orekit-data"
  if [ ! -e "$TARGET_LINK" ]; then
    mkdir -p "$TARGET_DIR"
    ln -s "$ORBITZOO_OREKIT_DATA_DIR" "$TARGET_LINK" || true
  fi
fi

# Mirror into platform repo path expected by some OrbitZoo builds.
PLATFORM_OREKIT_DIR="$ROOT_DIR/apps/portal-backend/src/dynamics/orekit"
PLATFORM_OREKIT_LINK="$PLATFORM_OREKIT_DIR/orekit-data"
if [ -n "$ORBITZOO_OREKIT_DATA_DIR" ] && [ ! -e "$PLATFORM_OREKIT_LINK" ]; then
  mkdir -p "$PLATFORM_OREKIT_DIR"
  ln -s "$ORBITZOO_OREKIT_DATA_DIR" "$PLATFORM_OREKIT_LINK" || true
fi

# Validate orekit data load (best-effort)
if [ -n "$ORBITZOO_OREKIT_DATA_DIR" ] || [ -n "$ORBITZOO_OREKIT_DATA_ZIP" ]; then
  echo "[OrbitZoo] Validating orekit data load..."
  python - <<'PY' || true
import os
try:
    import orekit  # type: ignore
    try:
        orekit.initVM()
    except Exception:
        pass
    data_path = os.environ.get("OREKIT_DATA_PATH") or os.environ.get("ORBITZOO_OREKIT_DATA_DIR") or os.environ.get("ORBITZOO_OREKIT_DATA_ZIP")
    if data_path:
        try:
            from org.orekit.data import DataProvidersManager, DirectoryCrawler, ZipJarCrawler  # type: ignore
            from java.io import File  # type: ignore
            manager = None
            if hasattr(DataProvidersManager, "getInstance"):
                manager = DataProvidersManager.getInstance()
            elif hasattr(DataProvidersManager, "getDefault"):
                manager = DataProvidersManager.getDefault()
            if manager:
                if str(data_path).lower().endswith('.zip'):
                    manager.addProvider(ZipJarCrawler(File(str(data_path))))
                else:
                    manager.addProvider(DirectoryCrawler(File(str(data_path))))
        except Exception:
            pass
        try:
            from orekit import pyhelpers  # type: ignore
            if hasattr(pyhelpers, "setup_orekit_data_path"):
                pyhelpers.setup_orekit_data_path(data_path)
        except Exception:
            pass
    from org.orekit.frames import FramesFactory  # type: ignore
    from org.orekit.utils import IERSConventions  # type: ignore
    FramesFactory.getITRF(IERSConventions.IERS_2010, True)
    print("[OrbitZoo] Orekit data OK")
except Exception as exc:
    print(f"[OrbitZoo] Orekit data validation failed: {exc}")
PY
fi

# Persist Orekit paths for future shell sessions
if [ -n "$CONDA_PREFIX" ]; then
  ACTIVATE_DIR="$CONDA_PREFIX/etc/conda/activate.d"
  DEACTIVATE_DIR="$CONDA_PREFIX/etc/conda/deactivate.d"
  mkdir -p "$ACTIVATE_DIR" "$DEACTIVATE_DIR"
  cat > "$ACTIVATE_DIR/orbitzoo_env.sh" <<EOF
export ORBITZOO_OREKIT_DATA_DIR="${ORBITZOO_OREKIT_DATA_DIR:-}"
export ORBITZOO_OREKIT_DATA_ZIP="${ORBITZOO_OREKIT_DATA_ZIP:-}"
export OREKIT_DATA_PATH="${OREKIT_DATA_PATH:-}"
EOF
  cat > "$DEACTIVATE_DIR/orbitzoo_env.sh" <<'EOF'
unset ORBITZOO_OREKIT_DATA_DIR
unset ORBITZOO_OREKIT_DATA_ZIP
unset OREKIT_DATA_PATH
EOF
fi

python - <<'PY'
import importlib
import sys
import traceback
import os
from pathlib import Path
ok = False
errors = {}
for name in ("orbitzoo", "orbit_zoo"):
    try:
        importlib.import_module(name)
        ok = True
        break
    except Exception:
        errors[name] = traceback.format_exc()
if not ok:
    print("OrbitZoo import failed after installation.")
    for name, err in errors.items():
        print(f"--- import {name} error ---")
        print(err)
    print("sys.path:")
    for entry in sys.path:
        print(entry)
    raise SystemExit(1)
else:
    data_dir = os.environ.get("OREKIT_DATA_PATH")
    if data_dir and Path(data_dir).exists():
        print(f"[OrbitZoo] OREKIT_DATA_PATH={data_dir}")
    else:
        print("[OrbitZoo] Warning: OREKIT_DATA_PATH not set.")
PY

mkdir -p "$SETUP_DIR"
python -c "import sys; print(sys.executable)" > "$SETUP_DIR/orbitzoo_python"

echo "OrbitZoo setup complete. orekit-data.zip cached at $OREKIT_DIR/orekit-data.zip"
