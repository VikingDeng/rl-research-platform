import json
import os
import shutil
import re
from pathlib import Path
from typing import Dict

import importlib
import ray
from ray import train, tune
from ray.rllib.algorithms.ppo import PPOConfig
from ray.tune.logger import LoggerCallback
from ray.tune.registry import register_env
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


def _find_latest_checkpoint(checkpoint_dir: str) -> str | None:
    root = Path(checkpoint_dir)
    if not root.exists():
        return None
    candidates = list(root.rglob("checkpoint_*"))
    best = None
    best_step = -1
    for path in candidates:
        if not path.is_dir():
            continue
        match = re.search(r"checkpoint_(\d+)", path.name)
        if match:
            step = int(match.group(1))
            if step > best_step:
                best_step = step
                best = path
    return str(best) if best else None

def _resolve_map(env_cfg: Dict) -> str:
    maps = env_cfg.get("maps") if isinstance(env_cfg.get("maps"), list) else None
    if maps:
        return maps[0]
    map_set = env_cfg.get("mapSet")
    map_sets = env_cfg.get("mapSets") or []
    if map_set and isinstance(map_sets, list):
        for entry in map_sets:
            if entry.get("id") == map_set:
                candidates = entry.get("maps") or []
                if candidates:
                    return candidates[0]
    return "mpe/simple_spread_v3"


def env_creator(config):
    map_name = config.get("map") or "mpe/simple_spread_v3"
    if "/" in map_name:
        module_name, env_name = map_name.split("/", 1)
    else:
        module_name = "mpe"
        env_name = map_name
    module = importlib.import_module(f"pettingzoo.{module_name}")
    env_spec = getattr(module, env_name)
    env = env_spec.parallel_env(max_cycles=25, continuous_actions=True, render_mode="rgb_array")
    return ParallelPettingZooEnv(env)

def _resolve_algo_config(algo_cfg: Dict):
    raw_name = algo_cfg.get("name") or algo_cfg.get("algoId") or "PPO"
    algo_name = str(raw_name).upper()
    if algo_name in {"RLLIB-PPO", "PPO"}:
        return algo_name, PPOConfig()
    if algo_name in {"RLLIB-APPO", "APPO"}:
        try:
            from ray.rllib.algorithms.appo import APPOConfig
            return "APPO", APPOConfig()
        except Exception:
            print("[RLLib] APPOConfig not available, falling back to PPO.")
            return "PPO", PPOConfig()
    if algo_name in {"RLLIB-IMPALA", "IMPALA"}:
        try:
            from ray.rllib.algorithms.impala import ImpalaConfig
            return "IMPALA", ImpalaConfig()
        except Exception:
            print("[RLLib] IMPALAConfig not available, falling back to PPO.")
            return "PPO", PPOConfig()
    return "PPO", PPOConfig()


def train(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None):
    """
    RLLib MARL Training Entrypoint.
    """
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    checkpoint_dir = checkpoint_dir or os.environ.get("CHECKPOINT_DIR", "./checkpoints")
    
    # 1. Initialize Ray
    if ray.is_initialized():
        ray.shutdown()
    
    # Check for debug mode in config to enable local_mode (easier debugging, no multiprocessing)
    is_debug = config.get("debug", False)
    ray.init(local_mode=is_debug)

    # 2. Register Env
    env_cfg = config.get("env", {}) if isinstance(config, dict) else {}
    map_name = _resolve_map(env_cfg)
    register_env("pettingzoo_env", env_creator)
    
    # 3. Configure PPO
    train_cfg = config.get("train", {})
    total_steps = int(train_cfg.get("totalEnvSteps", 20000))
    lr = float(train_cfg.get("learningRate", 3e-4))
    checkpoint_every = int(train_cfg.get("checkpointEvery", max(1000, total_steps // 10)))
    
    algo_cfg = config.get("algo", {}) if isinstance(config, dict) else {}
    algo_name, algo_base = _resolve_algo_config(algo_cfg)

    algo_config = (
        algo_base
        .environment("pettingzoo_env", env_config={"map": map_name})
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
    
    resume_flag = bool(config.get("resume")) or str(config.get("resumeFrom", "")).lower() in {"latest", "true"}
    resume_path = config.get("resumePath") or (_find_latest_checkpoint(checkpoint_dir) if resume_flag else None)

    if resume_path:
        print(f"[RLLib] Resuming from {resume_path}")
        algo = algo_config.build()
        algo.restore(resume_path)
        timesteps = 0
        while timesteps < total_steps:
            result = algo.train()
            timesteps = int(result.get("timesteps_total", timesteps))
            PortalMetricsCallback(metrics_path).log_trial_result(timesteps, None, result)
            if checkpoint_every > 0 and timesteps % checkpoint_every == 0:
                algo.save(checkpoint_dir)
        algo.save(checkpoint_dir)
        ckpt_json = Path(checkpoint_dir) / f"ckpt_{total_steps}.json"
        ckpt_json.write_text(
            json.dumps({"run_id": run_id, "step": timesteps, "metrics": {}, "path": str(checkpoint_dir)}),
            encoding="utf-8",
        )
        algo.stop()
        ray.shutdown()
        return

    tuner = tune.Tuner(
        algo_name,
        param_space=algo_config.to_dict(),
        run_config=train.RunConfig(
            stop={"timesteps_total": total_steps},
            callbacks=[PortalMetricsCallback(metrics_path)],
            storage_path=os.path.abspath(checkpoint_dir),
            name="rllib_run",
        ),
    )

    results = tuner.fit()
    best_result = results.get_best_result(metric="env_runners/episode_reward_mean", mode="max")
    print(f"[RLLib] Training finished. Best reward: {best_result.metrics.get('env_runners', {}).get('episode_reward_mean')}")
    ckpt_json = Path(checkpoint_dir) / f"ckpt_{total_steps}.json"
    ckpt_json.write_text(json.dumps({"run_id": run_id, "step": total_steps, "metrics": {}, "path": str(checkpoint_dir)}), encoding="utf-8")
    ray.shutdown()
