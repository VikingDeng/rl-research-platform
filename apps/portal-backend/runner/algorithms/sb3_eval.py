import json
import os
import sys
import gymnasium as gym
from stable_baselines3 import PPO, SAC, DQN
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv
from pathlib import Path
import numpy as np
import random

from algorithms.eval_utils import expand_scenario_grid, sample_opponent

def evaluate(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None, output_dir=None):
    """
    Real SB3 Evaluation Entrypoint.
    Loads a model checkpoint and runs it against the environment.
    """
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    output_dir = output_dir or os.environ.get("OUTPUT_DIR", ".")
    
    # 1. Parse Protocol & Config
    # The platform passes the policy checkpoint ID/Path via config
    # In a real run, the Runner downloads artifacts to a local path.
    # We expect 'policy_path' to be provided or inferred.
    # For this MVP, we assume the platform downloads the checkpoint to `checkpoints/policy.zip` 
    # or the config provides the local path.
    
    policy_snapshot_id = config.get("policySnapshotId")
    # In LocalExecutor, we don't have automatic artifact download logic yet for the *input* of an Eval Job.
    # But let's assume the user/platform mounts it or we look for it.
    # For simplicity in this step, we will check if a model file exists at a standard location.
    
    # Logic to find the model file:
    # 1. Look in config for 'modelPath'
    # 2. Look in environment for 'MODEL_PATH'
    # 3. Fallback to a default if testing
    
    model_path = config.get("modelPath") or os.environ.get("MODEL_PATH")
    if not model_path:
        # Try to find any zip in the input directory if mounted
        # For now, print warning and exit or error if strictly needed.
        # But to keep it robust for the "Demo", we fail if no model.
        print("[Eval] No model path provided. Checking known locations...")
        # (Optional: Add logic here if we implement artifact mounting later)
    
    if not model_path or not os.path.exists(model_path):
        print(f"[Eval] Error: Model file not found at {model_path}")
        # For the sake of the "Demo Flow" not crashing if users forget to mount:
        # We will Raise Error in Real Mode.
        raise FileNotFoundError(f"Model not found: {model_path}")

    env_cfg = config.get("env", {})
    maps = env_cfg.get("maps", ["CartPole-v1"])
    env_id = maps[0] if maps else "CartPole-v1"
    
    protocol = config.get("protocol", {})
    scenario_grid = protocol.get("scenarioGrid") or config.get("scenarioGrid")
    opponent_sampling = protocol.get("opponentSampling") or config.get("opponentSampling")
    opponent_pool_ref = protocol.get("opponentPoolRef")

    episodes = int(config.get("episodesPerMatch", 10))
    seeds = config.get("evalSeeds", [0])
    scenarios = expand_scenario_grid(scenario_grid)
    
    # 2. Setup Environment
    # We use DummyVecEnv for SB3
    vec_env = None
    if env is not None:
        print(f"[Eval] Using provided environment instance for {env_id}")
        if hasattr(env, "reset"):
            # Wrap in Monitor and DummyVecEnv
            env = Monitor(env)
            vec_env = DummyVecEnv([lambda: env])
        else:
            vec_env = env
    else:
        def make_env():
            e = gym.make(env_id, render_mode="rgb_array")
            return Monitor(e)
        vec_env = DummyVecEnv([make_env])

    # 3. Load Model
    # We need to know the algo class. PPO is safe default for this demo.
    # Ideally, metadata tells us.
    algo_name = config.get("algo", {}).get("name", "PPO").upper()
    model_cls = {
        "PPO": PPO,
        "SAC": SAC,
        "DQN": DQN
    }.get(algo_name, PPO)
    
    print(f"[Eval] Loading {algo_name} model from {model_path}...")
    try:
        model = model_cls.load(model_path, env=vec_env)
    except Exception as e:
        print(f"[Eval] Failed to load model: {e}")
        raise e

    # 4. Evaluation Loop
    results = []
    print(f"[Eval] Starting {episodes} episodes on {env_id}...")
    
    total_steps = 0
    for scenario_idx, scenario in enumerate(scenarios):
        for seed in seeds:
            rng = random.Random(seed + scenario_idx * 1000)
            # Set seed
            # SB3 `predict` doesn't take seed directly, we set env seed
            vec_env.seed(seed + scenario_idx * 1000)
            obs = vec_env.reset()

            for i in range(episodes):
                done = False
                episode_reward = 0.0
                episode_steps = 0
                opponent = sample_opponent(opponent_sampling, opponent_pool_ref, rng)

                while not done:
                    action, _ = model.predict(obs, deterministic=True)
                    obs, reward, dones, info = vec_env.step(action)
                    episode_reward += reward[0]
                    episode_steps += 1
                    total_steps += 1

                    if dones[0]:
                        done = True
                        obs = vec_env.reset()

                # Simple "Win" criteria for CartPole (e.g., > 195)
                # For general envs, we can't assume.
                win = 1 if episode_reward >= 195.0 and "CartPole" in env_id else 0

                result_entry = {
                    "seed": seed,
                    "episode": i,
                    "return": float(episode_reward),
                    "length": episode_steps,
                    "win": win,
                    "scenarioId": scenario_idx,
                    "scenario": scenario,
                    "opponent": opponent,
                }
                results.append(result_entry)

                # Live Metrics Log
                if metrics_path:
                    with open(metrics_path, "a", encoding="utf-8") as handle:
                        handle.write(json.dumps({
                            "step": total_steps,
                            "values": {"eval_return": float(episode_reward), "eval_len": episode_steps}
                        }) + "\n")

    # 5. Summary
    returns = [r["return"] for r in results]
    wins = [r["win"] for r in results]
    
    summary = {
        "mean": float(np.mean(returns)),
        "std": float(np.std(returns)),
        "min": float(np.min(returns)),
        "max": float(np.max(returns)),
        "count": len(returns),
        "winRate": float(np.mean(wins)),
        "scenarioCount": len(scenarios),
    }

    if scenarios and scenarios != [None]:
        scenario_stats = {}
        for r in results:
            key = str(r.get("scenarioId", 0))
            scenario_stats.setdefault(key, []).append(r["return"])
        summary["perScenarioMean"] = {
            key: float(np.mean(vals)) for key, vals in scenario_stats.items() if vals
        }
    
    # Write Artifacts
    eval_dir = Path(output_dir) / "eval"
    eval_dir.mkdir(parents=True, exist_ok=True)
    
    (eval_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    (eval_dir / "results.json").write_text(json.dumps(results, indent=2))
    
    print(f"[Eval] Complete. Summary: {summary}")
