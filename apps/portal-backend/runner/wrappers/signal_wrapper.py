import numpy as np
from gymnasium.spaces import Box
from pettingzoo.utils.wrappers import BaseWrapper

class CommonSignalWrapper(BaseWrapper):
    """
    Research Wrapper: Adds a common public signal z_t to all agents' observations.
    
    Args:
        signal_bits (int): The parameter 'b'. 
                           Signal space size = 2^b.
                           If b=0, no signal is added (Original Env).
    """
    def __init__(self, env, signal_bits=0):
        super().__init__(env)
        self.signal_bits = signal_bits
        self.n_signals = 2 ** signal_bits if signal_bits > 0 else 0
        
        # 1. Update Observation Spaces
        # We append a One-Hot vector of size 2^b to the observation
        if self.signal_bits > 0:
            for agent in self.possible_agents:
                old_space = self.observation_spaces[agent]
                # Assuming old_space is Box (standard for MPE)
                low = np.append(old_space.low, np.zeros(self.n_signals))
                high = np.append(old_space.high, np.ones(self.n_signals))
                self.observation_spaces[agent] = Box(low=low, high=high, dtype=old_space.dtype)

    def reset(self, seed=None, options=None):
        obs, infos = self.env.reset(seed=seed, options=options)
        
        # Generate initial signal
        if self.signal_bits > 0:
            self.current_signal = np.random.randint(0, self.n_signals)
            obs = self._append_signal(obs)
            
        return obs, infos

    def step(self, actions):
        obs, rewards, terminations, truncations, infos = self.env.step(actions)
        
        # Generate new signal for the next step (random walk or i.i.d?)
        # Paper plan says "random signal z_t", usually implies i.i.d per step.
        if self.signal_bits > 0:
            self.current_signal = np.random.randint(0, self.n_signals)
            obs = self._append_signal(obs)
            
        return obs, rewards, terminations, truncations, infos

    def _append_signal(self, obs_dict):
        """Appends the one-hot encoded signal to observations."""
        one_hot = np.zeros(self.n_signals, dtype=np.float32)
        one_hot[self.current_signal] = 1.0
        
        new_obs = {}
        for agent, o in obs_dict.items():
            new_obs[agent] = np.concatenate([o, one_hot], axis=-1)
        return new_obs
