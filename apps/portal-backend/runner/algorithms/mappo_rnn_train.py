import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import importlib
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim


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


def _make_env(env_cfg: Dict):
    selected = _resolve_map(env_cfg)
    if "/" in selected:
        module_name, env_name = selected.split("/", 1)
    else:
        module_name = "mpe"
        env_name = selected
    module = importlib.import_module(f"pettingzoo.{module_name}")
    env_spec = getattr(module, env_name)
    continuous = bool(env_cfg.get("continuousActions"))
    return env_spec.parallel_env(max_cycles=25, continuous_actions=continuous)


def _flat_obs(obs) -> np.ndarray:
    arr = np.asarray(obs, dtype=np.float32)
    return arr.reshape(-1)


def _resolve_resume_path(config: Dict, checkpoint_dir: str) -> Optional[Path]:
    if not isinstance(config, dict):
        return None
    resume_path = config.get("resumePath")
    if resume_path and Path(resume_path).exists():
        return Path(resume_path)
    resume_flag = bool(config.get("resume")) or str(config.get("resumeFrom", "")).lower() in {"latest", "true"}
    if resume_flag:
        latest = Path(checkpoint_dir) / "model_latest.pt"
        if latest.exists():
            return latest
        final = Path(checkpoint_dir) / "model_final.pt"
        if final.exists():
            return final
    return None


def _save_checkpoint(path: Path, payload: Dict) -> None:
    torch.save(payload, path)


class RNNPolicy(nn.Module):
    def __init__(self, obs_dim: int, global_dim: int, act_dim: int, hidden_dim: int, continuous: bool):
        super().__init__()
        self.continuous = continuous
        self.actor_rnn = nn.GRU(obs_dim, hidden_dim, batch_first=False)
        self.critic_rnn = nn.GRU(global_dim, hidden_dim, batch_first=False)
        self.actor_head = nn.Linear(hidden_dim, act_dim)
        self.critic_head = nn.Linear(hidden_dim, 1)
        if self.continuous:
            self.log_std = nn.Parameter(torch.zeros(act_dim))

    def act_step(self, obs: torch.Tensor, global_obs: torch.Tensor, h_actor: torch.Tensor, h_critic: torch.Tensor):
        obs_in = obs.unsqueeze(0)
        glob_in = global_obs.unsqueeze(0)
        actor_out, h_actor = self.actor_rnn(obs_in, h_actor)
        critic_out, h_critic = self.critic_rnn(glob_in, h_critic)
        actor_out = actor_out.squeeze(0)
        critic_out = critic_out.squeeze(0)
        if self.continuous:
            mean = self.actor_head(actor_out)
            std = self.log_std.exp().expand_as(mean)
            dist = torch.distributions.Normal(mean, std)
            action = dist.sample()
            log_prob = dist.log_prob(action).sum(-1)
        else:
            logits = self.actor_head(actor_out)
            dist = torch.distributions.Categorical(logits=logits)
            action = dist.sample()
            log_prob = dist.log_prob(action)
        value = self.critic_head(critic_out).squeeze(-1)
        return action, log_prob, value, h_actor, h_critic

    def evaluate_sequence(
        self,
        obs_seq: torch.Tensor,
        global_seq: torch.Tensor,
        actions_seq: torch.Tensor,
        dones: torch.Tensor,
    ):
        seq_len, batch, _ = obs_seq.shape
        h_actor = torch.zeros(1, batch, self.actor_rnn.hidden_size, device=obs_seq.device)
        h_critic = torch.zeros(1, batch, self.critic_rnn.hidden_size, device=obs_seq.device)
        log_probs = []
        entropies = []
        values = []
        for t in range(seq_len):
            obs_t = obs_seq[t]
            glob_t = global_seq[t]
            h_actor = h_actor * (1.0 - dones[t].view(1, batch, 1))
            h_critic = h_critic * (1.0 - dones[t].view(1, batch, 1))
            actor_out, h_actor = self.actor_rnn(obs_t.unsqueeze(0), h_actor)
            critic_out, h_critic = self.critic_rnn(glob_t.unsqueeze(0), h_critic)
            actor_out = actor_out.squeeze(0)
            critic_out = critic_out.squeeze(0)
            if self.continuous:
                mean = self.actor_head(actor_out)
                std = self.log_std.exp().expand_as(mean)
                dist = torch.distributions.Normal(mean, std)
                log_prob = dist.log_prob(actions_seq[t]).sum(-1)
                entropy = dist.entropy().sum(-1)
            else:
                logits = self.actor_head(actor_out)
                dist = torch.distributions.Categorical(logits=logits)
                log_prob = dist.log_prob(actions_seq[t])
                entropy = dist.entropy()
            value = self.critic_head(critic_out).squeeze(-1)
            log_probs.append(log_prob)
            entropies.append(entropy)
            values.append(value)
        return (
            torch.stack(log_probs, dim=0),
            torch.stack(entropies, dim=0),
            torch.stack(values, dim=0),
        )


