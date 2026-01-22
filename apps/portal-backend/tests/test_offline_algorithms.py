import importlib
import sys
from pathlib import Path

import numpy as np
import pytest


torch = pytest.importorskip("torch")

ROOT = Path(__file__).resolve().parents[1]
RUNNER_DIR = ROOT / "runner"
sys.path.insert(0, str(RUNNER_DIR))
offline_train = importlib.import_module("algorithms.offline_train")


def _build_dataset(tmp_path):
    obs = np.random.randn(50, 4).astype(np.float32)
    next_obs = np.random.randn(50, 4).astype(np.float32)
    actions = np.random.randint(0, 3, size=(50,)).astype(np.int64)
    rewards = np.random.randn(50).astype(np.float32)
    dones = np.random.randint(0, 2, size=(50,)).astype(np.float32)
    path = tmp_path / "dataset.npz"
    np.savez(path, observations=obs, actions=actions, rewards=rewards, next_observations=next_obs, terminals=dones)
    return path


def test_offline_bc_smoke(tmp_path):
    dataset_path = _build_dataset(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    config = {
        "algo": {"name": "BC"},
        "train": {"epochs": 1, "batchSize": 16},
    }
    offline_train.train(
        config,
        metrics_path=str(out_dir / "metrics.jsonl"),
        checkpoint_dir=str(out_dir / "checkpoints"),
        dataset_path=str(dataset_path),
    )
    assert (out_dir / "checkpoints" / "model_final.pt").exists()
