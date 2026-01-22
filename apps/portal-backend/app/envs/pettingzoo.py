import importlib
from typing import Any, Dict, List, Optional


def _resolve_map(
    env_id: Optional[str],
    map_set: Optional[str],
    map_sets: Optional[List[Dict[str, Any]]],
    maps: Optional[List[str]],
) -> str:
    if maps:
        return maps[0]
    if map_set and map_sets:
        for entry in map_sets:
            if entry.get("id") == map_set:
                candidate = entry.get("maps") or []
                if candidate:
                    return candidate[0]
    if env_id:
        return env_id
    return "mpe/simple_spread_v3"


def make_env(
    env_id: Optional[str] = None,
    map_set: Optional[str] = None,
    map_sets: Optional[List[Dict[str, Any]]] = None,
    maps: Optional[List[str]] = None,
    max_cycles: Optional[int] = None,
    continuous_actions: Optional[bool] = None,
) -> Any:
    """
    Generic PettingZoo env factory.

    map entries can be provided as "module/env_name" (e.g., "mpe/simple_spread_v3").
    """
    selected = _resolve_map(env_id, map_set, map_sets, maps)
    if "/" in selected:
        module_name, env_name = selected.split("/", 1)
    else:
        module_name = "mpe" if env_id and "mpe" in env_id else "sisl" if env_id and "sisl" in env_id else "mpe"
        env_name = selected

    module = importlib.import_module(f"pettingzoo.{module_name}")
    env_spec = getattr(module, env_name, None)
    if env_spec is None:
        raise ValueError(f"pettingzoo_env_not_found:{module_name}/{env_name}")

    kwargs: Dict[str, Any] = {}
    if max_cycles is not None:
        kwargs["max_cycles"] = max_cycles
    if continuous_actions is not None:
        kwargs["continuous_actions"] = continuous_actions

    return env_spec.parallel_env(**kwargs)
