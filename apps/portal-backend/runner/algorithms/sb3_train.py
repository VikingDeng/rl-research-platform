import json
import os
import sys
import gymnasium as gym
from stable_baselines3 import PPO, SAC, DQN
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.monitor import Monitor
from gymnasium.wrappers import RecordVideo
from pathlib import Path

class MetricsCallback(BaseCallback):
    """
    Custom callback for plotting additional values in the platform.
    """
    def __init__(self, metrics_path, verbose=0):
        super(MetricsCallback, self).__init__(verbose)
        self.metrics_path = metrics_path
        self.last_step_logged = -1

    def _on_step(self) -> bool:
        # SB3 logs at end of rollout, but we can log granular if needed.
        # We rely on SB3's logger mostly, but we want to dump to our metrics.jsonl format.
        return True

    def _on_rollout_end(self) -> None:
        # Access values from the logger
        logs = self.logger.get_log_dict()
        if not logs:
            return
            
        # Format for Platform
        # Key mapping: SB3 uses "train/loss", we might want simple names
        flat_logs = {k.split("/")[-1]: v for k, v in logs.items()}
        
        # Add timestamp/step
        payload = {
            "step": self.num_timesteps,
            "values": flat_logs
        }
        
        with open(self.metrics_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")

def train(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None):
    """
    SB3 Training Entrypoint.
    Config structure expected:
    {
      "env": {"envId": "gym-classic", "mapSet": "classic", "maps": ["CartPole-v1"]},
      "algo": {"name": "PPO"},
      "train": {"totalEnvSteps": 10000, "learningRate": 0.0003}
    }
    """
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    checkpoint_dir = checkpoint_dir or os.environ.get("CHECKPOINT_DIR", "./checkpoints")
    
    # 1. Parse Config
    env_cfg = config.get("env", {})
    maps = env_cfg.get("maps", ["CartPole-v1"])
    env_id = maps[0] if maps else "CartPole-v1"
    
    train_cfg = config.get("train", {})
    total_steps = int(train_cfg.get("totalEnvSteps", 10000))
    lr = float(train_cfg.get("learningRate", 3e-4))
    
    algo_name = config.get("algo", {}).get("name", "PPO").upper()
    
    # 2. Setup Environment
    # We enable video recording for the evaluation phase or periodically
    video_folder = os.path.join(os.path.dirname(metrics_path), "videos")
    os.makedirs(video_folder, exist_ok=True)
    
    vec_env = None
    if env is not None:
        print(f"[SB3] Using provided environment instance for {env_id}")
        # If env is provided (from runner_main), we wrap it.
        # Note: If it's already vectorized, use as is. For now assume standard Gym Env.
        if hasattr(env, "reset"):
            # We wrap in Monitor for logging, then DummyVecEnv
            # Since env is already instantiated, we can't easily use RecordVideo wrapper 
            # unless we wrapped it BEFORE passing here. 
            # For custom envs, we assume they handle their own rendering or we skip video for now.
            env = Monitor(env)
            vec_env = DummyVecEnv([lambda: env])
        else:
             # Assume it's already a VecEnv
             vec_env = env
    else:
        def make_env():
            e = gym.make(env_id, render_mode="rgb_array")
            # Trigger video every 20% of training or at least once
            trigger = lambda episode_id: episode_id % 50 == 0 
            e = RecordVideo(e, video_folder=video_folder, episode_trigger=trigger, name_prefix="training")
            e = Monitor(e)
            return e
        vec_env = DummyVecEnv([make_env])

    # 3. Setup Model
    model_cls = {
        "PPO": PPO,
        "SAC": SAC,
        "DQN": DQN
    }.get(algo_name, PPO)
    
    print(f"Starting SB3 {algo_name} on {env_id} for {total_steps} steps...")
    
    model = model_cls(
        "MlpPolicy", 
        vec_env, 
        verbose=1, 
        learning_rate=lr,
        tensorboard_log=None
    )
    
    # 4. Train
    callback = MetricsCallback(metrics_path)
    model.learn(total_timesteps=total_steps, callback=callback)
    
    # 5. Save Final Checkpoint
    final_ckpt = os.path.join(checkpoint_dir, f"model_final.zip")
    model.save(final_ckpt)
    
    # Write a json wrapper for the checkpoint so the platform sees it
    ckpt_json = os.path.join(checkpoint_dir, f"ckpt_{total_steps}.json")
    with open(ckpt_json, "w") as f:
        json.dump({
            "run_id": run_id,
            "step": total_steps,
            "metrics": {},
            "path": final_ckpt,
            "format": "sb3_zip"
        }, f)
        
    print("Training finished.")
    vec_env.close()
