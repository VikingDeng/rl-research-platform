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
from app.db import models
from app.db.session import SessionLocal

# --- Data Definitions ---

ENV_DEFS = [
    {
        "env_id": "gym-classic",
        "version": "1.0.0",
        "api_mode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [{"id": "classic", "maps": ["CartPole-v1", "MountainCar-v0"]}],
        "scenario_schema": {"type": "object", "properties": {}},
    },
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
            "env": {"envId": "gym-classic", "mapSet": "classic", "maps": ["CartPole-v1"]},
            "train": {"totalEnvSteps": 5000}
        }
    }
]

def seed():
    db = SessionLocal()
    try:
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
                env_ver = models.EnvVersion(
                    env_id=env_def["env_id"],
                    version=env_def["version"],
                    api_mode=env_def["api_mode"],
                    entrypoint=env_def["entrypoint"],
                    map_sets=env_def["map_sets"],
                    scenario_schema=env_def["scenario_schema"],
                    active=True
                )
                db.add(env_ver)
                db.commit()
                print(f"Seeded Env: {env_def['env_id']}")

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
                    default_config=algo_def["default_config"],
                    config_schema=algo_def["config_schema"],
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
