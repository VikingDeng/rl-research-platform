import json
from datetime import datetime
from typing import Dict, Any

import yaml
from sqlalchemy.orm import Session

from app.db import models
from app.services.artifacts import artifact_service
from app.services.s3 import s3_client


class ReproBundleService:
    def build_manifest(self, run: models.Run) -> Dict[str, Any]:
        return {
            "run_id": run.id,
            "project_id": run.project_id,
            "template_version_id": run.template_version_id,
            "created_at": run.created.isoformat() if hasattr(run, "created") else datetime.utcnow().isoformat(),
            "config": run.config,
        }

    def generate(self, db: Session, run: models.Run) -> Dict[str, Any]:
        manifest = self.build_manifest(run)
        manifest_path = "/manifest/repro_manifest.json"
        config_path = "/manifest/config_resolved.yaml"

        manifest_json = json.dumps(manifest, indent=2)
        config_yaml = yaml.safe_dump(run.config or {}, sort_keys=False)

        manifest_exists = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == run.id, models.Artifact.path == manifest_path)
            .first()
            is not None
        )
        config_exists = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == run.id, models.Artifact.path == config_path)
            .first()
            is not None
        )

        if not manifest_exists:
            artifact_service.write_artifact(db, run.id, manifest_path, manifest_json, "application/json")
        if not config_exists:
            artifact_service.write_artifact(db, run.id, config_path, config_yaml, "text/yaml")

        return manifest

    def get_manifest_url(self, run_id: str) -> str:
        key = artifact_service.build_object_key(run_id, "manifest/repro_manifest.json")
        return s3_client.presigned_get_url(key)


repro_bundle_service = ReproBundleService()
