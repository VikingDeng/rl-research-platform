from pettingzoo.mpe import simple_spread_v3
from runner.wrappers.signal_wrapper import CommonSignalWrapper

def make_env(signal_bits=0, N=3, local_ratio=0.5, **kwargs):
    """
    Factory function for MPE with Common Signal.
    
    Args:
        signal_bits (int): 'b', controls the information amount.
        N (int): Number of agents.
    """
    # 1. Create Base Env (Parallel API)
    # Using continuous actions for PPO compatibility (easier than discrete)
    env = simple_spread_v3.parallel_env(N=N, local_ratio=local_ratio, continuous_actions=True, **kwargs)
    
    # 2. Apply Signal Wrapper if b > 0
    if signal_bits > 0:
        env = CommonSignalWrapper(env, signal_bits=signal_bits)
        
    return env
