#!/bin/sh
set -e

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"

if [ -f "$BACKEND_DIR/.env" ]; then
  set -a
  . "$BACKEND_DIR/.env"
  set +a
fi

PYTHON="$BACKEND_DIR/.venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  PYTHON=python3
fi

PYTHONPATH="$BACKEND_DIR" "$PYTHON" - <<'PY'
import json
import importlib.util
from app.db import models
from app.db.session import SessionLocal

# --- Data Definitions ---

ENV_DEFS = [
    {
        "env_id": "gym-classic",
        "version": "1.0.0",
        "api_mode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [
            {"id": "CartPole-v1", "maps": ["CartPole-v1"]},
            {"id": "MountainCar-v0", "maps": ["MountainCar-v0"]},
            {"id": "Acrobot-v1", "maps": ["Acrobot-v1"]},
            {"id": "Pendulum-v1", "maps": ["Pendulum-v1"]},
            {"id": "MountainCarContinuous-v0", "maps": ["MountainCarContinuous-v0"]},
        ],
        "scenario_schema": {"type": "object", "properties": {}},
    },
    {
        "env_id": "gym-toytext",
        "version": "1.0.0",
        "api_mode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [
            {"id": "FrozenLake-v1", "maps": ["FrozenLake-v1"]},
            {"id": "Taxi-v3", "maps": ["Taxi-v3"]},
        ],
        "scenario_schema": {"type": "object", "properties": {}},
    },
    {
        "env_id": "gym-box2d",
        "version": "1.0.0",
        "api_mode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [
            {"id": "LunarLander-v2", "maps": ["LunarLander-v2"]},
            {"id": "BipedalWalker-v3", "maps": ["BipedalWalker-v3"]},
            {"id": "CarRacing-v2", "maps": ["CarRacing-v2"]},
        ],
        "package": "gymnasium[box2d]",
        "scenario_schema": {"type": "object", "properties": {}},
    },
    {
        "env_id": "gym-mujoco",
        "version": "1.0.0",
        "api_mode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [
            {"id": "HalfCheetah-v4", "maps": ["HalfCheetah-v4"]},
            {"id": "Hopper-v4", "maps": ["Hopper-v4"]},
            {"id": "Ant-v4", "maps": ["Ant-v4"]},
            {"id": "Walker2d-v4", "maps": ["Walker2d-v4"]},
        ],
        "package": "gymnasium[mujoco]",
        "scenario_schema": {"type": "object", "properties": {}},
    },
    {
        "env_id": "gym-minigrid",
        "version": "1.0.0",
        "api_mode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [
            {"id": "MiniGrid-Empty-5x5-v0", "maps": ["MiniGrid-Empty-5x5-v0"]},
            {"id": "MiniGrid-DoorKey-5x5-v0", "maps": ["MiniGrid-DoorKey-5x5-v0"]},
        ],
        "package": "minigrid",
        "scenario_schema": {"type": "object", "properties": {}},
    },
    {
        "env_id": "pettingzoo-mpe",
        "version": "1.0.0",
        "api_mode": "pettingzoo",
        "entrypoint": "app.envs.pettingzoo:make_env",
        "map_sets": [
            {"id": "simple_spread_v3", "maps": ["mpe/simple_spread_v3"]},
            {"id": "simple_tag_v3", "maps": ["mpe/simple_tag_v3"]},
            {"id": "simple_adversary_v3", "maps": ["mpe/simple_adversary_v3"]},
        ],
        "scenario_schema": {"type": "object", "properties": {}},
    },
    {
        "env_id": "pettingzoo-sisl",
        "version": "1.0.0",
        "api_mode": "pettingzoo",
        "entrypoint": "app.envs.pettingzoo:make_env",
        "map_sets": [
            {"id": "waterworld_v4", "maps": ["sisl/waterworld_v4"]},
            {"id": "pursuit_v4", "maps": ["sisl/pursuit_v4"]},
        ],
        "scenario_schema": {"type": "object", "properties": {}},
    },
    {
        "env_id": "pettingzoo-butterfly",
        "version": "1.0.0",
        "api_mode": "pettingzoo",
        "entrypoint": "app.envs.pettingzoo:make_env",
        "map_sets": [
            {"id": "knights_archers_zombies_v10", "maps": ["butterfly/knights_archers_zombies_v10"]},
            {"id": "pistonball_v6", "maps": ["butterfly/pistonball_v6"]},
        ],
        "package": "pettingzoo[butterfly]",
        "scenario_schema": {"type": "object", "properties": {}},
    },
    {
        "env_id": "pettingzoo-classic",
        "version": "1.0.0",
        "api_mode": "pettingzoo",
        "entrypoint": "app.envs.pettingzoo:make_env",
        "map_sets": [
            {"id": "board", "maps": ["classic/chess_v6", "classic/connect_four_v3"]},
            {"id": "simple", "maps": ["classic/rps_v2", "classic/tictactoe_v3"]},
        ],
        "package": "pettingzoo[classic]",
        "import_check": "pettingzoo.classic",
        "scenario_schema": {"type": "object", "properties": {}},
    },
    {
        "env_id": "orbit-zoo",
        "version": "1.0.0",
        "api_mode": "custom",
        "entrypoint": "app.envs.orbitzoo:make_env",
        "map_sets": [{"id": "default", "maps": ["default"]}],
        "import_check": ["orbitzoo", "orbit_zoo"],
        "scenario_schema": {"type": "object", "properties": {}},
    }
]

