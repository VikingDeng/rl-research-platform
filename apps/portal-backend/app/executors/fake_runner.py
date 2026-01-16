import argparse
import json
import random
import time
from pathlib import Path
from typing import Callable, Optional, Dict, Any
import importlib


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--metrics-path", required=True)
    parser.add_argument("--checkpoint-path", required=True)
    parser.add_argument("--steps", type=int, default=5)
    parser.add_argument("--step-size", type=int, default=1000)
    parser.add_argument("--interval", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--plugin-spec", type=str, default=None)
    return parser.parse_args()


def _load_callable(entrypoint: str) -> Callable[..., Any]:
    module_name, func_name = entrypoint.split(":", 1)
    module = importlib.import_module(module_name)
    return getattr(module, func_name)


def main() -> None:
    args = parse_args()
    metrics_path = Path(args.metrics_path)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_path = Path(args.checkpoint_path)
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)

    rng = random.Random(args.seed or hash(args.run_id))
    base_return = rng.uniform(-5.0, 5.0)
    base_entropy = rng.uniform(0.5, 1.5)

    plugin_hooks: Dict[str, Callable[..., Any]] = {}
    plugin_context: Dict[str, Any] = {"runId": args.run_id}
    if args.plugin_spec:
        spec_path = Path(args.plugin_spec)
        if spec_path.exists():
            spec_payload = json.loads(spec_path.read_text(encoding="utf-8"))
            hooks = spec_payload.get("hooks") or {}
            for key, entry in hooks.items():
                if isinstance(entry, str) and ":" in entry:
                    plugin_hooks[key] = _load_callable(entry)
            plugin_context.update(
                {
                    "plugin": spec_payload.get("plugin"),
                    "runConfig": spec_payload.get("runConfig"),
                }
            )
    if "on_start" in plugin_hooks:
        plugin_hooks["on_start"](plugin_context)

    last_values = {}
    for idx in range(1, args.steps + 1):
        step = idx * args.step_size
        return_mean = base_return + idx * rng.uniform(0.2, 0.6)
        win_rate = max(0.0, min(1.0, 0.2 + idx * rng.uniform(0.05, 0.15)))
        entropy = max(0.0, base_entropy - idx * rng.uniform(0.02, 0.08))

        values = {
            "returnMean": round(return_mean, 4),
            "winRate": round(win_rate, 4),
            "entropy": round(entropy, 4),
        }
        last_values = values
        if "on_step" in plugin_hooks:
            result = plugin_hooks["on_step"](step, dict(values), plugin_context)
            if isinstance(result, dict):
                values.update(result)
                last_values = values

        with metrics_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"step": step, "values": values}) + "\n")

        time.sleep(args.interval)

    if "on_end" in plugin_hooks:
        plugin_hooks["on_end"](plugin_context, dict(last_values))

    checkpoint_payload = {
        "run_id": args.run_id,
        "step": args.steps * args.step_size,
        "metrics": last_values,
    }
    checkpoint_path.write_text(json.dumps(checkpoint_payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
