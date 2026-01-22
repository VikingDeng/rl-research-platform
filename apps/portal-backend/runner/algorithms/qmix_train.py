import json
import os
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

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


class AgentQNet(nn.Module):
    def __init__(self, obs_dim: int, act_dim: int, hidden=(128, 128)):
        super().__init__()
        layers: List[nn.Module] = []
        last = obs_dim
        for h in hidden:
            layers.append(nn.Linear(last, h))
            layers.append(nn.ReLU())
            last = h
        layers.append(nn.Linear(last, act_dim))
        self.net = nn.Sequential(*layers)

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        return self.net(obs)


class QMixer(nn.Module):
    def __init__(self, n_agents: int, state_dim: int, embed_dim: int = 32):
        super().__init__()
        self.n_agents = n_agents
        self.embed_dim = embed_dim
        self.hyper_w1 = nn.Linear(state_dim, n_agents * embed_dim)
        self.hyper_b1 = nn.Linear(state_dim, embed_dim)
        self.hyper_w2 = nn.Linear(state_dim, embed_dim)
        self.hyper_b2 = nn.Sequential(nn.Linear(state_dim, embed_dim), nn.ReLU(), nn.Linear(embed_dim, 1))

    def forward(self, agent_qs: torch.Tensor, states: torch.Tensor) -> torch.Tensor:
        batch_size = agent_qs.size(0)
        w1 = torch.abs(self.hyper_w1(states)).view(batch_size, self.n_agents, self.embed_dim)
        b1 = self.hyper_b1(states).view(batch_size, 1, self.embed_dim)
        hidden = torch.bmm(agent_qs.unsqueeze(1), w1).squeeze(1) + b1.squeeze(1)
        hidden = torch.relu(hidden)
        w2 = torch.abs(self.hyper_w2(states)).view(batch_size, self.embed_dim, 1)
        b2 = self.hyper_b2(states).view(batch_size, 1)
        y = torch.bmm(hidden.unsqueeze(1), w2).squeeze(1) + b2
        return y.squeeze(-1)


@dataclass
class Transition:
    obs: np.ndarray
    next_obs: np.ndarray
    state: np.ndarray
    next_state: np.ndarray
    actions: np.ndarray
    reward: float
    done: float


class ReplayBuffer:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.storage: List[Transition] = []
        self.idx = 0

    def add(self, transition: Transition) -> None:
        if len(self.storage) < self.capacity:
            self.storage.append(transition)
        else:
            self.storage[self.idx] = transition
        self.idx = (self.idx + 1) % self.capacity

    def sample(self, batch_size: int) -> List[Transition]:
        return random.sample(self.storage, batch_size)

    def __len__(self) -> int:
        return len(self.storage)


