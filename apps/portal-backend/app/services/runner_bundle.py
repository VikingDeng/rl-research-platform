import json
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.services.artifacts import artifact_service


class RunnerBundleService:
    def build_run_manifest(self, run: models.Run, job: Optional[models.Job], executor: str) -> Dict[str, Any]:
        return {
            "run_id": run.id,
            "job_id": job.id if job else None,
            "type": run.type,
            "status": run.status,
            "executor": executor,
            "created_at": run.created.isoformat() if hasattr(run, "created") else datetime.now(timezone.utc).isoformat(),
            "config": run.config,
        }

    def write_run_manifest(self, db: Session, run: models.Run, job: Optional[models.Job], executor: str) -> Dict[str, Any]:
        manifest = self.build_run_manifest(run, job, executor)
        manifest_path = "/manifest/run_manifest.json"
        manifest_json = json.dumps(manifest, indent=2)
        artifact_service.write_artifact(db, run.id, manifest_path, manifest_json, "application/json")
        return manifest


runner_bundle_service = RunnerBundleService()
