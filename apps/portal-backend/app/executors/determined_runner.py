import base64
import json
import os
from pathlib import Path
from typing import List

from app.executors.runner_main import run_with_config
from app.services import paths
from app.services import runtime_packages


def _load_config() -> dict:
    raw = os.environ.get("RUN_CONFIG_JSON")
    if raw:
        return json.loads(raw)

    raw_b64 = os.environ.get("RUN_CONFIG_B64")
    if raw_b64:
        decoded = base64.b64decode(raw_b64.encode("utf-8")).decode("utf-8")
        return json.loads(decoded)

    config_path = os.environ.get("RUN_CONFIG_PATH")
    if config_path:
        return json.loads(Path(config_path).read_text(encoding="utf-8"))

    raise RuntimeError("RUN_CONFIG_JSON missing")


def main() -> None:
    config = _load_config()
    run_id = os.environ.get("RUN_ID") or config.get("runId") or "determined-run"
    output_dir = Path(os.environ.get("OUTPUT_DIR") or ".").resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = os.environ.get("METRICS_PATH") or str(output_dir / "metrics.jsonl")
    checkpoint_dir = os.environ.get("CHECKPOINT_DIR") or str(output_dir / "checkpoints")
    plugin_spec = os.environ.get("PLUGIN_SPEC_PATH")

    packages: List[str] = []
    if isinstance(config, dict):
        env_cfg = config.get("env")
        if isinstance(env_cfg, dict) and env_cfg.get("package"):
            packages.append(str(env_cfg["package"]))
        algo_cfg = config.get("algo")
        if isinstance(algo_cfg, dict) and algo_cfg.get("package"):
            packages.append(str(algo_cfg["package"]))
    runtime_spec = runtime_packages.prepare_runtime(packages)
    if runtime_spec:
        python_path = os.environ.get("PYTHONPATH")
        paths = [str(runtime_spec.python_path)]
        if python_path:
            paths.append(python_path)
        os.environ["PYTHONPATH"] = os.pathsep.join(paths)
        os.environ["RUNTIME_PACKAGES"] = ",".join(runtime_spec.packages)
        os.environ["RUNTIME_CACHE_KEY"] = runtime_spec.cache_key

    algo_store = paths.algo_store_dir()
    python_path = os.environ.get("PYTHONPATH")
    paths_list = [str(algo_store)]
    if python_path:
        paths_list.append(python_path)
    os.environ["PYTHONPATH"] = os.pathsep.join(paths_list)
    os.environ["ALGO_STORE_DIR"] = str(algo_store)

    run_with_config(
        config=config,
        run_id=run_id,
        metrics_path=metrics_path,
        checkpoint_dir=checkpoint_dir,
        plugin_spec=plugin_spec,
    )


if __name__ == "__main__":
    main()
