import sys
import os
import logging
from pathlib import Path
from typing import Set

# Ensure the app is in python path
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, BASE_DIR)

from app.db.base import Base
from app.db.session import engine, SessionLocal
from app.db import models
# 确保所有模型都被导入到 Base.metadata（显式导入以确保表被创建）
from app.db.models import (  # noqa: F401
    Project, Algo, AlgoVersion, EnvSpec, EnvVersion, Template, TemplateVersion,
    Run, Job, Checkpoint, Dataset, EvalProtocol, Plugin, PluginVersion,
    SystemSetting, OpponentPool, OpponentPoolVersion, OpponentPoolMember,
    Artifact, EvalResult, MatrixResult, Webhook, RegisteredModel, ModelVersion
)
from alembic.config import Config
from alembic import command
from sqlalchemy import inspect, text

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

def _alembic_config() -> Config:
    backend_dir = Path(__file__).resolve().parents[1]
    return Config(str(backend_dir / "alembic.ini"))


def _known_app_tables() -> Set[str]:
    return {
        "algos",
        "algo_versions",
        "checkpoints",
        "datasets",
        "env_specs",
        "env_versions",
        "eval_protocols",
        "jobs",
        "matrix_results",
        "projects",
        "runs",
        "templates",
        "template_versions",
    }


def _looks_like_existing_schema_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "already exists" in message or "duplicate column" in message


def _run_migrations() -> None:
    alembic_cfg = _alembic_config()
    try:
        command.upgrade(alembic_cfg, "head")
        logger.info("Schema migrated to alembic head.")
        return
    except Exception as exc:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        is_legacy_schema = bool(existing_tables.intersection(_known_app_tables()))
        has_alembic_version = "alembic_version" in existing_tables
        if is_legacy_schema and not has_alembic_version and _looks_like_existing_schema_error(exc):
            logger.warning(
                "Detected legacy schema without alembic_version. "
                "Stamping current DB to head. Original migration error: %s",
                exc,
            )
            command.stamp(alembic_cfg, "head")
            return
        raise


def _ensure_critical_columns() -> None:
    inspector = inspect(engine)
    if "eval_protocols" not in inspector.get_table_names():
        return

    columns = {col["name"] for col in inspector.get_columns("eval_protocols")}
    missing_columns = []
    if "scenario_grid" not in columns:
        missing_columns.append(("scenario_grid", "JSON"))
    if "opponent_sampling" not in columns:
        missing_columns.append(("opponent_sampling", "JSON"))

    if not missing_columns:
        return

    with engine.begin() as conn:
        for col_name, col_type in missing_columns:
            logger.warning("Patching missing schema column eval_protocols.%s", col_name)
            conn.execute(text(f"ALTER TABLE eval_protocols ADD COLUMN {col_name} {col_type}"))


def init_db():
    if engine.dialect.name == "sqlite":
        # Alembic revisions contain PostgreSQL-only types; use model metadata in local SQLite mode.
        logger.info("Step 1: Creating schema via SQLAlchemy metadata (SQLite mode)...")
        logger.info(f"Registered tables: {list(Base.metadata.tables.keys())}")
        Base.metadata.create_all(bind=engine)
    else:
        logger.info("Step 1: Running schema migrations...")
        _run_migrations()
    _ensure_critical_columns()
    
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
