import argparse
import inspect
import json
import sys
from pathlib import Path
from typing import Any, Callable, Dict, Optional
import importlib
import os
import hashlib
import platform
from datetime import datetime, timezone
import shutil


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--config-path", required=True)
    parser.add_argument("--metrics-path", required=True)
    parser.add_argument("--checkpoint-dir", required=True)
    parser.add_argument("--plugin-spec", type=str, default=None)
    return parser.parse_args()


def load_entrypoint(entrypoint: str) -> Callable[..., Any]:
    algo_store = os.getenv("ALGO_STORE_DIR")
    if algo_store and algo_store not in sys.path:
        sys.path.insert(0, algo_store)
    module_name, func_name = entrypoint.split(":", 1)
    module = importlib.import_module(module_name)
    return getattr(module, func_name)


def _call_with_kwargs(func: Callable[..., Any], kwargs: Dict[str, Any]) -> Any:
    signature = inspect.signature(func)
    params = signature.parameters
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return func(**kwargs)
    filtered = {key: value for key, value in kwargs.items() if key in params}
    return func(**filtered)


def _normalize_env_config(env_cfg: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(env_cfg)
    if "envId" in normalized and "env_id" not in normalized:
        normalized["env_id"] = normalized["envId"]
    if "envId" in normalized and "id" not in normalized:
        normalized["id"] = normalized["envId"]
    if "mapSet" in normalized and "map_set" not in normalized:
        normalized["map_set"] = normalized["mapSet"]
    if "apiMode" in normalized and "api_mode" not in normalized:
        normalized["api_mode"] = normalized["apiMode"]
    if "scenarioSchema" in normalized and "scenario_schema" not in normalized:
        normalized["scenario_schema"] = normalized["scenarioSchema"]
    if "maxCycles" in normalized and "max_cycles" not in normalized:
        normalized["max_cycles"] = normalized["maxCycles"]
    if "continuousActions" in normalized and "continuous_actions" not in normalized:
        normalized["continuous_actions"] = normalized["continuousActions"]
    return normalized


def load_hooks(spec_path: str) -> Dict[str, Callable[..., Any]]:
    hooks: Dict[str, Callable[..., Any]] = {}
    payload = json.loads(Path(spec_path).read_text(encoding="utf-8"))
    for key, entry in (payload.get("hooks") or {}).items():
        if isinstance(entry, str) and ":" in entry:
            hooks[key] = load_entrypoint(entry)
    return hooks


import subprocess


def _safe_run(cmd: list[str], cwd: Optional[Path] = None) -> str:
    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
            text=True,
        )
        return result.stdout.strip()
    except Exception:
        return ""


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)

def _setup_git_repo(git_config: Dict[str, str], work_dir: Path) -> Path:
    repo_url = git_config.get("repo")
    commit = git_config.get("commit") or git_config.get("branch") or "main"
    if not repo_url:
        return work_dir

    repo_dir = work_dir / "git_workspace"
    if repo_dir.exists():
        # Clean cleanup if needed or just use it
        import shutil
        shutil.rmtree(repo_dir)
    repo_dir.mkdir(parents=True, exist_ok=True)

    print(f"[Runner] Cloning {repo_url} to {repo_dir}...")
    subprocess.run(["git", "clone", repo_url, str(repo_dir)], check=True)
    
    print(f"[Runner] Checking out {commit}...")
    subprocess.run(["git", "checkout", commit], cwd=str(repo_dir), check=True)
    
    return repo_dir

from utils.monitor import SystemMonitor

