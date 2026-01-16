import gymnasium as gym
from pettingzoo.mpe import simple_spread_v3
from shimmy.openai_gym_compatibility import GymV21CompatibilityV0

def make_env(env_id: str = "simple_spread_v3", **kwargs):
    """
    Creates a PettingZoo MPE environment compatible with RLLib.
    RLLib creates environments internally, but we provide this for local testing 
    or custom runners.
    """
    # MPE Simple Spread is a classic cooperative MARL task
    env = simple_spread_v3.parallel_env(max_cycles=25, continuous_actions=True)
    return env
