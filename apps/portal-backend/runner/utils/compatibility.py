import gymnasium as gym
import importlib
import sys

# Try to import optional dependencies
try:
    import pettingzoo
    from pettingzoo.utils.env import ParallelEnv, AECEnv
    import supersuit as ss
except ImportError:
    pettingzoo = None

try:
    import shimmy
except ImportError:
    shimmy = None

class EnvCompatibilityLayer:
    """
    The 'Erase' Layer.
    Ensures that any environment can be adapted to the interface expected by the algorithm.
    """

    @staticmethod
    def adapt_to_gym(env, env_id: str) -> gym.Env:
        """
        Adapts any environment (PettingZoo, DM_Control, etc.) to a standard Gymnasium Env/VecEnv.
        Target: Single-Agent Algorithms (SB3, CleanRL)
        """
        print(f"[Compatibility] Adapting {env_id} ({type(env).__name__}) to Gymnasium Interface...")

        # 1. Check if already Gym
        if isinstance(env, (gym.Env, gym.vector.VectorEnv)):
            return env

        # 2. Handle PettingZoo (Multi-Agent -> Single Agent Vector)
        # This enables Parameter Sharing (training one policy for all agents)
        if pettingzoo:
            is_parallel = isinstance(env, ParallelEnv)
            is_aec = isinstance(env, AECEnv)
            
            if is_parallel or is_aec:
                print(f"[Compatibility] Detected PettingZoo environment. Converting to VecEnv via SuperSuit...")
                if is_aec:
                    env = ss.aec_to_parallel_wrapper(env)
                
                # Apply standard wrappers for SB3 compatibility
                # - Concatenate observations from all agents into a batch
                # - This treats M agents as M independent environments in a batch
                env = ss.pettingzoo_env_to_vec_env_v1(env)
                
                # Concatenate the vector envs (to make it look like one big batch)
                env = ss.concat_vec_envs_v1(env, num_vec_envs=1, num_cpus=0, base_class='gymnasium')
                return env

        # 3. Handle Legacy Gym (gym < 0.26)
        if hasattr(env, 'seed') and hasattr(env, 'step'):
            # Simple heuristic check for legacy gym
            try:
                from shimmy.openai_gym_compatibility import GymV21CompatibilityV0
                print("[Compatibility] Detected Legacy Gym. Applying Shimmy wrapper...")
                return GymV21CompatibilityV0(env=env)
            except ImportError:
                print("[Compatibility] Warning: Legacy Gym detected but Shimmy not installed.")

        # 4. Fallback
        print("[Compatibility] No specific adapter found. Assuming Gym-compatible duck typing.")
        return env

    @staticmethod
    def adapt_to_pettingzoo(env, env_id: str):
        """
        Adapts any environment to PettingZoo ParallelEnv.
        Target: Multi-Agent Algorithms (RLLib, MAPPO)
        """
        print(f"[Compatibility] Adapting {env_id} ({type(env).__name__}) to PettingZoo Interface...")

        # 1. Check if already PettingZoo
        if pettingzoo and isinstance(env, ParallelEnv):
            return env
        
        if pettingzoo and isinstance(env, AECEnv):
            return ss.aec_to_parallel_wrapper(env)

        # 2. Handle Gym (Single Agent -> Multi Agent wrapper)
        if isinstance(env, gym.Env):
            print("[Compatibility] Detected Gym environment. Wrapping as Single-Agent PettingZoo...")
            # We treat a single agent env as a multi-agent env with 1 agent
            # Custom simple wrapper or use Shimmy if available
            try:
                from shimmy.gymnasium_compatibility import GymnasiumV0CompatibilityV0
                return GymnasiumV0CompatibilityV0(env=env)
            except (ImportError, AttributeError):
                pass
                
        return env
