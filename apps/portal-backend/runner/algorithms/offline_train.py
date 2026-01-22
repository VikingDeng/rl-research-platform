import json
import os
import pickle
from pathlib import Path
from typing import Dict, Tuple, List, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim


def _load_dataset(path: str) -> Dict[str, np.ndarray]:
    if path.endswith(".npz"):
        data = np.load(path)
        return {k: data[k] for k in data.files}
    if path.endswith(".pkl") or path.endswith(".pickle"):
        with open(path, "rb") as f:
            data = pickle.load(f)
        if isinstance(data, dict):
            return {k: np.asarray(v) for k, v in data.items()}
        raise ValueError("pickle_dataset_must_be_dict")
    if path.endswith(".hdf5") or path.endswith(".h5"):
        try:
            import h5py
        except Exception as exc:
            raise ValueError("h5py_required_for_hdf5") from exc
        with h5py.File(path, "r") as f:
            return {k: np.asarray(f[k]) for k in f.keys()}
    if path.endswith(".jsonl"):
        obs, actions, rewards, next_obs, dones = [], [], [], [], []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                obs.append(row.get("obs") or row.get("observation"))
                actions.append(row.get("action"))
                rewards.append(row.get("reward"))
                next_obs.append(row.get("next_obs") or row.get("next_observation"))
                dones.append(row.get("done") or row.get("terminal") or row.get("termination", False))
        return {
            "observations": np.asarray(obs),
            "actions": np.asarray(actions),
            "rewards": np.asarray(rewards, dtype=np.float32),
            "next_observations": np.asarray(next_obs),
            "terminals": np.asarray(dones, dtype=np.float32),
        }
    raise ValueError("unsupported_dataset_format")


def _first_present(data: Dict[str, np.ndarray], keys: List[str]):
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return None


def _extract_arrays(data: Dict[str, np.ndarray]) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    obs = _first_present(data, ["observations", "obs"])
    actions = _first_present(data, ["actions", "acts"])
    rewards = _first_present(data, ["rewards", "rew"])
    next_obs = _first_present(data, ["next_observations", "next_obs"])
    dones = _first_present(data, ["terminals", "dones", "done"])
    if obs is None or actions is None or rewards is None or next_obs is None or dones is None:
        raise ValueError("dataset_missing_required_keys")
    return (
        np.asarray(obs, dtype=np.float32),
        np.asarray(actions),
        np.asarray(rewards, dtype=np.float32),
        np.asarray(next_obs, dtype=np.float32),
        np.asarray(dones, dtype=np.float32),
    )


def _infer_action_space(actions: np.ndarray) -> Tuple[bool, int]:
    if actions.ndim == 1:
        return True, int(actions.max()) + 1
    if actions.ndim == 2 and actions.shape[1] == 1:
        return True, int(actions.max()) + 1
    if np.issubdtype(actions.dtype, np.integer):
        return True, int(actions.max()) + 1
    return False, actions.shape[-1]


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


def _build_mlp(input_dim: int, output_dim: int, hidden=(256, 256)) -> nn.Sequential:
    layers = []
    last = input_dim
    for h in hidden:
        layers.append(nn.Linear(last, h))
        layers.append(nn.ReLU())
        last = h
    layers.append(nn.Linear(last, output_dim))
    return nn.Sequential(*layers)


class GaussianPolicy(nn.Module):
    def __init__(self, obs_dim: int, act_dim: int):
        super().__init__()
        self.net = _build_mlp(obs_dim, act_dim)
        self.log_std = nn.Parameter(torch.zeros(act_dim))

    def forward(self, obs: torch.Tensor):
        mean = self.net(obs)
        std = self.log_std.exp().expand_as(mean)
        dist = torch.distributions.Normal(mean, std)
        return dist


class QNetwork(nn.Module):
    def __init__(self, obs_dim: int, act_dim: int):
        super().__init__()
        self.net = _build_mlp(obs_dim + act_dim, 1)

    def forward(self, obs: torch.Tensor, act: torch.Tensor):
        return self.net(torch.cat([obs, act], dim=-1)).squeeze(-1)


