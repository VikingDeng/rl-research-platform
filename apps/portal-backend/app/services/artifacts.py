from datetime import datetime

from sqlalchemy.orm import Session

from app.db import models
from app.services.s3 import s3_client


from typing import Union

class ArtifactService:
    @staticmethod
    def build_object_key(run_id: str, path: str) -> str:
        trimmed = path.lstrip("/")
        return f"runs/{run_id}/{trimmed}"

    def write_artifact(self, db: Session, run_id: str, path: str, content: Union[str, bytes], content_type: str) -> models.Artifact:
        object_key = self.build_object_key(run_id, path)
        s3_client.ensure_bucket()

        existing = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == run_id, models.Artifact.path == path)
            .first()
        )
        if existing:
            # For robustness, if it exists, maybe we update it or ignore?
            # Original logic raised error. Let's keep it but might need handling in caller if overwrite is desired.
            raise ValueError("artifact_path_exists")

        if s3_client.object_exists(object_key):
             # Similarly here.
            raise ValueError("artifact_object_exists")

        if isinstance(content, str):
            s3_client.put_text(object_key, content, content_type)
            size_bytes = len(content.encode("utf-8"))
        else:
            s3_client.put_object(object_key, content, content_type)
            size_bytes = len(content)

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


artifact_service = ArtifactService()
