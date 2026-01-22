from typing import Dict, Any

from sqlalchemy.orm import Session

from app.db import models


DEFAULT_PROJECT_ID = "demo"
DEFAULT_PROJECT_NAME = "Demo Project"
DEFAULT_ENV_ID = "gym-classic"
DEFAULT_ENV_VERSION = "1.0.0"
DEFAULT_ALGO_ID = "simple-train"
DEFAULT_ALGO_VERSION = "1.0.0"
DEFAULT_TEMPLATE_NAME = "Demo CartPole"
DEFAULT_TEMPLATE_VERSION = "1.0.0"


class BootstrapService:
    def ensure_defaults(self, db: Session) -> Dict[str, Any]:
        created = {
            "projects": 0,
            "envs": 0,
            "env_versions": 0,
            "algos": 0,
            "algo_versions": 0,
            "templates": 0,
            "template_versions": 0,
        }

        project = db.query(models.Project).filter(models.Project.id == DEFAULT_PROJECT_ID).first()
        if not project:
            project = models.Project(
                id=DEFAULT_PROJECT_ID,
                name=DEFAULT_PROJECT_NAME,
                description="Quickstart demo project.",
                tags=["demo"],
            )
            db.add(project)
            db.commit()
            db.refresh(project)
            created["projects"] += 1

        env_spec = db.query(models.EnvSpec).filter(models.EnvSpec.id == DEFAULT_ENV_ID).first()
        if not env_spec:
            env_spec = models.EnvSpec(
                id=DEFAULT_ENV_ID,
                versions=[DEFAULT_ENV_VERSION],
                maps=["CartPole-v1"],
            )
            db.add(env_spec)
            db.commit()
            db.refresh(env_spec)
            created["envs"] += 1
        else:
            versions = list(env_spec.versions or [])
            if DEFAULT_ENV_VERSION not in versions:
                versions.append(DEFAULT_ENV_VERSION)
                env_spec.versions = versions
                db.commit()

        env_version = (
            db.query(models.EnvVersion)
            .filter(models.EnvVersion.env_id == DEFAULT_ENV_ID, models.EnvVersion.version == DEFAULT_ENV_VERSION)
            .first()
        )
        if not env_version:
            env_version = models.EnvVersion(
                env_id=DEFAULT_ENV_ID,
                version=DEFAULT_ENV_VERSION,
                api_mode="gym",
                entrypoint="app.envs.dummy:make_env",
                map_sets=[{"id": "classic", "maps": ["CartPole-v1"]}],
                scenario_schema={"type": "object", "properties": {}},
                active=True,
            )
            db.add(env_version)
            db.commit()
            db.refresh(env_version)
            created["env_versions"] += 1

        algo = db.query(models.Algo).filter(models.Algo.id == DEFAULT_ALGO_ID).first()
        if not algo:
            algo = models.Algo(
                id=DEFAULT_ALGO_ID,
                name="Simple Train (Demo)",
                description="A minimal training algorithm for demonstration.",
                archived=False,
            )
            db.add(algo)
            db.commit()
            db.refresh(algo)
            created["algos"] += 1

        algo_version = (
            db.query(models.AlgoVersion)
            .filter(models.AlgoVersion.algo_id == DEFAULT_ALGO_ID, models.AlgoVersion.version == DEFAULT_ALGO_VERSION)
            .first()
        )
        if not algo_version:
            algo_version = models.AlgoVersion(
                algo_id=DEFAULT_ALGO_ID,
                version=DEFAULT_ALGO_VERSION,
                entrypoint="algorithms.simple_train:train",
                config_schema={
                    "type": "object",
                    "properties": {"train": {"type": "object"}, "network": {"type": "object"}},
                },
                default_config={
                    "train": {"totalEnvSteps": 5000, "rolloutLen": 200},
                    "network": {"hidden": [64, 64]},
                },
                active=True,
                frozen=False,
            )
            db.add(algo_version)
            db.commit()
            db.refresh(algo_version)
            created["algo_versions"] += 1

        template = (
            db.query(models.Template)
            .filter(models.Template.project_id == project.id, models.Template.name == DEFAULT_TEMPLATE_NAME)
            .first()
        )
        if not template:
            template = models.Template(
                project_id=project.id,
                name=DEFAULT_TEMPLATE_NAME,
                description="Ready-to-run demo template for CartPole.",
                type="Single-Agent",
                default_config={
                    "env": {"envId": DEFAULT_ENV_ID, "mapSet": "classic", "maps": ["CartPole-v1"]},
                    "train": {"totalEnvSteps": 5000},
                },
                archived=False,
            )
            db.add(template)
            db.commit()
            db.refresh(template)
            created["templates"] += 1

        template_version = (
            db.query(models.TemplateVersion)
            .filter(models.TemplateVersion.template_id == template.id, models.TemplateVersion.version == DEFAULT_TEMPLATE_VERSION)
            .first()
        )
        if not template_version:
            template_version = models.TemplateVersion(
                template_id=template.id,
                version=DEFAULT_TEMPLATE_VERSION,
                algo_version_id=algo_version.id,
                default_config=template.default_config,
                frozen=False,
            )
            db.add(template_version)
            db.commit()
            db.refresh(template_version)
            created["template_versions"] += 1

        return {
            "created": created,
            "defaults": {
                "project_id": project.id,
                "env_id": DEFAULT_ENV_ID,
                "env_version": DEFAULT_ENV_VERSION,
                "algo_id": DEFAULT_ALGO_ID,
                "algo_version_id": algo_version.id,
                "template_id": template.id,
                "template_version_id": template_version.id,
            },
        }


bootstrap_service = BootstrapService()
