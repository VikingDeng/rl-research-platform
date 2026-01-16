import argparse
import inspect
import json
import sys
from pathlib import Path
from typing import Any, Callable, Dict, Optional
import importlib


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--config-path", required=True)
    parser.add_argument("--metrics-path", required=True)
    parser.add_argument("--checkpoint-dir", required=True)
    parser.add_argument("--plugin-spec", type=str, default=None)
    return parser.parse_args()


def load_entrypoint(entrypoint: str) -> Callable[..., Any]:
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
    if "mapSet" in normalized and "map_set" not in normalized:
        normalized["map_set"] = normalized["mapSet"]
    if "apiMode" in normalized and "api_mode" not in normalized:
        normalized["api_mode"] = normalized["apiMode"]
    if "scenarioSchema" in normalized and "scenario_schema" not in normalized:
        normalized["scenario_schema"] = normalized["scenarioSchema"]
    return normalized


def load_hooks(spec_path: str) -> Dict[str, Callable[..., Any]]:
    hooks: Dict[str, Callable[..., Any]] = {}
    payload = json.loads(Path(spec_path).read_text(encoding="utf-8"))
    for key, entry in (payload.get("hooks") or {}).items():
        if isinstance(entry, str) and ":" in entry:
            hooks[key] = load_entrypoint(entry)
    return hooks


import subprocess

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

    try:
        # Git Integration
        if isinstance(config, dict) and config.get("git"):
            repo_path = _setup_git_repo(config["git"], Path(metrics_path).parent)
            sys.path.insert(0, str(repo_path))
            print(f"[Runner] Added {repo_path} to sys.path")

        algo = config.get("algo") if isinstance(config, dict) else None
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
            "output_dir": str(Path(metrics_path).parent),
            "metrics_path": metrics_path,
            "checkpoint_dir": checkpoint_dir,
            "plugin_spec": plugin_spec,
        }
        if seed is not None:
            context["seed"] = seed

        env_obj: Optional[Any] = None
        if isinstance(config, dict):
            env_cfg = config.get("env")
            if isinstance(env_cfg, dict):
                env_entrypoint = env_cfg.get("entrypoint")
                if env_entrypoint:
                    try:
                        env_fn = load_entrypoint(env_entrypoint)
                        env_kwargs = _normalize_env_config(env_cfg)
                        env_obj = _call_with_kwargs(env_fn, env_kwargs)
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
