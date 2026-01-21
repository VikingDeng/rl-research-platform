import itertools
import random
from typing import Any, Dict, List, Optional


def expand_scenario_grid(grid: Optional[Dict[str, Any]]) -> List[Optional[Dict[str, Any]]]:
    if not grid:
        return [None]
    if not isinstance(grid, dict):
        return [None]
    scenarios = grid.get("scenarios")
    if isinstance(scenarios, list) and scenarios:
        typed = [s for s in scenarios if isinstance(s, dict)]
        return typed if typed else [None]
    axes = grid.get("axes")
    if isinstance(axes, dict) and axes:
        keys = list(axes.keys())
        values = []
        for key in keys:
            axis_values = axes.get(key)
            if isinstance(axis_values, list) and axis_values:
                values.append(axis_values)
            else:
                values.append([axis_values])
        combos = itertools.product(*values)
        return [dict(zip(keys, combo)) for combo in combos]
    return [None]


def sample_opponent(
    sampling: Optional[Dict[str, Any]],
    pool_ref: Optional[Dict[str, Any]],
    rng: random.Random,
) -> str:
    if isinstance(sampling, dict):
        weights = sampling.get("weights")
        if isinstance(weights, dict) and weights:
            items = []
            for key, weight in weights.items():
                if isinstance(weight, (int, float)):
                    items.append((key, float(weight)))
            if items:
                total = sum(max(0.0, w) for _, w in items)
                if total <= 0:
                    return items[0][0]
                threshold = rng.random() * total
                running = 0.0
                for key, weight in items:
                    running += max(0.0, weight)
                    if running >= threshold:
                        return key
        members = sampling.get("members")
        if isinstance(members, list) and members:
            return str(rng.choice(members))
        pool_id = sampling.get("poolId") or sampling.get("pool_id")
        if pool_id:
            return f"pool:{pool_id}"
    if isinstance(pool_ref, dict):
        pool_id = pool_ref.get("poolId") or pool_ref.get("pool_id")
        if pool_id:
            return f"pool:{pool_id}"
    return "default"