class ValueNetwork(nn.Module):
    def __init__(self, obs_dim: int):
        super().__init__()
        self.net = _build_mlp(obs_dim, 1)

    def forward(self, obs: torch.Tensor):
        return self.net(obs).squeeze(-1)


def _batch_iter(batch_size: int, total: int):
    indices = np.arange(total)
    np.random.shuffle(indices)
    for start in range(0, total, batch_size):
        yield indices[start : start + batch_size]


def train(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None, dataset_path=None):
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    checkpoint_dir = checkpoint_dir or os.environ.get("CHECKPOINT_DIR", "./checkpoints")
    Path(checkpoint_dir).mkdir(parents=True, exist_ok=True)

    if not dataset_path or not os.path.exists(dataset_path):
        raise FileNotFoundError("dataset_path_missing")

    train_cfg = config.get("train", {}) if isinstance(config, dict) else {}
    algo_cfg = config.get("algo", {}) if isinstance(config, dict) else {}
    algo_name = str(algo_cfg.get("name", "BC")).upper()

    data = _load_dataset(dataset_path)
    obs, actions, rewards, next_obs, dones = _extract_arrays(data)

    discrete, act_dim = _infer_action_space(actions)
    if discrete:
        actions = actions.reshape(-1).astype(np.int64)
    else:
        actions = actions.astype(np.float32)

    obs_dim = obs.reshape(obs.shape[0], -1).shape[1]
    obs = obs.reshape(obs.shape[0], -1)
    next_obs = next_obs.reshape(next_obs.shape[0], -1)

    batch_size = int(train_cfg.get("batchSize", 256))
    epochs = int(train_cfg.get("epochs", 50))
    gamma = float(train_cfg.get("gamma", 0.99))
    lr = float(train_cfg.get("learningRate", 3e-4))
    checkpoint_every = int(train_cfg.get("checkpointEvery", max(5, epochs // 10)))

    device = torch.device("cpu")

    resume_path = _resolve_resume_path(config, checkpoint_dir)

    if algo_name == "BC":
        if discrete:
            policy = _build_mlp(obs_dim, act_dim)
            optimizer = optim.Adam(policy.parameters(), lr=lr)
            start_epoch = 0
            if resume_path:
                payload = torch.load(resume_path, map_location="cpu")
                if isinstance(payload, dict):
                    state = payload.get("policy_state")
                    opt_state = payload.get("optimizer_state")
                    start_epoch = int(payload.get("epoch", 0))
                    if state:
                        policy.load_state_dict(state)
                    if opt_state:
                        optimizer.load_state_dict(opt_state)
                    print(f"[Offline-BC] Resumed from {resume_path} at epoch {start_epoch}")
            for epoch in range(start_epoch, epochs):
                total_loss = 0.0
                for idx in _batch_iter(batch_size, obs.shape[0]):
                    obs_mb = torch.tensor(obs[idx], dtype=torch.float32, device=device)
                    act_mb = torch.tensor(actions[idx], dtype=torch.int64, device=device)
                    logits = policy(obs_mb)
                    loss = nn.CrossEntropyLoss()(logits, act_mb)
                    optimizer.zero_grad()
                    loss.backward()
                    optimizer.step()
                    total_loss += loss.item()
                if metrics_path:
                    with open(metrics_path, "a", encoding="utf-8") as handle:
                        handle.write(json.dumps({"step": epoch, "values": {"loss": total_loss}}) + "\n")
                if checkpoint_every > 0 and (epoch + 1) % checkpoint_every == 0:
                    payload = {
                        "algo": "BC",
                        "epoch": epoch + 1,
                        "policy_state": policy.state_dict(),
                        "optimizer_state": optimizer.state_dict(),
                    }
                    _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", payload)
        else:
            policy = _build_mlp(obs_dim, act_dim)
            optimizer = optim.Adam(policy.parameters(), lr=lr)
            start_epoch = 0
            if resume_path:
                payload = torch.load(resume_path, map_location="cpu")
                if isinstance(payload, dict):
                    state = payload.get("policy_state")
                    opt_state = payload.get("optimizer_state")
                    start_epoch = int(payload.get("epoch", 0))
                    if state:
                        policy.load_state_dict(state)
                    if opt_state:
                        optimizer.load_state_dict(opt_state)
                    print(f"[Offline-BC] Resumed from {resume_path} at epoch {start_epoch}")
            for epoch in range(start_epoch, epochs):
                total_loss = 0.0
                for idx in _batch_iter(batch_size, obs.shape[0]):
                    obs_mb = torch.tensor(obs[idx], dtype=torch.float32, device=device)
                    act_mb = torch.tensor(actions[idx], dtype=torch.float32, device=device)
                    pred = policy(obs_mb)
                    loss = nn.MSELoss()(pred, act_mb)
                    optimizer.zero_grad()
                    loss.backward()
                    optimizer.step()
                    total_loss += loss.item()
                if metrics_path:
                    with open(metrics_path, "a", encoding="utf-8") as handle:
                        handle.write(json.dumps({"step": epoch, "values": {"loss": total_loss}}) + "\n")
                if checkpoint_every > 0 and (epoch + 1) % checkpoint_every == 0:
                    payload = {
                        "algo": "BC",
                        "epoch": epoch + 1,
                        "policy_state": policy.state_dict(),
                        "optimizer_state": optimizer.state_dict(),
                    }
                    _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", payload)
        final_payload = {
            "algo": "BC",
            "epoch": epochs,
            "policy_state": policy.state_dict(),
            "optimizer_state": optimizer.state_dict(),
        }
        _save_checkpoint(Path(checkpoint_dir) / "model_final.pt", final_payload)
        _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", final_payload)
        return

    if algo_name == "CQL":
        if not discrete:
            raise ValueError("cql_requires_discrete_actions")
        q_net = _build_mlp(obs_dim, act_dim)
        target_net = _build_mlp(obs_dim, act_dim)
        target_net.load_state_dict(q_net.state_dict())
        optimizer = optim.Adam(q_net.parameters(), lr=lr)
        alpha = float(train_cfg.get("cqlAlpha", 1.0))
        start_epoch = 0
        if resume_path:
            payload = torch.load(resume_path, map_location="cpu")
            if isinstance(payload, dict):
                q_state = payload.get("q_state")
                target_state = payload.get("target_state")
                opt_state = payload.get("optimizer_state")
                start_epoch = int(payload.get("epoch", 0))
                if q_state:
                    q_net.load_state_dict(q_state)
                if target_state:
                    target_net.load_state_dict(target_state)
                if opt_state:
                    optimizer.load_state_dict(opt_state)
                print(f"[Offline-CQL] Resumed from {resume_path} at epoch {start_epoch}")
        for epoch in range(start_epoch, epochs):
            total_loss = 0.0
            for idx in _batch_iter(batch_size, obs.shape[0]):
                obs_mb = torch.tensor(obs[idx], dtype=torch.float32, device=device)
                act_mb = torch.tensor(actions[idx], dtype=torch.int64, device=device)
                rew_mb = torch.tensor(rewards[idx], dtype=torch.float32, device=device)
                next_mb = torch.tensor(next_obs[idx], dtype=torch.float32, device=device)
                done_mb = torch.tensor(dones[idx], dtype=torch.float32, device=device)

                q_values = q_net(obs_mb)
                q_taken = q_values.gather(1, act_mb.unsqueeze(-1)).squeeze(-1)
                with torch.no_grad():
                    q_next = target_net(next_mb).max(dim=1)[0]
                target = rew_mb + gamma * (1.0 - done_mb) * q_next
                td_loss = nn.MSELoss()(q_taken, target)
                cql_loss = (torch.logsumexp(q_values, dim=1) - q_taken).mean()
                loss = td_loss + alpha * cql_loss

                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                total_loss += loss.item()
            target_net.load_state_dict(q_net.state_dict())
            if metrics_path:
                with open(metrics_path, "a", encoding="utf-8") as handle:
                    handle.write(json.dumps({"step": epoch, "values": {"loss": total_loss}}) + "\n")
            if checkpoint_every > 0 and (epoch + 1) % checkpoint_every == 0:
                payload = {
                    "algo": "CQL",
                    "epoch": epoch + 1,
                    "q_state": q_net.state_dict(),
                    "target_state": target_net.state_dict(),
                    "optimizer_state": optimizer.state_dict(),
                }
                _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", payload)
        final_payload = {
            "algo": "CQL",
            "epoch": epochs,
            "q_state": q_net.state_dict(),
            "target_state": target_net.state_dict(),
            "optimizer_state": optimizer.state_dict(),
        }
        _save_checkpoint(Path(checkpoint_dir) / "model_final.pt", final_payload)
        _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", final_payload)
        return

    if algo_name == "IQL":
        if discrete:
            raise ValueError("iql_requires_continuous_actions")
        actor = GaussianPolicy(obs_dim, act_dim)
        q1 = QNetwork(obs_dim, act_dim)
        q2 = QNetwork(obs_dim, act_dim)
        v = ValueNetwork(obs_dim)
        actor_opt = optim.Adam(actor.parameters(), lr=lr)
        q_opt = optim.Adam(list(q1.parameters()) + list(q2.parameters()), lr=lr)
        v_opt = optim.Adam(v.parameters(), lr=lr)
        expectile = float(train_cfg.get("expectile", 0.7))
        beta = float(train_cfg.get("beta", 3.0))

        start_epoch = 0
        if resume_path:
            payload = torch.load(resume_path, map_location="cpu")
            if isinstance(payload, dict):
                actor_state = payload.get("actor_state")
                q1_state = payload.get("q1_state")
                q2_state = payload.get("q2_state")
                v_state = payload.get("v_state")
                actor_opt_state = payload.get("actor_opt_state")
                q_opt_state = payload.get("q_opt_state")
                v_opt_state = payload.get("v_opt_state")
                start_epoch = int(payload.get("epoch", 0))
                if actor_state:
                    actor.load_state_dict(actor_state)
                if q1_state:
                    q1.load_state_dict(q1_state)
                if q2_state:
                    q2.load_state_dict(q2_state)
                if v_state:
                    v.load_state_dict(v_state)
                if actor_opt_state:
                    actor_opt.load_state_dict(actor_opt_state)
                if q_opt_state:
                    q_opt.load_state_dict(q_opt_state)
                if v_opt_state:
                    v_opt.load_state_dict(v_opt_state)
                print(f"[Offline-IQL] Resumed from {resume_path} at epoch {start_epoch}")

        for epoch in range(start_epoch, epochs):
            total_loss = 0.0
            for idx in _batch_iter(batch_size, obs.shape[0]):
                obs_mb = torch.tensor(obs[idx], dtype=torch.float32, device=device)
                act_mb = torch.tensor(actions[idx], dtype=torch.float32, device=device)
                rew_mb = torch.tensor(rewards[idx], dtype=torch.float32, device=device)
                next_mb = torch.tensor(next_obs[idx], dtype=torch.float32, device=device)
                done_mb = torch.tensor(dones[idx], dtype=torch.float32, device=device)

                with torch.no_grad():
                    q1_val = q1(obs_mb, act_mb)
                    q2_val = q2(obs_mb, act_mb)
                    q_min = torch.min(q1_val, q2_val)

                v_pred = v(obs_mb)
                diff = q_min - v_pred
                weight = torch.where(diff > 0, expectile, 1 - expectile)
                v_loss = (weight * diff.pow(2)).mean()
                v_opt.zero_grad()
                v_loss.backward()
                v_opt.step()

                with torch.no_grad():
                    v_next = v(next_mb)
                target_q = rew_mb + gamma * (1.0 - done_mb) * v_next
                q1_pred = q1(obs_mb, act_mb)
                q2_pred = q2(obs_mb, act_mb)
                q_loss = nn.MSELoss()(q1_pred, target_q) + nn.MSELoss()(q2_pred, target_q)
                q_opt.zero_grad()
                q_loss.backward()
                q_opt.step()

                dist = actor(obs_mb)
                log_prob = dist.log_prob(act_mb).sum(-1)
                adv = (q_min - v_pred).detach()
                weights = torch.exp(adv / beta).clamp(max=100.0)
                actor_loss = -(weights * log_prob).mean()
                actor_opt.zero_grad()
                actor_loss.backward()
                actor_opt.step()
                total_loss += (v_loss + q_loss + actor_loss).item()

            if metrics_path:
                with open(metrics_path, "a", encoding="utf-8") as handle:
                    handle.write(json.dumps({"step": epoch, "values": {"loss": total_loss}}) + "\n")

            if checkpoint_every > 0 and (epoch + 1) % checkpoint_every == 0:
                payload = {
                    "algo": "IQL",
                    "epoch": epoch + 1,
                    "actor_state": actor.state_dict(),
                    "q1_state": q1.state_dict(),
                    "q2_state": q2.state_dict(),
                    "v_state": v.state_dict(),
                    "actor_opt_state": actor_opt.state_dict(),
                    "q_opt_state": q_opt.state_dict(),
                    "v_opt_state": v_opt.state_dict(),
                }
                _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", payload)

        final_payload = {
            "algo": "IQL",
            "epoch": epochs,
            "actor_state": actor.state_dict(),
            "q1_state": q1.state_dict(),
            "q2_state": q2.state_dict(),
            "v_state": v.state_dict(),
            "actor_opt_state": actor_opt.state_dict(),
            "q_opt_state": q_opt.state_dict(),
            "v_opt_state": v_opt.state_dict(),
        }
        _save_checkpoint(Path(checkpoint_dir) / "model_final.pt", final_payload)
        _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", final_payload)
        return

    if algo_name in {"TD3BC", "TD3+BC"}:
        if discrete:
            raise ValueError("td3bc_requires_continuous_actions")
        actor = _build_mlp(obs_dim, act_dim)
        actor_target = _build_mlp(obs_dim, act_dim)
        actor_target.load_state_dict(actor.state_dict())
        q1 = QNetwork(obs_dim, act_dim)
        q2 = QNetwork(obs_dim, act_dim)
        q1_target = QNetwork(obs_dim, act_dim)
        q2_target = QNetwork(obs_dim, act_dim)
        q1_target.load_state_dict(q1.state_dict())
        q2_target.load_state_dict(q2.state_dict())

        actor_opt = optim.Adam(actor.parameters(), lr=lr)
        q_opt = optim.Adam(list(q1.parameters()) + list(q2.parameters()), lr=lr)
        alpha = float(train_cfg.get("bcAlpha", 2.5))
        tau = float(train_cfg.get("targetTau", 0.005))
        policy_delay = int(train_cfg.get("policyDelay", 2))
        noise_std = float(train_cfg.get("targetNoise", 0.2))
        noise_clip = float(train_cfg.get("noiseClip", 0.5))

        step = 0
        start_epoch = 0
        if resume_path:
            payload = torch.load(resume_path, map_location="cpu")
            if isinstance(payload, dict):
                actor_state = payload.get("actor_state")
                actor_target_state = payload.get("actor_target_state")
                q1_state = payload.get("q1_state")
                q2_state = payload.get("q2_state")
                q1_target_state = payload.get("q1_target_state")
                q2_target_state = payload.get("q2_target_state")
                actor_opt_state = payload.get("actor_opt_state")
                q_opt_state = payload.get("q_opt_state")
                start_epoch = int(payload.get("epoch", 0))
                step = int(payload.get("step", 0))
                if actor_state:
                    actor.load_state_dict(actor_state)
                if actor_target_state:
                    actor_target.load_state_dict(actor_target_state)
                if q1_state:
                    q1.load_state_dict(q1_state)
                if q2_state:
                    q2.load_state_dict(q2_state)
                if q1_target_state:
                    q1_target.load_state_dict(q1_target_state)
                if q2_target_state:
                    q2_target.load_state_dict(q2_target_state)
                if actor_opt_state:
                    actor_opt.load_state_dict(actor_opt_state)
                if q_opt_state:
                    q_opt.load_state_dict(q_opt_state)
                print(f"[Offline-TD3BC] Resumed from {resume_path} at epoch {start_epoch}")

        for epoch in range(start_epoch, epochs):
            total_loss = 0.0
            for idx in _batch_iter(batch_size, obs.shape[0]):
                step += 1
                obs_mb = torch.tensor(obs[idx], dtype=torch.float32, device=device)
                act_mb = torch.tensor(actions[idx], dtype=torch.float32, device=device)
                rew_mb = torch.tensor(rewards[idx], dtype=torch.float32, device=device)
                next_mb = torch.tensor(next_obs[idx], dtype=torch.float32, device=device)
                done_mb = torch.tensor(dones[idx], dtype=torch.float32, device=device)

                with torch.no_grad():
                    noise = torch.randn_like(act_mb) * noise_std
                    noise = noise.clamp(-noise_clip, noise_clip)
                    next_action = actor_target(next_mb) + noise
                    q1_next = q1_target(next_mb, next_action)
                    q2_next = q2_target(next_mb, next_action)
                    q_next = torch.min(q1_next, q2_next)
                    target_q = rew_mb + gamma * (1.0 - done_mb) * q_next

                q1_pred = q1(obs_mb, act_mb)
                q2_pred = q2(obs_mb, act_mb)
                q_loss = nn.MSELoss()(q1_pred, target_q) + nn.MSELoss()(q2_pred, target_q)
                q_opt.zero_grad()
                q_loss.backward()
                q_opt.step()

                if step % policy_delay == 0:
                    action_pred = actor(obs_mb)
                    bc_loss = nn.MSELoss()(action_pred, act_mb)
                    actor_loss = -q1(obs_mb, action_pred).mean() + alpha * bc_loss
                    actor_opt.zero_grad()
                    actor_loss.backward()
                    actor_opt.step()

                    for target_param, param in zip(actor_target.parameters(), actor.parameters()):
                        target_param.data.copy_(tau * param.data + (1 - tau) * target_param.data)
                    for target_param, param in zip(q1_target.parameters(), q1.parameters()):
                        target_param.data.copy_(tau * param.data + (1 - tau) * target_param.data)
                    for target_param, param in zip(q2_target.parameters(), q2.parameters()):
                        target_param.data.copy_(tau * param.data + (1 - tau) * target_param.data)

                total_loss += q_loss.item()

            if metrics_path:
                with open(metrics_path, "a", encoding="utf-8") as handle:
                    handle.write(json.dumps({"step": epoch, "values": {"loss": total_loss}}) + "\n")

            if checkpoint_every > 0 and (epoch + 1) % checkpoint_every == 0:
                payload = {
                    "algo": "TD3BC",
                    "epoch": epoch + 1,
                    "step": step,
                    "actor_state": actor.state_dict(),
                    "actor_target_state": actor_target.state_dict(),
                    "q1_state": q1.state_dict(),
                    "q2_state": q2.state_dict(),
                    "q1_target_state": q1_target.state_dict(),
                    "q2_target_state": q2_target.state_dict(),
                    "actor_opt_state": actor_opt.state_dict(),
                    "q_opt_state": q_opt.state_dict(),
                }
                _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", payload)

        final_payload = {
            "algo": "TD3BC",
            "epoch": epochs,
            "step": step,
            "actor_state": actor.state_dict(),
            "actor_target_state": actor_target.state_dict(),
            "q1_state": q1.state_dict(),
            "q2_state": q2.state_dict(),
            "q1_target_state": q1_target.state_dict(),
            "q2_target_state": q2_target.state_dict(),
            "actor_opt_state": actor_opt.state_dict(),
            "q_opt_state": q_opt.state_dict(),
        }
        _save_checkpoint(Path(checkpoint_dir) / "model_final.pt", final_payload)
        _save_checkpoint(Path(checkpoint_dir) / "model_latest.pt", final_payload)
        return

    raise ValueError("unknown_offline_algorithm")
