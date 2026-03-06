import sys
import os
import sqlite3
import json
import uuid
from datetime import datetime, timedelta, timezone

db_path = os.path.join(os.path.dirname(__file__), '..', 'rl_platform.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def create_demo_data():
    now = datetime.now(timezone.utc)
    
    # 1. Ensure models exist
    models = [
        ('1', 'PPO_Agent_Eval_v2', 'High-performance multi-agent PPO checkpoint.', now.isoformat()),
        ('2', 'DQN_Atari_Baseline', 'Classic DQN for Atari environments.', now.isoformat()),
        ('3', 'MAPPO_StarCraft_Micro', 'Multi-agent PPO tuned for StarCraft II micromanagement.', now.isoformat())
    ]
    cursor.executemany("INSERT OR IGNORE INTO registered_models (id, name, description, created_at) VALUES (?, ?, ?, ?)", models)

    # 2. Add complex runs (matching true schema)
    runs = [
        (str(uuid.uuid4()), 'proj-1', 'PPO_MultiAgent_HideAndSeek', 'TRAIN', 'RUNNING', json.dumps({'algo_id': 'MAPPO', 'preset': 'rllib_default'}), json.dumps({'env_id': 'HideAndSeek', 'version': 'v1'}), (now - timedelta(hours=2)).isoformat(), '{}', '{}'),
        (str(uuid.uuid4()), 'proj-1', 'SAC_Mujoco_Ant_Search', 'TRAIN', 'RUNNING', json.dumps({'algo_id': 'SAC', 'preset': 'sb3_default'}), json.dumps({'env_id': 'Ant-v4', 'version': 'v1'}), (now - timedelta(hours=5)).isoformat(), '{}', '{}'),
        (str(uuid.uuid4()), 'proj-1', 'DQN_Atari_Breakout_Baseline', 'TRAIN', 'COMPLETED', json.dumps({'algo_id': 'DQN', 'preset': 'sb3_default'}), json.dumps({'env_id': 'BreakoutNoFrameskip-v4', 'version': 'v1'}), (now - timedelta(days=1)).isoformat(), '{}', json.dumps({'reward': 24.5, 'win_rate': 0.8})),
        (str(uuid.uuid4()), 'proj-1', 'QMIX_StarCraft_3m', 'TRAIN', 'COMPLETED', json.dumps({'algo_id': 'QMIX', 'preset': 'pymarl_default'}), json.dumps({'env_id': 'SMAC_3m', 'version': 'v1'}), (now - timedelta(days=2)).isoformat(), '{}', json.dumps({'win_rate': 0.92})),
        (str(uuid.uuid4()), 'proj-1', 'PPO_Agent_Eval_Experimental', 'EVAL', 'FAILED', json.dumps({'algo_id': 'PPO', 'preset': 'rllib_default'}), json.dumps({'env_id': 'HideAndSeek', 'version': 'v1'}), (now - timedelta(minutes=45)).isoformat(), '{}', '{}'),
    ]
    cursor.executemany("INSERT INTO runs (id, project_id, name, type, status, algo, env, created, config, metrics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", runs)

    conn.commit()
    print(f"Inserted {len(runs)} complex runs into demo database.")

try:
    create_demo_data()
except Exception as e:
    print(f"Error: {e}")
finally:
    conn.close()
