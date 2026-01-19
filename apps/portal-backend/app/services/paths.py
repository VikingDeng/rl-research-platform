from pathlib import Path

from app.core.config import settings


def run_root(run_id: str) -> Path:
    root_path = settings.local_run_root
    if settings.executor_mode.lower() == "determined" and settings.determined_shared_fs_root:
        root_path = settings.determined_shared_fs_root
    root = Path(root_path).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    root = root.resolve()
    run_dir = root / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def metrics_path(run_id: str) -> Path:
    return run_root(run_id) / "metrics.jsonl"


def checkpoints_dir(run_id: str) -> Path:
    path = run_root(run_id) / "checkpoints"
    path.mkdir(parents=True, exist_ok=True)
    return path


def checkpoint_path(run_id: str, step: int) -> Path:
    return checkpoints_dir(run_id) / f"ckpt_{step}.json"


def logs_path(run_id: str) -> Path:
    return run_root(run_id) / "runner.log"


def manifest_dir(run_id: str) -> Path:
    path = run_root(run_id) / "manifest"
    path.mkdir(parents=True, exist_ok=True)
    return path


def plugin_dir(run_id: str) -> Path:
    path = run_root(run_id) / "plugins"
    path.mkdir(parents=True, exist_ok=True)
    return path


def algo_store_dir() -> Path:
    root = Path(settings.algo_store_dir).expanduser()
    if not root.is_absolute():
        backend_root = Path(__file__).resolve().parents[2]
        root = (backend_root / root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root
