import sys
import os
import logging
from pathlib import Path

# Ensure the app is in python path
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, BASE_DIR)

from app.db.base import Base
from app.db.session import engine, SessionLocal
from app.db import models
from alembic.config import Config
from alembic import command

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Data Definitions ---
ENV_DEFS = [
    {
        "env_id": "gym-classic",
        "version": "1.0.0",
        "api_mode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [{"id": "classic", "maps": ["CartPole-v1", "MountainCar-v0"]}],
    },
    {
        "env_id": "pettingzoo-mpe",
        "version": "1.0.0",
        "api_mode": "pettingzoo",
        "entrypoint": "app.envs.mpe:make_env",
        "map_sets": [{"id": "coop", "maps": ["simple_spread_v3"]}],
    }
]

ALGO_DEFS = [
    {
        "algo_id": "sb3-ppo",
        "name": "Stable-Baselines3 PPO",
        "version": "2.2.1",
        "entrypoint": "algorithms.sb3_train:train",
        "default_config": {"train": {"totalEnvSteps": 20000}}
    },
    {
        "algo_id": "rllib-ppo-marl",
        "name": "Ray RLLib PPO (MARL)",
        "version": "2.9.0",
        "entrypoint": "algorithms.rllib_train:train",
        "default_config": {"train": {"totalEnvSteps": 50000}}
    }
]

def init_db():
    logger.info("Step 1: Creating tables...")
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        logger.info("Step 2: Seeding initial data...")
        # Seed Envs
        for env_def in ENV_DEFS:
            exists = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_def["env_id"]).first()
            if not exists:
                env = models.EnvSpec(id=env_def["env_id"], versions=[env_def["version"]], maps=env_def["map_sets"][0]["maps"])
                db.add(env)
                db.flush()
                ver = models.EnvVersion(
                    env_id=env.id, version=env_def["version"], api_mode=env_def["api_mode"],
                    entrypoint=env_def["entrypoint"], map_sets=env_def["map_sets"], active=True
                )
                db.add(ver)
                logger.info(f"Seeded Env: {env_def['env_id']}")

        # Seed Algos
        for algo_def in ALGO_DEFS:
            exists = db.query(models.Algo).filter(models.Algo.id == algo_def["algo_id"]).first()
            if not exists:
                algo = models.Algo(id=algo_def["algo_id"], name=algo_def["name"])
                db.add(algo)
                db.flush()
                ver = models.AlgoVersion(
                    algo_id=algo.id, version=algo_def["version"], 
                    entrypoint=algo_def["entrypoint"], default_config=algo_def["default_config"], active=True
                )
                db.add(ver)
                logger.info(f"Seeded Algo: {algo_def['algo_id']}")
        
        db.commit()
        logger.info("Database initialized and seeded successfully.")
    except Exception as e:
        db.rollback()
        logger.error(f"Seeding failed: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    init_db()