def _capture_env_snapshot(output_dir: Path, config: Dict[str, Any], repo_path: Optional[Path]) -> None:
    snapshot: Dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "python_version": sys.version,
        "executable": sys.executable,
        "platform": platform.platform(),
        "config_sha256": hashlib.sha256(
            json.dumps(config or {}, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest(),
        "env": {
            "CUDA_VISIBLE_DEVICES": os.environ.get("CUDA_VISIBLE_DEVICES"),
            "RUNTIME_PACKAGES": os.environ.get("RUNTIME_PACKAGES"),
            "RUNTIME_CACHE_KEY": os.environ.get("RUNTIME_CACHE_KEY"),
            "ALGO_STORE_DIR": os.environ.get("ALGO_STORE_DIR"),
            "PLUGIN_SPEC_PATH": os.environ.get("PLUGIN_SPEC_PATH"),
        },
    }

    if shutil.which("nvidia-smi"):
        gpu_info = _safe_run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"]
        )
        if gpu_info:
            snapshot["gpu"] = gpu_info.splitlines()

    if repo_path:
        snapshot["git"] = {
            "root": str(repo_path),
            "head": _safe_run(["git", "rev-parse", "HEAD"], cwd=repo_path),
            "status": _safe_run(["git", "status", "--porcelain"], cwd=repo_path),
        }
        diff_text = _safe_run(["git", "diff"], cwd=repo_path)
        if diff_text:
            _write_text(output_dir / "git_diff.patch", diff_text + "\n")
        status_text = snapshot["git"].get("status") or ""
        if status_text:
            _write_text(output_dir / "git_status.txt", status_text + "\n")

    freeze = _safe_run([sys.executable, "-m", "pip", "freeze"])
    if freeze:
        _write_text(output_dir / "requirements_freeze.txt", freeze + "\n")

    _write_text(output_dir / "env_snapshot.json", json.dumps(snapshot, indent=2))


def _capture_run_fingerprint(output_dir: Path) -> None:
    fingerprint: Dict[str, str] = {}
    candidates = [
        output_dir / "metrics.jsonl",
        output_dir / "config.json",
    ]
    candidates.extend((output_dir / "checkpoints").glob("*.json"))
    candidates.extend((output_dir / "eval").glob("*.json"))
    candidates.extend((output_dir / "matrix").glob("*.json"))
    candidates.extend((output_dir / "matrix").glob("*.csv"))
    candidates.extend((output_dir / "videos").glob("*.mp4"))
    candidates.extend(output_dir.glob("replay_buffer.*"))

    for path in candidates:
        if not path.exists() or not path.is_file():
            continue
        try:
            if path.stat().st_size > 100 * 1024 * 1024:
                continue
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(8192), b""):
                    digest.update(chunk)
            fingerprint[path.relative_to(output_dir).as_posix()] = digest.hexdigest()
        except Exception:
            continue

    if fingerprint:
        _write_text(output_dir / "run_fingerprint.json", json.dumps(fingerprint, indent=2))


