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
from app.db import models
from app.db.session import SessionLocal


ENV_DEFS = [
    {
        "env_id": "smac",
        "version": "1.0.0",
        "api_mode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [{"id": "easy", "maps": ["3s5z", "5m_vs_6m"]}],
        "package": None,
    },
    {
        "env_id": "mpe",
        "version": "1.0.0",
        "api_mode": "pettingzoo",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [{"id": "default", "maps": ["simple_spread", "simple_tag"]}],
        "package": None,
    },
    {
        "env_id": "gym-classic",
        "version": "1.0.0",
        "api_mode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "map_sets": [{"id": "classic", "maps": ["CartPole-v1", "MountainCar-v0"]}],
        "package": None,
    },
]


def collect_maps(map_sets):
    maps = []
    for mset in map_sets or []:
        maps.extend(mset.get("maps", []))
    return sorted(set(maps))


def main() -> None:
    db = SessionLocal()
    try:
        for env_def in ENV_DEFS:
            env = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_def["env_id"]).first()
            maps = collect_maps(env_def.get("map_sets"))
            if not env:
                env = models.EnvSpec(id=env_def["env_id"], versions=[env_def["version"]], maps=maps)
                db.add(env)
            else:
                if env_def["version"] not in env.versions:
                    env.versions = list(set(env.versions + [env_def["version"]]))
                if maps:
                    env.maps = sorted(set(env.maps + maps))
            db.commit()

            exists = (
                db.query(models.EnvVersion)
                .filter(
                    models.EnvVersion.env_id == env_def["env_id"],
                    models.EnvVersion.version == env_def["version"],
                )
                .first()
            )
            if exists:
                print(f"env_version exists: {env_def['env_id']}@{env_def['version']}")
                continue

            version = models.EnvVersion(
                env_id=env_def["env_id"],
                version=env_def["version"],
                api_mode=env_def["api_mode"],
                entrypoint=env_def["entrypoint"],
                package=env_def.get("package"),
                active=True,
                frozen=False,
                map_sets=env_def.get("map_sets"),
            )
            db.add(version)
            db.commit()
            print(f"env_version created: {env_def['env_id']}@{env_def['version']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
PY
