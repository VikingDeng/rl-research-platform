from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy.orm import Session

from app.db import models
from app.services.s3 import s3_client


def _get_policy(db: Session) -> str:
    setting = db.query(models.SystemSetting).filter(models.SystemSetting.key == "retention").first()
    if not setting or not isinstance(setting.value, dict):
        return "best_latest_5"
    return str(setting.value.get("checkpointPolicy") or "best_latest_5")


def _delete_artifacts(db: Session, artifacts: Iterable[models.Artifact]) -> None:
    for artifact in artifacts:
        if artifact.object_key:
            try:
                s3_client.delete_object(artifact.object_key)
            except Exception:
                pass
        db.delete(artifact)


def _normalize_latest_tag(db: Session, run_id: str) -> None:
    checkpoints = db.query(models.Checkpoint).filter(models.Checkpoint.run_id == run_id).all()
    if not checkpoints:
        return
    latest = max(checkpoints, key=lambda ckpt: ckpt.step)
    for checkpoint in checkpoints:
        tags = list(checkpoint.tags or [])
        if checkpoint.id == latest.id:
            if "latest" not in tags:
                tags.append("latest")
        else:
            if "latest" in tags:
                tags = [tag for tag in tags if tag != "latest"]
        checkpoint.tags = tags


def apply_checkpoint_policy(db: Session, run_id: str) -> None:
    policy = _get_policy(db)
    if policy == "keep_all":
        _normalize_latest_tag(db, run_id)
        return

    checkpoints = db.query(models.Checkpoint).filter(models.Checkpoint.run_id == run_id).all()
    if not checkpoints:
        return

    to_delete: list[models.Checkpoint] = []
    if policy == "delete_30d":
        cutoff = datetime.utcnow() - timedelta(days=30)
        for checkpoint in checkpoints:
            if checkpoint.created_at and checkpoint.created_at < cutoff:
                to_delete.append(checkpoint)
    else:
        keep_ids = {ckpt.id for ckpt in checkpoints if "best" in (ckpt.tags or [])}
        sorted_ckpts = sorted(checkpoints, key=lambda ckpt: ckpt.step, reverse=True)
        keep_ids.update(ckpt.id for ckpt in sorted_ckpts[:5])
        to_delete = [ckpt for ckpt in checkpoints if ckpt.id not in keep_ids]

    for checkpoint in to_delete:
        artifact_path = f"/checkpoints/ckpt_{checkpoint.step}.json"
        artifacts = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == checkpoint.run_id, models.Artifact.path == artifact_path)
            .all()
        )
        _delete_artifacts(db, artifacts)
        db.delete(checkpoint)

    _normalize_latest_tag(db, run_id)