def run_with_config(
    config: Dict[str, Any],
    run_id: str,
    metrics_path: str,
    checkpoint_dir: str,
    plugin_spec: Optional[str] = None,
) -> None:
    monitor = None
    if metrics_path:
        monitor = SystemMonitor(metrics_path)
        monitor.start()

    repo_path: Optional[Path] = None
    output_dir = Path(metrics_path).parent

    try:
        # Git Integration
        if isinstance(config, dict) and config.get("git"):
            repo_path = _setup_git_repo(config["git"], output_dir)
            sys.path.insert(0, str(repo_path))
            print(f"[Runner] Added {repo_path} to sys.path")

        algo = config.get("algo") if isinstance(config, dict) else None
        if isinstance(algo, dict):
            algo_meta = algo.get("metadata")
            if isinstance(algo_meta, dict):
                python_path = algo_meta.get("pythonPath")
                if python_path and python_path not in sys.path:
                    sys.path.insert(0, python_path)
        entrypoint = algo.get("entrypoint") if isinstance(algo, dict) else None
        if not entrypoint:
            print("runner_main: missing algo entrypoint", file=sys.stderr)
            sys.exit(1)

        seed = None
        if isinstance(config, dict):
            seed_set = config.get("seedSet")
            if isinstance(seed_set, list) and seed_set:
                seed = seed_set[0]
            elif config.get("seed") is not None:
                seed = config.get("seed")

        context: Dict[str, Any] = {
            "config": config,
            "run_id": run_id,
            "output_dir": str(output_dir),
            "metrics_path": metrics_path,
            "checkpoint_dir": checkpoint_dir,
            "plugin_spec": plugin_spec,
        }
        if seed is not None:
            context["seed"] = seed

        _capture_env_snapshot(output_dir, config, repo_path)

        env_obj: Optional[Any] = None
        if isinstance(config, dict):
            env_cfg = config.get("env")
            if isinstance(env_cfg, dict):
                env_entrypoint = env_cfg.get("entrypoint")
                if env_entrypoint:
                    try:
                        env_fn = load_entrypoint(env_entrypoint)
                        env_kwargs = _normalize_env_config(env_cfg)
                        
                        # Filter out system keys that shouldn't be passed to the env constructor
                        system_keys = {
                            "entrypoint", "package", "apiMode", "api_mode", "envId", "env_id", 
                            "version", "mapSet", "map_set", "mapSets", "scenarioSchema", 
                            "scenario_schema", "wrappers"
                        }
                        
                        signature = inspect.signature(env_fn)
                        params = signature.parameters
                        accepts_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values())

                        # Only filter system keys if target accepts **kwargs (e.g., gym.make),
                        # otherwise allow explicit params like map_set/map_sets to pass through.
                        if accepts_kwargs:
                            filtered_env_kwargs = {k: v for k, v in env_kwargs.items() if k not in system_keys}
                            if "id" in env_kwargs:
                                filtered_env_kwargs["id"] = env_kwargs["id"]
                        else:
                            filtered_env_kwargs = env_kwargs

                        env_obj = _call_with_kwargs(env_fn, filtered_env_kwargs)
                        context["env"] = env_obj
                        context["env_config"] = env_cfg
                        context["env_entrypoint"] = env_entrypoint
                    except Exception as exc:
                        print(f"runner_main: env entrypoint error: {exc}", file=sys.stderr)
                        sys.exit(1)

        func = load_entrypoint(entrypoint)
        hooks: Dict[str, Callable[..., Any]] = {}
        if plugin_spec and Path(plugin_spec).exists():
            try:
                hooks = load_hooks(plugin_spec)
            except Exception:
                hooks = {}
        if "on_start" in hooks:
            hooks["on_start"](context)
        sig = inspect.signature(func)
        params = list(sig.parameters.values())
        kwargs = {name: context[name] for name in sig.parameters if name in context}
        required = [
            p
            for p in params
            if p.default is inspect._empty and p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
        ]

        try:
            # Check if datasetPath is injected into config (from job_manager)
            dataset_path = config.get("datasetPath")
            if dataset_path:
                context["dataset_path"] = dataset_path

            if required and all(p.name in kwargs for p in required):
                func(**kwargs)
                return
            if len(params) == 0:
                func()
                return
            if len(params) == 1:
                func(context["config"])
                return
            func(context["config"], **kwargs)
        except Exception as exc:
            if "on_end" in hooks:
                hooks["on_end"](context, {"error": str(exc)})
            print(f"runner_main: entrypoint error: {exc}", file=sys.stderr)
            sys.exit(1)
        if "on_end" in hooks:
            hooks["on_end"](context, {"status": "success"})
    finally:
        try:
            _capture_run_fingerprint(output_dir)
        except Exception:
            pass
        if monitor:
            monitor.stop()


def main() -> None:
    args = parse_args()
    config = json.loads(Path(args.config_path).read_text(encoding="utf-8"))
    run_with_config(
        config=config,
        run_id=args.run_id,
        metrics_path=args.metrics_path,
        checkpoint_dir=args.checkpoint_dir,
        plugin_spec=args.plugin_spec,
    )


if __name__ == "__main__":
    main()