ALGO_DEFS = [
    {
        "algo_id": "simple-train",
        "name": "Simple Train (Demo)",
        "description": "A minimal training algorithm for demonstration.",
        "version": "1.0.0",
        "entrypoint": "algorithms.simple_train:train",
        "default_config": {
            "train": {"totalEnvSteps": 10000, "rolloutLen": 200},
            "network": {"hidden": [64, 64]}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "train": {"type": "object"},
                "network": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "simple-eval",
        "name": "Simple Eval (Demo)",
        "description": "A minimal evaluation algorithm.",
        "version": "1.0.0",
        "entrypoint": "algorithms.simple_eval:evaluate",
        "default_config": {},
        "config_schema": {}
    },
    {
        "algo_id": "sb3-ppo",
        "name": "Stable-Baselines3 PPO",
        "description": "Proximal Policy Optimization via SB3. Supports video recording.",
        "version": "2.2.1",
        "entrypoint": "algorithms.sb3_train:train",
        "package": "stable-baselines3==2.2.1",
        "default_config": {
            "algo": {"name": "PPO"},
            "train": {"totalEnvSteps": 20000, "learningRate": 0.0003},
            "env": {"maps": ["CartPole-v1"]},
            "network": {"hidden": [64, 64], "activation": "tanh"}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "sb3-sac",
        "name": "Stable-Baselines3 SAC",
        "description": "Soft Actor-Critic via SB3.",
        "version": "2.2.1",
        "entrypoint": "algorithms.sb3_train:train",
        "package": "stable-baselines3==2.2.1",
        "default_config": {
            "algo": {"name": "SAC"},
            "train": {"totalEnvSteps": 20000, "learningRate": 0.0003},
            "env": {"maps": ["CartPole-v1"]},
            "network": {"hidden": [256, 256], "activation": "relu"}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "sb3-dqn",
        "name": "Stable-Baselines3 DQN",
        "description": "Deep Q-Network via SB3.",
        "version": "2.2.1",
        "entrypoint": "algorithms.sb3_train:train",
        "package": "stable-baselines3==2.2.1",
        "default_config": {
            "algo": {"name": "DQN"},
            "train": {"totalEnvSteps": 20000, "learningRate": 0.0003},
            "env": {"maps": ["CartPole-v1"]},
            "network": {"hidden": [128, 128], "activation": "relu"}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "sb3-a2c",
        "name": "Stable-Baselines3 A2C",
        "description": "Advantage Actor-Critic via SB3.",
        "version": "2.2.1",
        "entrypoint": "algorithms.sb3_train:train",
        "package": "stable-baselines3==2.2.1",
        "default_config": {
            "algo": {"name": "A2C"},
            "train": {"totalEnvSteps": 20000, "learningRate": 0.0007},
            "env": {"maps": ["CartPole-v1"]},
            "network": {"hidden": [64, 64], "activation": "tanh"}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "sb3-td3",
        "name": "Stable-Baselines3 TD3",
        "description": "Twin Delayed DDPG via SB3.",
        "version": "2.2.1",
        "entrypoint": "algorithms.sb3_train:train",
        "package": "stable-baselines3==2.2.1",
        "default_config": {
            "algo": {"name": "TD3"},
            "train": {"totalEnvSteps": 20000, "learningRate": 0.001},
            "env": {"maps": ["Pendulum-v1"]},
            "network": {"hidden": [256, 256], "activation": "relu"}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "sb3-ddpg",
        "name": "Stable-Baselines3 DDPG",
        "description": "Deep Deterministic Policy Gradient via SB3.",
        "version": "2.2.1",
        "entrypoint": "algorithms.sb3_train:train",
        "package": "stable-baselines3==2.2.1",
        "default_config": {
            "algo": {"name": "DDPG"},
            "train": {"totalEnvSteps": 20000, "learningRate": 0.001},
            "env": {"maps": ["Pendulum-v1"]},
            "network": {"hidden": [256, 256], "activation": "relu"}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "sb3-eval",
        "name": "SB3 Evaluator",
        "description": "Real evaluation using Stable-Baselines3 models.",
        "version": "1.0.0",
        "entrypoint": "algorithms.sb3_eval:evaluate",
        "package": "stable-baselines3==2.2.1",
        "default_config": {
            "episodesPerMatch": 10
        },
        "config_schema": {}
    },
    {
        "algo_id": "mappo-marl",
        "name": "MAPPO (Centralized Critic)",
        "description": "Multi-Agent PPO with centralized critic (PettingZoo parallel env).",
        "version": "1.0.0",
        "entrypoint": "algorithms.mappo_train:train",
        "default_config": {
            "train": {"totalEnvSteps": 200000, "rolloutLen": 200, "epochs": 10},
            "env": {"maps": ["mpe/simple_spread_v3"]},
            "network": {"hidden": [128, 128]}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "mappo-rnn-marl",
        "name": "MAPPO-RNN (Centralized Critic)",
        "description": "Recurrent MAPPO with GRU policy/critic.",
        "version": "1.0.0",
        "entrypoint": "algorithms.mappo_rnn_train:train",
        "default_config": {
            "train": {"totalEnvSteps": 200000, "rolloutLen": 200, "epochs": 5, "rnnHidden": 128},
            "env": {"maps": ["mpe/simple_spread_v3"]},
            "network": {"rnnHidden": 128}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "qmix-marl",
        "name": "QMIX (Value Decomposition)",
        "description": "Multi-Agent QMIX for discrete action spaces.",
        "version": "1.0.0",
        "entrypoint": "algorithms.qmix_train:train",
        "default_config": {
            "algo": {"name": "QMIX"},
            "train": {"totalEnvSteps": 200000, "batchSize": 256},
            "env": {"maps": ["mpe/simple_spread_v3"]},
            "network": {"hidden": [128, 128], "mixerEmbed": 32}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "vdn-marl",
        "name": "VDN (Value Decomposition)",
        "description": "Multi-Agent VDN baseline for discrete action spaces.",
        "version": "1.0.0",
        "entrypoint": "algorithms.qmix_train:train",
        "default_config": {
            "algo": {"name": "VDN"},
            "train": {"totalEnvSteps": 200000, "batchSize": 256},
            "env": {"maps": ["mpe/simple_spread_v3"]},
            "network": {"hidden": [128, 128]}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "qmix-rnn-marl",
        "name": "QMIX-RNN (DRQN)",
        "description": "Recurrent QMIX with DRQN agents.",
        "version": "1.0.0",
        "entrypoint": "algorithms.qmix_rnn_train:train",
        "default_config": {
            "algo": {"name": "QMIX"},
            "train": {"totalEnvSteps": 200000, "batchSize": 16, "seqLen": 20, "rnnHidden": 64},
            "env": {"maps": ["mpe/simple_spread_v3"]},
            "network": {"rnnHidden": 64}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "vdn-rnn-marl",
        "name": "VDN-RNN (DRQN)",
        "description": "Recurrent VDN with DRQN agents.",
        "version": "1.0.0",
        "entrypoint": "algorithms.qmix_rnn_train:train",
        "default_config": {
            "algo": {"name": "VDN"},
            "train": {"totalEnvSteps": 200000, "batchSize": 16, "seqLen": 20, "rnnHidden": 64},
            "env": {"maps": ["mpe/simple_spread_v3"]},
            "network": {"rnnHidden": 64}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"},
                "network": {"type": "object"},
                "env": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "offline-bc",
        "name": "Offline BC",
        "description": "Behavior Cloning on offline datasets.",
        "version": "1.0.0",
        "entrypoint": "algorithms.offline_train:train",
        "default_config": {
            "algo": {"name": "BC"},
            "train": {"epochs": 50, "batchSize": 256}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "offline-cql",
        "name": "Offline CQL",
        "description": "Conservative Q-Learning for offline discrete control.",
        "version": "1.0.0",
        "entrypoint": "algorithms.offline_train:train",
        "default_config": {
            "algo": {"name": "CQL"},
            "train": {"epochs": 50, "batchSize": 256, "cqlAlpha": 1.0}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "offline-iql",
        "name": "Offline IQL",
        "description": "Implicit Q-Learning for offline continuous control.",
        "version": "1.0.0",
        "entrypoint": "algorithms.offline_train:train",
        "default_config": {
            "algo": {"name": "IQL"},
            "train": {"epochs": 50, "batchSize": 256, "expectile": 0.7, "beta": 3.0}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "offline-td3bc",
        "name": "Offline TD3+BC",
        "description": "TD3+BC for offline continuous control.",
        "version": "1.0.0",
        "entrypoint": "algorithms.offline_train:train",
        "default_config": {
            "algo": {"name": "TD3BC"},
            "train": {"epochs": 50, "batchSize": 256, "bcAlpha": 2.5}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "algo": {"type": "object"},
                "train": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "rllib-ppo-marl",
        "name": "Ray RLLib PPO (MARL)",
        "description": "Multi-Agent PPO using Ray RLLib. Optimized for PettingZoo.",
        "version": "2.9.0",
        "entrypoint": "algorithms.rllib_train:train",
        "package": "ray[rllib]==2.9.0",
        "default_config": {
            "train": {"totalEnvSteps": 50000, "learningRate": 0.0001},
            "env": {"maps": ["simple_spread_v3"]}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "train": {"type": "object"},
                "algo": {"type": "object"}
            }
        }
    },
    {
        "algo_id": "rllib-appo-marl",
        "name": "Ray RLLib APPO (MARL)",
        "description": "Multi-Agent APPO using Ray RLLib.",
        "version": "2.9.0",
        "entrypoint": "algorithms.rllib_train:train",
        "package": "ray[rllib]==2.9.0",
        "default_config": {
            "algo": {"name": "APPO"},
            "train": {"totalEnvSteps": 50000, "learningRate": 0.0001},
            "env": {"maps": ["simple_spread_v3"]}
        },
        "config_schema": {
            "type": "object",
            "properties": {
                "train": {"type": "object"},
                "algo": {"type": "object"}
            }
        }
    }
]

TEMPLATE_DEFS = [
    {
        "name": "Demo CartPole",
        "description": "Ready-to-run template for CartPole using Simple Train.",
        "type": "Single-Agent",
        "version": "1.0.0",
        "algo_id": "simple-train",
        "algo_version": "1.0.0",
        "default_config": {
            "env": {"envId": "gym-classic", "mapSet": "CartPole-v1", "maps": ["CartPole-v1"]},
            "train": {"totalEnvSteps": 5000}
        }
    },
    {
        "name": "SB3 PPO CartPole (Video)",
        "description": "PPO Training with Video Recording enabled.",
        "type": "Single-Agent",
        "version": "1.0.0",
        "algo_id": "sb3-ppo",
        "algo_version": "2.2.1",
        "default_config": {
            "env": {"envId": "gym-classic", "mapSet": "CartPole-v1", "maps": ["CartPole-v1"]},
            "train": {"totalEnvSteps": 20000}
        }
    },
    {
        "name": "SB3 SAC CartPole",
        "description": "SAC Training on CartPole (SB3).",
        "type": "Single-Agent",
        "version": "1.0.0",
        "algo_id": "sb3-sac",
        "algo_version": "2.2.1",
        "default_config": {
            "env": {"envId": "gym-classic", "mapSet": "CartPole-v1", "maps": ["CartPole-v1"]},
            "train": {"totalEnvSteps": 20000}
        }
    },
    {
        "name": "SB3 DQN CartPole",
        "description": "DQN Training on CartPole (SB3).",
        "type": "Single-Agent",
        "version": "1.0.0",
        "algo_id": "sb3-dqn",
        "algo_version": "2.2.1",
        "default_config": {
            "env": {"envId": "gym-classic", "mapSet": "CartPole-v1", "maps": ["CartPole-v1"]},
            "train": {"totalEnvSteps": 20000}
        }
    },
    {
        "name": "SB3 A2C CartPole",
        "description": "A2C Training on CartPole (SB3).",
        "type": "Single-Agent",
        "version": "1.0.0",
        "algo_id": "sb3-a2c",
        "algo_version": "2.2.1",
        "default_config": {
            "env": {"envId": "gym-classic", "mapSet": "CartPole-v1", "maps": ["CartPole-v1"]},
            "train": {"totalEnvSteps": 20000}
        }
    },
    {
        "name": "SB3 TD3 Pendulum",
        "description": "TD3 Training on Pendulum (SB3).",
        "type": "Single-Agent",
        "version": "1.0.0",
        "algo_id": "sb3-td3",
        "algo_version": "2.2.1",
        "default_config": {
            "env": {"envId": "gym-classic", "mapSet": "Pendulum-v1", "maps": ["Pendulum-v1"]},
            "train": {"totalEnvSteps": 20000}
        }
    },
    {
        "name": "SB3 DDPG Pendulum",
        "description": "DDPG Training on Pendulum (SB3).",
        "type": "Single-Agent",
        "version": "1.0.0",
        "algo_id": "sb3-ddpg",
        "algo_version": "2.2.1",
        "default_config": {
            "env": {"envId": "gym-classic", "mapSet": "Pendulum-v1", "maps": ["Pendulum-v1"]},
            "train": {"totalEnvSteps": 20000}
        }
    },
    {
        "name": "SB3 DQN LunarLander",
        "description": "DQN Training on LunarLander (Box2D).",
        "type": "Single-Agent",
        "version": "1.0.0",
        "algo_id": "sb3-dqn",
        "algo_version": "2.2.1",
        "default_config": {
            "env": {"envId": "gym-box2d", "mapSet": "LunarLander-v2", "maps": ["LunarLander-v2"]},
            "train": {"totalEnvSteps": 20000}
        }
    },
    {
        "name": "ToyText FrozenLake",
        "description": "Quickstart on FrozenLake (Gymnasium ToyText).",
        "type": "Single-Agent",
        "version": "1.0.0",
        "algo_id": "sb3-ppo",
        "algo_version": "2.2.1",
        "default_config": {
            "env": {"envId": "gym-toytext", "mapSet": "FrozenLake-v1", "maps": ["FrozenLake-v1"]},
            "train": {"totalEnvSteps": 5000}
        }
    },
    {
        "name": "MARL PPO Simple Spread",
        "description": "Multi-Agent PPO on MPE Simple Spread.",
        "type": "Multi-Agent",
        "version": "1.0.0",
        "algo_id": "rllib-ppo-marl",
        "algo_version": "2.9.0",
        "default_config": {
            "env": {"envId": "pettingzoo-mpe", "mapSet": "simple_spread_v3", "maps": ["mpe/simple_spread_v3"]},
            "train": {"totalEnvSteps": 50000}
        }
    },
    {
        "name": "MAPPO Simple Spread",
        "description": "MAPPO with centralized critic on MPE Simple Spread.",
        "type": "Multi-Agent",
        "version": "1.0.0",
        "algo_id": "mappo-marl",
        "algo_version": "1.0.0",
        "default_config": {
            "env": {"envId": "pettingzoo-mpe", "mapSet": "simple_spread_v3", "maps": ["mpe/simple_spread_v3"]},
            "train": {"totalEnvSteps": 200000}
        }
    },
    {
        "name": "MAPPO-RNN Simple Spread",
        "description": "Recurrent MAPPO on MPE Simple Spread.",
        "type": "Multi-Agent",
        "version": "1.0.0",
        "algo_id": "mappo-rnn-marl",
        "algo_version": "1.0.0",
        "default_config": {
            "env": {"envId": "pettingzoo-mpe", "mapSet": "simple_spread_v3", "maps": ["mpe/simple_spread_v3"]},
            "train": {"totalEnvSteps": 200000}
        }
    },
    {
        "name": "QMIX Simple Spread",
        "description": "QMIX baseline on MPE Simple Spread (discrete actions).",
        "type": "Multi-Agent",
        "version": "1.0.0",
        "algo_id": "qmix-marl",
        "algo_version": "1.0.0",
        "default_config": {
            "env": {"envId": "pettingzoo-mpe", "mapSet": "simple_spread_v3", "maps": ["mpe/simple_spread_v3"]},
            "train": {"totalEnvSteps": 200000}
        }
    },
    {
        "name": "VDN Simple Spread",
        "description": "VDN baseline on MPE Simple Spread (discrete actions).",
        "type": "Multi-Agent",
        "version": "1.0.0",
        "algo_id": "vdn-marl",
        "algo_version": "1.0.0",
        "default_config": {
            "env": {"envId": "pettingzoo-mpe", "mapSet": "simple_spread_v3", "maps": ["mpe/simple_spread_v3"]},
            "train": {"totalEnvSteps": 200000}
        }
    },
    {
        "name": "QMIX-RNN Simple Spread",
        "description": "Recurrent QMIX (DRQN) on MPE Simple Spread.",
        "type": "Multi-Agent",
        "version": "1.0.0",
        "algo_id": "qmix-rnn-marl",
        "algo_version": "1.0.0",
        "default_config": {
            "env": {"envId": "pettingzoo-mpe", "mapSet": "simple_spread_v3", "maps": ["mpe/simple_spread_v3"]},
            "train": {"totalEnvSteps": 200000}
        }
    },
    {
        "name": "VDN-RNN Simple Spread",
        "description": "Recurrent VDN (DRQN) on MPE Simple Spread.",
        "type": "Multi-Agent",
        "version": "1.0.0",
        "algo_id": "vdn-rnn-marl",
        "algo_version": "1.0.0",
        "default_config": {
            "env": {"envId": "pettingzoo-mpe", "mapSet": "simple_spread_v3", "maps": ["mpe/simple_spread_v3"]},
            "train": {"totalEnvSteps": 200000}
        }
    },
    {
        "name": "MARL APPO Simple Spread",
        "description": "Multi-Agent APPO on MPE Simple Spread.",
        "type": "Multi-Agent",
        "version": "1.0.0",
        "algo_id": "rllib-appo-marl",
        "algo_version": "2.9.0",
        "default_config": {
            "env": {"envId": "pettingzoo-mpe", "mapSet": "simple_spread_v3", "maps": ["mpe/simple_spread_v3"]},
            "train": {"totalEnvSteps": 50000},
            "algo": {"name": "APPO"}
        }
    }
]

DATASET_DEFS = [
    {
        "name": "D4RL HalfCheetah Expert",
        "description": "Expert demonstration dataset for HalfCheetah-v2 from D4RL.",
        "path": "s3://rl-platform/datasets/d4rl/halfcheetah_expert.hdf5",
        "format": "hdf5",
        "size_bytes": 104857600,
    },
    {
        "name": "Offline CartPole Demo",
        "description": "A small offline dataset for CartPole-v1 recorded with a random policy.",
        "path": "s3://rl-platform/datasets/demo/cartpole_random.jsonl",
        "format": "jsonl",
        "size_bytes": 1048576,
    }
]

def seed():
    db = SessionLocal()
    try:
        def is_available(module_name) -> bool:
            if isinstance(module_name, (list, tuple, set)):
                return any(importlib.util.find_spec(name) is not None for name in module_name if name)
            return importlib.util.find_spec(module_name) is not None

        # 1. Envs
        for env_def in ENV_DEFS:
            env_spec = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_def["env_id"]).first()
            if not env_spec:
                env_spec = models.EnvSpec(
                    id=env_def["env_id"],
                    versions=[env_def["version"]],
                    maps=env_def["map_sets"][0]["maps"]
                )
                db.add(env_spec)
                db.commit()
            
            env_ver = db.query(models.EnvVersion).filter(models.EnvVersion.env_id == env_def["env_id"], models.EnvVersion.version == env_def["version"]).first()
            if not env_ver:
                active_flag = env_def.get("active", True)
                import_check = env_def.get("import_check")
                if import_check and not is_available(import_check):
                    active_flag = False
                env_ver = models.EnvVersion(
                    env_id=env_def["env_id"],
                    version=env_def["version"],
                    api_mode=env_def["api_mode"],
                    entrypoint=env_def["entrypoint"],
                    package=env_def.get("package"),
                    map_sets=env_def["map_sets"],
                    scenario_schema=env_def["scenario_schema"],
                    active=active_flag
                )
                db.add(env_ver)
                db.commit()
                print(f"Seeded Env: {env_def['env_id']}")

        # 2. Datasets
        for ds_def in DATASET_DEFS:
            ds = db.query(models.Dataset).filter(models.Dataset.name == ds_def["name"]).first()
            if not ds:
                ds = models.Dataset(
                    name=ds_def["name"],
                    description=ds_def["description"],
                    path=ds_def["path"],
                    format=ds_def["format"],
                    size_bytes=ds_def["size_bytes"]
                )
                db.add(ds)
                db.commit()
                print(f"Seeded Dataset: {ds_def['name']}")

        # 2. Algos
        for algo_def in ALGO_DEFS:
            algo = db.query(models.Algo).filter(models.Algo.id == algo_def["algo_id"]).first()
            if not algo:
                algo = models.Algo(
                    id=algo_def["algo_id"],
                    name=algo_def["name"],
                    description=algo_def["description"]
                )
                db.add(algo)
                db.commit()
            
            algo_ver = db.query(models.AlgoVersion).filter(models.AlgoVersion.algo_id == algo_def["algo_id"], models.AlgoVersion.version == algo_def["version"]).first()
            if not algo_ver:
                algo_ver = models.AlgoVersion(
                    algo_id=algo_def["algo_id"],
                    version=algo_def["version"],
                    entrypoint=algo_def["entrypoint"],
                    package=algo_def.get("package"),
                    default_config=algo_def["default_config"],
                    config_schema=algo_def["config_schema"],
                    metadata_=algo_def.get("metadata"),
                    active=True
                )
                db.add(algo_ver)
                db.commit()
                print(f"Seeded Algo: {algo_def['algo_id']}")

        # 3. Project & Template
        project = db.query(models.Project).filter(models.Project.id == "demo").first()
        if not project:
            project = models.Project(id="demo", name="Demo Project", description="A demo project.", tags=["demo"])
            db.add(project)
            db.commit()
        
        for tmpl_def in TEMPLATE_DEFS:
            tmpl = db.query(models.Template).filter(models.Template.name == tmpl_def["name"], models.Template.project_id == project.id).first()
            if not tmpl:
                tmpl = models.Template(
                    project_id=project.id,
                    name=tmpl_def["name"],
                    description=tmpl_def["description"],
                    type=tmpl_def["type"],
                    default_config=tmpl_def["default_config"]
                )
                db.add(tmpl)
                db.commit()
                
            algo_ver = db.query(models.AlgoVersion).filter(models.AlgoVersion.algo_id == tmpl_def["algo_id"], models.AlgoVersion.version == tmpl_def["algo_version"]).first()
            
            if algo_ver:
                tmpl_ver = db.query(models.TemplateVersion).filter(models.TemplateVersion.template_id == tmpl.id, models.TemplateVersion.version == tmpl_def["version"]).first()
                if not tmpl_ver:
                    tmpl_ver = models.TemplateVersion(
                        template_id=tmpl.id,
                        version=tmpl_def["version"],
                        algo_version_id=algo_ver.id,
                        default_config=tmpl_def["default_config"]
                    )
                    db.add(tmpl_ver)
                    db.commit()
                    print(f"Seeded Template: {tmpl_def['name']}")

    finally:
        db.close()

if __name__ == "__main__":
    seed()
PY
