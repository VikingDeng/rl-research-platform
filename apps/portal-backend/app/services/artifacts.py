from datetime import datetime
import json

from sqlalchemy.orm import Session

from app.db import models
from app.services.s3 import s3_client


from typing import Union

class ArtifactService:
    @staticmethod
    def build_object_key(run_id: str, path: str) -> str:
        trimmed = path.lstrip("/")
        return f"runs/{run_id}/{trimmed}"

    def write_artifact(
        self,
        db: Session,
        run_id: str,
        path: str,
        content: Union[str, bytes],
        content_type: str,
        overwrite: bool = False,
    ) -> models.Artifact:
        object_key = self.build_object_key(run_id, path)
        s3_client.ensure_bucket()

        existing = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == run_id, models.Artifact.path == path)
            .first()
        )
        if existing and not overwrite:
            # For robustness, if it exists, maybe we update it or ignore?
            # Original logic raised error. Let's keep it but might need handling in caller if overwrite is desired.
            raise ValueError("artifact_path_exists")

        if s3_client.object_exists(object_key) and not overwrite and not existing:
             # Similarly here.
            raise ValueError("artifact_object_exists")

        if isinstance(content, str):
            s3_client.put_text(object_key, content, content_type)
            size_bytes = len(content.encode("utf-8"))
        else:
            s3_client.put_object(object_key, content, content_type)
            size_bytes = len(content)

        if existing:
            existing.name = path.split("/")[-1]
            existing.path = path
            existing.size = str(size_bytes)
            existing.type = "file"
            existing.last_modified = datetime.utcnow().isoformat()
            existing.object_key = object_key
            db.commit()
            db.refresh(existing)
            return existing

        artifact = models.Artifact(
            run_id=run_id,
            name=path.split("/")[-1],
            path=path,
            size=str(size_bytes),
            type="file",
            last_modified=datetime.utcnow().isoformat(),
            object_key=object_key,
        )
        db.add(artifact)
        db.commit()
        db.refresh(artifact)
        return artifact

    def write_artifact_manifest(self, db: Session, run_id: str) -> models.Artifact:
        artifacts = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == run_id)
            .all()
        )
        items = []
        total_bytes = 0
        for artifact in artifacts:
            if artifact.path == "/manifest/artifacts.json":
                continue
            size_value = 0
            if artifact.size:
                try:
                    size_value = int(artifact.size)
                except (TypeError, ValueError):
                    size_value = 0
            total_bytes += size_value
            items.append(
                {
                    "id": artifact.id,
                    "name": artifact.name,
                    "path": artifact.path,
                    "size": size_value,
                    "type": artifact.type,
                    "last_modified": artifact.last_modified,
                    "object_key": artifact.object_key,
                }
            )

        manifest = {
            "run_id": run_id,
            "generated_at": datetime.utcnow().isoformat(),
            "count": len(items),
            "total_bytes": total_bytes,
            "artifacts": items,
        }
        content = json.dumps(manifest, indent=2)
        return self.write_artifact(
            db,
            run_id,
            "/manifest/artifacts.json",
            content,
            "application/json",
            overwrite=True,
        )

    def delete_run_artifacts(self, db: Session, run_id: str) -> None:
        artifacts = db.query(models.Artifact).filter(models.Artifact.run_id == run_id).all()
        for artifact in artifacts:
            if artifact.object_key:
                try:
                    s3_client.delete_object(artifact.object_key)
                except Exception:
                    pass
            db.delete(artifact)


artifact_service = ArtifactService()
