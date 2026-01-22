import json
import os
from pathlib import Path
from typing import Dict, List, Optional

import importlib
import numpy as np
import torch

from algorithms.mappo_train import MAPPOPolicy
from algorithms.qmix_train import AgentQNet, QMixer
from algorithms.mappo_rnn_train import RNNPolicy as MAPPO_RNNPolicy
from algorithms.qmix_rnn_train import DRQN, QMixer as RNN_QMixer


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


def _load_checkpoint(path: str) -> dict:
    payload = torch.load(path, map_location="cpu")
    if isinstance(payload, dict) and "algo" in payload:
        return payload
    return {"algo": "unknown", "state_dict": payload}


def _eval_mappo(env, policy: MAPPOPolicy, episodes: int, seeds: List[int]) -> List[float]:
    returns = []
    for seed in seeds:
        obs_dict = env.reset(seed=seed)
        if isinstance(obs_dict, tuple):
            obs_dict = obs_dict[0]
        agents = list(obs_dict.keys())
        n_agents = len(agents)
        obs_dim = _flat_obs(obs_dict[agents[0]]).shape[0]
        global_dim = obs_dim * n_agents
        for _ in range(episodes):
            done_flags = np.zeros(n_agents, dtype=bool)
            episode_return = 0.0
            while not np.all(done_flags):
                obs_arr = np.stack([_flat_obs(obs_dict[a]) for a in agents], axis=0)
                global_obs = obs_arr.reshape(1, -1).repeat(n_agents, axis=0)
                with torch.no_grad():
                    logits = policy.actor(torch.tensor(obs_arr, dtype=torch.float32))
                    if policy.continuous:
                        action = logits.cpu().numpy()
                        action_dict = {agent: action[idx] for idx, agent in enumerate(agents)}
                    else:
                        action = torch.argmax(logits, dim=-1).cpu().numpy()
                        action_dict = {agent: int(action[idx]) for idx, agent in enumerate(agents)}
                next_obs, rewards, terminations, truncations, _ = env.step(action_dict)
                reward = float(np.mean([rewards.get(a, 0.0) for a in agents]))
                episode_return += reward
                done_flags = np.array(
                    [terminations.get(a, False) or truncations.get(a, False) for a in agents],
                    dtype=bool,
                )
                obs_dict = next_obs
            returns.append(episode_return)
            obs_dict = env.reset()
            if isinstance(obs_dict, tuple):
                obs_dict = obs_dict[0]
    return returns


def _eval_mappo_rnn(env, policy: MAPPO_RNNPolicy, episodes: int, seeds: List[int]) -> List[float]:
    returns = []
    hidden_dim = policy.actor_rnn.hidden_size
    for seed in seeds:
        obs_dict = env.reset(seed=seed)
        if isinstance(obs_dict, tuple):
            obs_dict = obs_dict[0]
        agents = list(obs_dict.keys())
        n_agents = len(agents)
        h_actor = torch.zeros(1, n_agents, hidden_dim)
        h_critic = torch.zeros(1, n_agents, hidden_dim)
        for _ in range(episodes):
            done_flags = np.zeros(n_agents, dtype=bool)
            episode_return = 0.0
            while not np.all(done_flags):
                obs_arr = np.stack([_flat_obs(obs_dict[a]) for a in agents], axis=0)
                global_obs = obs_arr.reshape(1, -1).repeat(n_agents, axis=0)
                with torch.no_grad():
                    actions, _, _, h_actor, h_critic = policy.act_step(
                        torch.tensor(obs_arr, dtype=torch.float32),
                        torch.tensor(global_obs, dtype=torch.float32),
                        h_actor,
                        h_critic,
                    )
                if policy.continuous:
                    action_np = actions.cpu().numpy()
                    action_dict = {agent: action_np[idx] for idx, agent in enumerate(agents)}
                else:
                    action_np = actions.cpu().numpy().astype(int)
                    action_dict = {agent: int(action_np[idx]) for idx, agent in enumerate(agents)}
                next_obs, rewards, terminations, truncations, _ = env.step(action_dict)
                reward = float(np.mean([rewards.get(a, 0.0) for a in agents]))
                episode_return += reward
                done_flags = np.array(
                    [terminations.get(a, False) or truncations.get(a, False) for a in agents],
                    dtype=bool,
                )
                if np.all(done_flags):
                    h_actor = torch.zeros_like(h_actor)
                    h_critic = torch.zeros_like(h_critic)
                obs_dict = next_obs
            returns.append(episode_return)
            obs_dict = env.reset()
            if isinstance(obs_dict, tuple):
                obs_dict = obs_dict[0]
            h_actor = torch.zeros_like(h_actor)
            h_critic = torch.zeros_like(h_critic)
    return returns


