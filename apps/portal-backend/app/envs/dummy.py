import gymnasium as gym
from typing import Any, Dict, List, Optional

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
    return gym.make(target_map, render_mode="rgb_array")