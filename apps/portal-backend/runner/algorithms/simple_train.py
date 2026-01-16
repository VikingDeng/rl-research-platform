import json
import os
import time
from pathlib import Path


def train(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None):
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    checkpoint_dir = checkpoint_dir or os.environ.get("CHECKPOINT_DIR", "./checkpoints")
    run_id = run_id or os.environ.get("RUN_ID", "local-run")

    if not metrics_path:
        raise ValueError("metrics_path_missing")

    Path(checkpoint_dir).mkdir(parents=True, exist_ok=True)

    train_cfg = config.get("train", {})
    total_steps = int(train_cfg.get("totalEnvSteps", 1000))
    step_size = max(1, int(train_cfg.get("rolloutLen", 10)))
    steps = max(1, total_steps // step_size)

    last_values = {}
    for idx in range(1, steps + 1):
        step = idx * step_size
        values = {
            "returnMean": round(0.1 * idx, 4),
            "winRate": round(min(1.0, 0.05 * idx), 4),
            "entropy": round(max(0.0, 1.0 - 0.02 * idx), 4),
        }
        last_values = values
        with open(metrics_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"step": step, "values": values}) + "\n")
        time.sleep(0.2)

    ckpt_path = Path(checkpoint_dir) / f"ckpt_{steps * step_size}.json"
    ckpt_path.write_text(
        json.dumps({"run_id": run_id, "step": steps * step_size, "metrics": last_values}, indent=2),
        encoding="utf-8",
    )
