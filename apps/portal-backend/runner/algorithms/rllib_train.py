import json
import os
import shutil
from pathlib import Path
from typing import Dict

import ray
from ray import train, tune
from ray.rllib.algorithms.ppo import PPOConfig
from ray.tune.logger import LoggerCallback
from ray.tune.registry import register_env
from pettingzoo.mpe import simple_spread_v3
from ray.rllib.env.wrappers.pettingzoo_env import ParallelPettingZooEnv

class PortalMetricsCallback(LoggerCallback):
    """
    Ray Tune Callback to write metrics in the platform's JSONL format.
    """
    def __init__(self, metrics_path: str):
        self.metrics_path = metrics_path

    def log_trial_result(self, iteration: int, trial: "Trial", result: Dict):
        step = result.get("timesteps_total", 0)
        # Extract key metrics. RLLib structure is deep.
        # We look for 'env_runners/episode_reward_mean' (new RLLib) or 'episode_reward_mean' (old)
        reward_mean = result.get("env_runners", {}).get("episode_reward_mean")
        if reward_mean is None:
            reward_mean = result.get("episode_reward_mean", 0)
            
        values = {
            "returnMean": reward_mean,
            "epLenMean": result.get("env_runners", {}).get("episode_len_mean", 0),
        }
        
        # Write to JSONL
        with open(self.metrics_path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"step": step, "values": values}) + "\n")

def env_creator(config):
    # For MVP, we hardcode simple_spread_v3. 
    # In production, 'config' would contain the map name.
    env = simple_spread_v3.parallel_env(max_cycles=25, continuous_actions=True, render_mode="rgb_array")
    return ParallelPettingZooEnv(env)

def train(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None):
    """
    RLLib MARL Training Entrypoint.
    """
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    checkpoint_dir = checkpoint_dir or os.environ.get("CHECKPOINT_DIR", "./checkpoints")
    
    # 1. Initialize Ray
    if ray.is_initialized():
        ray.shutdown()
    ray.init(local_mode=True) # Use local mode for simplicity in this runner

    # 2. Register Env
    register_env("mpe_simple_spread", env_creator)
    
    # 3. Configure PPO
    train_cfg = config.get("train", {})
    total_steps = int(train_cfg.get("totalEnvSteps", 20000))
    lr = float(train_cfg.get("learningRate", 3e-4))
    
    algo_config = (
        PPOConfig()
        .environment("mpe_simple_spread")
        .framework("torch")
        .training(
            lr=lr, 
            train_batch_size=2000,
            gamma=0.99
        )
        .multi_agent(
            # Simple shared policy for all agents
            policies={"shared_policy"},
            policy_mapping_fn=lambda agent_id, episode, worker, **kwargs: "shared_policy",
        )
        .resources(num_gpus=0) # Set to 1 if GPU available
    )

    # 4. Train with Tune
    print(f"[RLLib] Starting training for {total_steps} steps...")
    
    tuner = tune.Tuner(
        "PPO",
        param_space=algo_config.to_dict(),
        run_config=train.RunConfig(
            stop={"timesteps_total": total_steps},
            callbacks=[PortalMetricsCallback(metrics_path)],
            storage_path=os.path.abspath(checkpoint_dir),
            name="rllib_run"
        ),
    )
    
    results = tuner.fit()
    
    # 5. Finalize
    # RLLib saves checkpoints in its own structure. 
    # The platform expects a specific structure or we just let JobManager upload the whole dir.
    # The JobManager is smart enough to upload the `checkpoint_dir`.
    
    best_result = results.get_best_result(metric="env_runners/episode_reward_mean", mode="max")
    print(f"[RLLib] Training finished. Best reward: {best_result.metrics.get('env_runners', {}).get('episode_reward_mean')}")
    
    ray.shutdown()
