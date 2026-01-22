import importlib
from typing import Any, Dict, List, Optional

import gymnasium as gym


def _safe_import(module_name: str) -> None:
    try:
        importlib.import_module(module_name)
    except Exception:
        # Optional extra environments can fail to import without their deps.
        # We let gym.make raise a clearer error if registration is missing.
        pass


def _maybe_register_env(target_map: str) -> None:
    normalized = target_map.lower()
    if normalized.startswith("minigrid") or "minigrid" in normalized:
        _safe_import("minigrid")
    if normalized.startswith("procgen") or "procgen" in normalized:
        _safe_import("procgen")

def make_env(
    env_id: str = "gym-classic", 
    maps: Optional[List[str]] = None, 
    map_set: Optional[str] = None,
    **kwargs: Any
) -> gym.Env:
    """
    A dummy environment factory that creates standard Gym environments.
    This serves as a demonstration of how a custom entrypoint should look.
    """
    # Default to CartPole if no map specified
    target_map = "CartPole-v1"
    if maps and len(maps) > 0:
        target_map = maps[0]
    
    print(f"[DummyEnv] Creating environment: {target_map}")
    _maybe_register_env(target_map)
    return gym.make(target_map, render_mode="rgb_array")