@dataclass
class RolloutBuffer:
    obs: List[np.ndarray]
    global_obs: List[np.ndarray]
    actions: List[np.ndarray]
    log_probs: List[np.ndarray]
    values: List[np.ndarray]
    rewards: List[np.ndarray]
    dones: List[np.ndarray]


def _compute_gae(rewards, values, dones, gamma: float, gae_lambda: float):
    steps, n_agents = rewards.shape
    advantages = np.zeros_like(rewards)
    last_adv = np.zeros(n_agents, dtype=np.float32)
    for t in reversed(range(steps)):
        next_value = values[t + 1]
        delta = rewards[t] + gamma * next_value * (1.0 - dones[t]) - values[t]
        last_adv = delta + gamma * gae_lambda * (1.0 - dones[t]) * last_adv
        advantages[t] = last_adv
    returns = advantages + values[:-1]
    return advantages, returns


def train(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None):
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    checkpoint_dir = checkpoint_dir or os.environ.get("CHECKPOINT_DIR", "./checkpoints")
    Path(checkpoint_dir).mkdir(parents=True, exist_ok=True)

    train_cfg = config.get("train", {}) if isinstance(config, dict) else {}
    total_steps = int(train_cfg.get("totalEnvSteps", 200000))
    rollout_len = int(train_cfg.get("rolloutLen", 200))
    epochs = int(train_cfg.get("epochs", 5))
    gamma = float(train_cfg.get("gamma", 0.99))
    gae_lambda = float(train_cfg.get("gaeLambda", 0.95))
    clip_range = float(train_cfg.get("clipRange", 0.2))
    lr = float(train_cfg.get("learningRate", 3e-4))
    value_coef = float(train_cfg.get("valueCoef", 0.5))
    entropy_coef = float(train_cfg.get("entropyCoef", 0.01))
    max_grad_norm = float(train_cfg.get("maxGradNorm", 0.5))
    hidden_dim = int(train_cfg.get("rnnHidden", 128))
    network_cfg = config.get("network", {}) if isinstance(config, dict) else {}
    hidden_dim = int(network_cfg.get("rnnHidden", hidden_dim))
    checkpoint_every = int(train_cfg.get("checkpointEvery", max(1000, total_steps // 10)))

    if env is None:
        env_cfg = env_config or config.get("env", {}) if isinstance(config, dict) else {}
        env = _make_env(env_cfg)

    obs_dict = env.reset()
    if isinstance(obs_dict, tuple):
        obs_dict = obs_dict[0]
    agents = list(obs_dict.keys())
    n_agents = len(agents)
    obs_dim = _flat_obs(obs_dict[agents[0]]).shape[0]

    sample_space = env.action_space(agents[0])
    continuous = hasattr(sample_space, "shape") and len(getattr(sample_space, "shape", [])) > 0
    if continuous:
        act_dim = int(np.prod(sample_space.shape))
    else:
        act_dim = int(sample_space.n)

    global_dim = obs_dim * n_agents
    policy = RNNPolicy(obs_dim, global_dim, act_dim, hidden_dim, continuous)
    optimizer = optim.Adam(policy.parameters(), lr=lr)

    episode_rewards = []
    running_return = np.zeros(n_agents, dtype=np.float32)

    steps_done = 0
    resume_path = _resolve_resume_path(config, checkpoint_dir)
    if resume_path:
        payload = torch.load(resume_path, map_location="cpu")
        if isinstance(payload, dict):
            state_dict = payload.get("state_dict")
            opt_state = payload.get("optimizer_state")
            if state_dict:
                policy.load_state_dict(state_dict)
            if opt_state:
                optimizer.load_state_dict(opt_state)
            steps_done = int(payload.get("steps_done", 0))
            print(f"[MAPPO-RNN] Resumed from {resume_path} at step {steps_done}")

    last_checkpoint = steps_done
    while steps_done < total_steps:
        rollout = RolloutBuffer([], [], [], [], [], [], [])
        h_actor = torch.zeros(1, n_agents, hidden_dim)
        h_critic = torch.zeros(1, n_agents, hidden_dim)
        for _ in range(rollout_len):
            obs_arr = np.stack([_flat_obs(obs_dict[a]) for a in agents], axis=0)
            global_obs = obs_arr.reshape(1, -1).repeat(n_agents, axis=0)

            obs_tensor = torch.tensor(obs_arr, dtype=torch.float32)
            global_tensor = torch.tensor(global_obs, dtype=torch.float32)

            with torch.no_grad():
                actions, log_probs, values, h_actor, h_critic = policy.act_step(
                    obs_tensor, global_tensor, h_actor, h_critic
                )

            action_dict = {}
            if continuous:
                action_np = actions.cpu().numpy()
                for idx, agent in enumerate(agents):
                    action_dict[agent] = action_np[idx]
            else:
                action_np = actions.cpu().numpy().astype(int)
                for idx, agent in enumerate(agents):
                    action_dict[agent] = int(action_np[idx])

            next_obs, rewards, terminations, truncations, infos = env.step(action_dict)

            done_flags = np.array(
                [terminations.get(a, False) or truncations.get(a, False) for a in agents],
                dtype=np.float32,
            )
            reward_arr = np.array([rewards.get(a, 0.0) for a in agents], dtype=np.float32)

            rollout.obs.append(obs_arr)
            rollout.global_obs.append(global_obs)
            rollout.actions.append(action_np)
            rollout.log_probs.append(log_probs.cpu().numpy())
            rollout.values.append(values.cpu().numpy())
            rollout.rewards.append(reward_arr)
            rollout.dones.append(done_flags)

            running_return += reward_arr
            steps_done += n_agents

            obs_dict = next_obs
            if all(done_flags):
                episode_rewards.append(float(np.mean(running_return)))
                running_return = np.zeros(n_agents, dtype=np.float32)
                obs_dict = env.reset()
                if isinstance(obs_dict, tuple):
                    obs_dict = obs_dict[0]
                h_actor = torch.zeros(1, n_agents, hidden_dim)
                h_critic = torch.zeros(1, n_agents, hidden_dim)

            if steps_done >= total_steps:
                break

        obs_arr = np.stack([_flat_obs(obs_dict[a]) for a in agents], axis=0)
        global_obs = obs_arr.reshape(1, -1).repeat(n_agents, axis=0)
        with torch.no_grad():
            last_values = (
                policy.critic_head(
                    policy.critic_rnn(
                        torch.tensor(global_obs, dtype=torch.float32).unsqueeze(0),
                        torch.zeros(1, n_agents, hidden_dim),
                    )[0].squeeze(0)
                )
                .squeeze(-1)
                .cpu()
                .numpy()
            )

        values_np = np.vstack([np.asarray(rollout.values), last_values[None, :]])
        rewards_np = np.asarray(rollout.rewards)
        dones_np = np.asarray(rollout.dones)

        advantages, returns = _compute_gae(rewards_np, values_np, dones_np, gamma, gae_lambda)

        obs_seq = torch.tensor(np.asarray(rollout.obs), dtype=torch.float32)
        global_seq = torch.tensor(np.asarray(rollout.global_obs), dtype=torch.float32)
        actions_seq = torch.tensor(np.asarray(rollout.actions), dtype=torch.float32 if continuous else torch.int64)
        old_logp_seq = torch.tensor(np.asarray(rollout.log_probs), dtype=torch.float32)
        adv_seq = torch.tensor(advantages, dtype=torch.float32)
        returns_seq = torch.tensor(returns, dtype=torch.float32)
        dones_seq = torch.tensor(np.asarray(rollout.dones), dtype=torch.float32)

        adv_seq = (adv_seq - adv_seq.mean()) / (adv_seq.std() + 1e-8)

        for _ in range(epochs):
            logp, entropy, values_pred = policy.evaluate_sequence(
                obs_seq, global_seq, actions_seq, dones_seq
            )
            ratio = torch.exp(logp - old_logp_seq)
            surr1 = ratio * adv_seq
            surr2 = torch.clamp(ratio, 1 - clip_range, 1 + clip_range) * adv_seq
            policy_loss = -torch.min(surr1, surr2).mean()
            value_loss = 0.5 * (returns_seq - values_pred).pow(2).mean()
            entropy_loss = -entropy.mean()
            loss = policy_loss + value_coef * value_loss + entropy_coef * entropy_loss

            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(policy.parameters(), max_grad_norm)
            optimizer.step()

        if metrics_path:
            mean_reward = float(np.mean(episode_rewards[-10:])) if episode_rewards else 0.0
            with open(metrics_path, "a", encoding="utf-8") as handle:
                handle.write(json.dumps({"step": steps_done, "values": {"returnMean": mean_reward}}) + "\n")

        if checkpoint_every > 0 and steps_done - last_checkpoint >= checkpoint_every:
            payload = {
                "algo": "mappo_rnn",
                "obs_dim": obs_dim,
                "global_dim": global_dim,
                "act_dim": act_dim,
                "continuous": continuous,
                "hidden_dim": hidden_dim,
                "steps_done": steps_done,
                "state_dict": policy.state_dict(),
                "optimizer_state": optimizer.state_dict(),
            }
            _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", payload)
            last_checkpoint = steps_done

    ckpt_path = Path(checkpoint_dir) / "model_final.pt"
    payload = {
        "algo": "mappo_rnn",
        "obs_dim": obs_dim,
        "global_dim": global_dim,
        "act_dim": act_dim,
        "continuous": continuous,
        "hidden_dim": hidden_dim,
        "steps_done": steps_done,
        "state_dict": policy.state_dict(),
        "optimizer_state": optimizer.state_dict(),
    }
    _save_checkpoint(ckpt_path, payload)
    _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", payload)
    ckpt_json = Path(checkpoint_dir) / f"ckpt_{total_steps}.json"
    with ckpt_json.open("w", encoding="utf-8") as handle:
        json.dump({"run_id": run_id, "step": steps_done, "metrics": {}, "path": str(ckpt_path)}, handle)
    print("[MAPPO-RNN] Training finished.")