def _eval_qmix(env, agent_net, mixer, episodes: int, seeds: List[int]) -> List[float]:
    returns = []
    for seed in seeds:
        obs_dict = env.reset(seed=seed)
        if isinstance(obs_dict, tuple):
            obs_dict = obs_dict[0]
        agents = list(obs_dict.keys())
        n_agents = len(agents)
        for _ in range(episodes):
            done_flags = np.zeros(n_agents, dtype=bool)
            episode_return = 0.0
            while not np.all(done_flags):
                obs_arr = np.stack([_flat_obs(obs_dict[a]) for a in agents], axis=0)
                with torch.no_grad():
                    q_values = agent_net(torch.tensor(obs_arr, dtype=torch.float32))
                    actions = torch.argmax(q_values, dim=-1).cpu().numpy()
                action_dict = {agent: int(actions[idx]) for idx, agent in enumerate(agents)}
                next_obs, rewards, terminations, truncations, _ = env.step(action_dict)
                reward = float(np.mean([rewards.get(a, 0.0) for a in agents]))
                episode_return += reward
                done_flags = np.array(
                    [terminations.get(a, False) or truncations.get(a, False) for a in agents],
                    dtype=bool,
                )
                obs_dict = next_obs
            returns.append(episode_return)
            obs_dict = env.reset()
            if isinstance(obs_dict, tuple):
                obs_dict = obs_dict[0]
    return returns


def _eval_qmix_rnn(env, agent_net, episodes: int, seeds: List[int]) -> List[float]:
    returns = []
    hidden_dim = agent_net.rnn.hidden_size
    for seed in seeds:
        obs_dict = env.reset(seed=seed)
        if isinstance(obs_dict, tuple):
            obs_dict = obs_dict[0]
        agents = list(obs_dict.keys())
        n_agents = len(agents)
        h = torch.zeros(1, n_agents, hidden_dim)
        for _ in range(episodes):
            done_flags = np.zeros(n_agents, dtype=bool)
            episode_return = 0.0
            while not np.all(done_flags):
                obs_arr = np.stack([_flat_obs(obs_dict[a]) for a in agents], axis=0)
                with torch.no_grad():
                    q_seq, h = agent_net(torch.tensor(obs_arr, dtype=torch.float32).unsqueeze(0), h)
                    q_values = q_seq.squeeze(0)
                    actions = torch.argmax(q_values, dim=-1).cpu().numpy()
                action_dict = {agent: int(actions[idx]) for idx, agent in enumerate(agents)}
                next_obs, rewards, terminations, truncations, _ = env.step(action_dict)
                reward = float(np.mean([rewards.get(a, 0.0) for a in agents]))
                episode_return += reward
                done_flags = np.array(
                    [terminations.get(a, False) or truncations.get(a, False) for a in agents],
                    dtype=bool,
                )
                if np.all(done_flags):
                    h = torch.zeros_like(h)
                obs_dict = next_obs
            returns.append(episode_return)
            obs_dict = env.reset()
            if isinstance(obs_dict, tuple):
                obs_dict = obs_dict[0]
            h = torch.zeros_like(h)
    return returns


def evaluate(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None, output_dir=None):
    output_dir = output_dir or os.environ.get("OUTPUT_DIR", ".")
    env_cfg = config.get("env") or config.get("protocol", {}).get("env") or {}
    if env is None:
        env = _make_env(env_cfg)

    model_path = config.get("modelPath")
    if not model_path:
        raise FileNotFoundError("model_path_missing")

    payload = _load_checkpoint(model_path)
    algo = str(payload.get("algo", "unknown")).lower()
    episodes = int(config.get("episodesPerMatch", 10))
    seeds = config.get("evalSeeds") or config.get("protocol", {}).get("evalSeeds") or [0]

    returns: List[float] = []
    if algo == "mappo":
        policy = MAPPOPolicy(
            payload["obs_dim"],
            payload["global_dim"],
            payload["act_dim"],
            payload.get("continuous", False),
            actor_hidden=tuple(payload.get("actor_hidden", [128, 128])),
            critic_hidden=tuple(payload.get("critic_hidden", [128, 128])),
        )
        policy.load_state_dict(payload["state_dict"])
        returns = _eval_mappo(env, policy, episodes, seeds)
    elif algo == "mappo_rnn":
        policy = MAPPO_RNNPolicy(
            payload["obs_dim"], payload["global_dim"], payload["act_dim"], payload["hidden_dim"], payload.get("continuous", False)
        )
        policy.load_state_dict(payload["state_dict"])
        returns = _eval_mappo_rnn(env, policy, episodes, seeds)
    elif algo in {"qmix", "vdn"}:
        agent_net = AgentQNet(payload["obs_dim"], payload["act_dim"], hidden=tuple(payload.get("hidden", [128, 128])))
        agent_net.load_state_dict(payload["agent_net"])
        mixer = None
        if not payload.get("vdn"):
            mixer = QMixer(payload["n_agents"], payload["state_dim"], embed_dim=payload.get("mixer_embed", 32))
            mixer.load_state_dict(payload["mixer"])
        returns = _eval_qmix(env, agent_net, mixer, episodes, seeds)
    elif algo in {"qmix_rnn", "vdn_rnn"}:
        agent_net = DRQN(payload["obs_dim"], payload["act_dim"], payload.get("hidden_dim", 64))
        agent_net.load_state_dict(payload["agent_net"])
        returns = _eval_qmix_rnn(env, agent_net, episodes, seeds)
    else:
        raise ValueError("unsupported_marl_checkpoint")

    summary = {
        "mean": float(np.mean(returns)) if returns else 0.0,
        "std": float(np.std(returns)) if returns else 0.0,
        "count": len(returns),
    }

    eval_dir = Path(output_dir) / "eval"
    eval_dir.mkdir(parents=True, exist_ok=True)
    (eval_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    (eval_dir / "results.json").write_text(json.dumps(returns, indent=2))

    if metrics_path:
        with open(metrics_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"step": 0, "values": {"returnMean": summary["mean"]}}) + "\n")

    return summary