def train(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None):
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    checkpoint_dir = checkpoint_dir or os.environ.get("CHECKPOINT_DIR", "./checkpoints")
    Path(checkpoint_dir).mkdir(parents=True, exist_ok=True)

    train_cfg = config.get("train", {}) if isinstance(config, dict) else {}
    total_steps = int(train_cfg.get("totalEnvSteps", 200000))
    batch_size = int(train_cfg.get("batchSize", 256))
    gamma = float(train_cfg.get("gamma", 0.99))
    lr = float(train_cfg.get("learningRate", 3e-4))
    buffer_size = int(train_cfg.get("replaySize", 50000))
    start_steps = int(train_cfg.get("startSteps", 1000))
    train_freq = int(train_cfg.get("trainFreq", 4))
    target_tau = float(train_cfg.get("targetTau", 0.005))
    epsilon = float(train_cfg.get("epsilon", 1.0))
    epsilon_min = float(train_cfg.get("epsilonMin", 0.05))
    epsilon_decay = float(train_cfg.get("epsilonDecay", 0.9995))
    checkpoint_every = int(train_cfg.get("checkpointEvery", max(1000, total_steps // 10)))

    algo_cfg = config.get("algo", {}) if isinstance(config, dict) else {}
    algo_name = str(algo_cfg.get("name", "QMIX")).upper()
    use_vdn = algo_name == "VDN"
    network_cfg = config.get("network", {}) if isinstance(config, dict) else {}
    hidden = tuple(network_cfg.get("hidden") or [128, 128])
    mixer_embed = int(network_cfg.get("mixerEmbed", 32))

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
    if not hasattr(sample_space, "n"):
        raise ValueError("qmix_requires_discrete_action_space")
    act_dim = int(sample_space.n)

    state_dim = obs_dim * n_agents

    agent_net = AgentQNet(obs_dim, act_dim, hidden=hidden)
    target_agent_net = AgentQNet(obs_dim, act_dim, hidden=hidden)
    target_agent_net.load_state_dict(agent_net.state_dict())

    mixer = QMixer(n_agents, state_dim, embed_dim=mixer_embed) if not use_vdn else None
    target_mixer = QMixer(n_agents, state_dim, embed_dim=mixer_embed) if not use_vdn else None
    if mixer and target_mixer:
        target_mixer.load_state_dict(mixer.state_dict())

    params = list(agent_net.parameters()) + (list(mixer.parameters()) if mixer else [])
    optimizer = optim.Adam(params, lr=lr)

    buffer = ReplayBuffer(buffer_size)
    episode_rewards: List[float] = []
    episode_return = 0.0

    steps_done = 0
    resume_path = _resolve_resume_path(config, checkpoint_dir)
    if resume_path:
        payload = torch.load(resume_path, map_location="cpu")
        if isinstance(payload, dict):
            agent_state = payload.get("agent_net")
            mixer_state = payload.get("mixer")
            target_agent_state = payload.get("target_agent_net")
            target_mixer_state = payload.get("target_mixer")
            opt_state = payload.get("optimizer_state")
            if agent_state:
                agent_net.load_state_dict(agent_state)
            if mixer_state and mixer:
                mixer.load_state_dict(mixer_state)
            if target_agent_state:
                target_agent_net.load_state_dict(target_agent_state)
            if target_mixer_state and target_mixer:
                target_mixer.load_state_dict(target_mixer_state)
            if opt_state:
                optimizer.load_state_dict(opt_state)
            steps_done = int(payload.get("steps_done", 0))
            epsilon = float(payload.get("epsilon", epsilon))
            print(f"[QMIX] Resumed from {resume_path} at step {steps_done}")

    last_checkpoint = steps_done
    while steps_done < total_steps:
        obs_arr = np.stack([_flat_obs(obs_dict[a]) for a in agents], axis=0)
        state = obs_arr.reshape(-1)

        with torch.no_grad():
            q_values = agent_net(torch.tensor(obs_arr, dtype=torch.float32))
        actions = []
        for idx in range(n_agents):
            if random.random() < epsilon:
                actions.append(random.randrange(act_dim))
            else:
                actions.append(int(torch.argmax(q_values[idx]).item()))

        action_dict = {agent: actions[i] for i, agent in enumerate(agents)}
        next_obs, rewards, terminations, truncations, infos = env.step(action_dict)

        done_flags = np.array(
            [terminations.get(a, False) or truncations.get(a, False) for a in agents],
            dtype=np.float32,
        )
        reward = float(np.mean([rewards.get(a, 0.0) for a in agents]))

        next_obs_arr = np.stack([_flat_obs(next_obs[a]) for a in agents], axis=0)
        next_state = next_obs_arr.reshape(-1)

        buffer.add(
            Transition(
                obs=obs_arr,
                next_obs=next_obs_arr,
                state=state,
                next_state=next_state,
                actions=np.array(actions, dtype=np.int64),
                reward=reward,
                done=float(np.all(done_flags)),
            )
        )

        obs_dict = next_obs
        episode_return += reward
        steps_done += n_agents

        if np.all(done_flags):
            episode_rewards.append(episode_return)
            episode_return = 0.0
            obs_dict = env.reset()
            if isinstance(obs_dict, tuple):
                obs_dict = obs_dict[0]

        epsilon = max(epsilon * epsilon_decay, epsilon_min)

        if len(buffer) >= max(start_steps, batch_size) and steps_done % train_freq == 0:
            batch = buffer.sample(batch_size)
            obs_batch = torch.tensor(np.stack([t.obs for t in batch]), dtype=torch.float32)
            next_obs_batch = torch.tensor(np.stack([t.next_obs for t in batch]), dtype=torch.float32)
            state_batch = torch.tensor(np.stack([t.state for t in batch]), dtype=torch.float32)
            next_state_batch = torch.tensor(np.stack([t.next_state for t in batch]), dtype=torch.float32)
            actions_batch = torch.tensor(np.stack([t.actions for t in batch]), dtype=torch.int64)
            rewards_batch = torch.tensor([t.reward for t in batch], dtype=torch.float32)
            done_batch = torch.tensor([t.done for t in batch], dtype=torch.float32)

            q_eval = agent_net(obs_batch.view(-1, obs_dim)).view(batch_size, n_agents, act_dim)
            q_eval_chosen = torch.gather(q_eval, dim=2, index=actions_batch.unsqueeze(-1)).squeeze(-1)

            with torch.no_grad():
                q_next = target_agent_net(next_obs_batch.view(-1, obs_dim)).view(batch_size, n_agents, act_dim)
                q_next_max = q_next.max(dim=2)[0]

            if use_vdn:
                q_total = q_eval_chosen.sum(dim=1)
                target_total = q_next_max.sum(dim=1)
            else:
                q_total = mixer(q_eval_chosen, state_batch)
                target_total = target_mixer(q_next_max, next_state_batch)

            targets = rewards_batch + gamma * (1.0 - done_batch) * target_total
            loss = ((q_total - targets.detach()) ** 2).mean()

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            for target_param, param in zip(target_agent_net.parameters(), agent_net.parameters()):
                target_param.data.copy_(target_tau * param.data + (1 - target_tau) * target_param.data)
            if mixer and target_mixer:
                for target_param, param in zip(target_mixer.parameters(), mixer.parameters()):
                    target_param.data.copy_(target_tau * param.data + (1 - target_tau) * target_param.data)

        if metrics_path and steps_done % (train_freq * 50) == 0:
            mean_reward = float(np.mean(episode_rewards[-10:])) if episode_rewards else 0.0
            with open(metrics_path, "a", encoding="utf-8") as handle:
                handle.write(json.dumps({"step": steps_done, "values": {"returnMean": mean_reward}}) + "\n")

        if checkpoint_every > 0 and steps_done - last_checkpoint >= checkpoint_every:
            payload = {
                "algo": "qmix" if not use_vdn else "vdn",
                "obs_dim": obs_dim,
                "state_dim": state_dim,
                "act_dim": act_dim,
                "n_agents": n_agents,
                "vdn": use_vdn,
                "hidden": list(hidden),
                "mixer_embed": mixer_embed,
                "steps_done": steps_done,
                "epsilon": epsilon,
                "agent_net": agent_net.state_dict(),
                "target_agent_net": target_agent_net.state_dict(),
                "mixer": mixer.state_dict() if mixer else None,
                "target_mixer": target_mixer.state_dict() if target_mixer else None,
                "optimizer_state": optimizer.state_dict(),
            }
            _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", payload)
            last_checkpoint = steps_done

    ckpt_path = Path(checkpoint_dir) / "model_final.pt"
    payload = {
        "algo": "qmix" if not use_vdn else "vdn",
        "obs_dim": obs_dim,
        "state_dim": state_dim,
        "act_dim": act_dim,
        "n_agents": n_agents,
        "vdn": use_vdn,
        "hidden": list(hidden),
        "mixer_embed": mixer_embed,
        "steps_done": steps_done,
        "epsilon": epsilon,
        "agent_net": agent_net.state_dict(),
        "target_agent_net": target_agent_net.state_dict(),
        "mixer": mixer.state_dict() if mixer else None,
        "target_mixer": target_mixer.state_dict() if target_mixer else None,
        "optimizer_state": optimizer.state_dict(),
    }
    _save_checkpoint(ckpt_path, payload)
    _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", payload)
    ckpt_json = Path(checkpoint_dir) / f"ckpt_{total_steps}.json"
    with ckpt_json.open("w", encoding="utf-8") as handle:
        json.dump({"run_id": run_id, "step": steps_done, "metrics": {}, "path": str(ckpt_path)}, handle)
    print("[QMIX] Training finished.")
