import gymnasium as gym

class MyCustomWrapper(gym.ObservationWrapper):
    def __init__(self, env):
        super().__init__(env)
        print("MyCustomWrapper initialized!")

    def observation(self, observation):
        # In a real wrapper, modify observation
        return observation
