import csv
import io
import json
import math
import random
from datetime import datetime
from typing import Dict, List, Tuple

from sqlalchemy.orm import Session

from app.db import models
from app.services.s3 import s3_client


class EvalMatrixService:
    def materialize_eval_result(self, db: Session, run: models.Run) -> None:
        eval_result_id = run.config.get("evalResultId") if isinstance(run.config, dict) else None
        eval_result = None
        if eval_result_id:
            eval_result = db.query(models.EvalResult).filter(models.EvalResult.id == eval_result_id).first()
        if not eval_result:
            eval_result = db.query(models.EvalResult).filter(models.EvalResult.run_id == run.id).first()
        if not eval_result:
            return

        # Try to read real artifact
        summary_artifact = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == run.id, models.Artifact.path == "/eval/summary.json")
            .first()
        )
        
        if not summary_artifact:
            print(f"[EvalMatrix] No summary artifact found for run {run.id}")
            win_rate = 0.0
            if isinstance(eval_result.metrics, dict):
                try:
                    win_rate = float(eval_result.metrics.get("winRate", 0.0))
                except (TypeError, ValueError):
                    win_rate = 0.0
            summary_data = {"mean": win_rate, "std": 0.0, "n": 0}
            eval_result.metrics = {"winRate": win_rate}
            eval_result.summary = summary_data
            eval_result.ci = {"low": win_rate, "high": win_rate, "level": 0.95}
            return

        try:
            content_bytes = s3_client.get_object_bytes(summary_artifact.object_key)
            if content_bytes:
                summary_data = json.loads(content_bytes.decode("utf-8"))
                
                mean = float(summary_data.get("mean", summary_data.get("winRate", 0.0)))
                std = float(summary_data.get("std", 0.0))
                n = int(summary_data.get("n", summary_data.get("count", 0)))
                eval_result.metrics = {"winRate": summary_data.get("winRate", mean)}
                eval_result.summary = {"mean": mean, "std": std, "n": n}
                eval_result.ci = {"low": mean, "high": mean, "level": 0.95}
                eval_result.artifact_url = s3_client.presigned_get_url(summary_artifact.object_key)
                print(f"[EvalMatrix] Materialized result for {run.id}")
        except Exception as e:
            print(f"[EvalMatrix] Failed to process artifact for run {run.id}: {e}")

    def materialize_matrix_result(self, db: Session, run: models.Run) -> None:
        matrix_id = run.config.get("matrixId") if isinstance(run.config, dict) else None
        if not matrix_id:
            return
        matrix_result = db.query(models.MatrixResult).filter(models.MatrixResult.id == matrix_id).first()
        if not matrix_result:
            return

        # Try to read matrix artifacts
        json_artifact = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == run.id, models.Artifact.path == "/matrix/matrix.json")
            .first()
        )
        
        if not json_artifact:
            print(f"[EvalMatrix] No matrix artifact found for run {run.id}")
            labels = []
            if isinstance(run.config, dict):
                snapshot_ids = run.config.get("policySnapshotIds") or []
                labels = [str(sid) for sid in snapshot_ids]
            size = len(labels)
            matrix_result.labels = labels
            matrix_result.matrix = [[0.0 for _ in range(size)] for _ in range(size)]
            matrix_result.cells = []
            matrix_result.ranking = [{"id": label, "score": 0.0} for label in labels]
            matrix_result.summary = {"generated": True, "placeholder": True}
            matrix_result.meta = {"source": "placeholder"}
            matrix_result.artifacts = {"jsonUri": None}
            return

        try:
            content_bytes = s3_client.get_object_bytes(json_artifact.object_key)
            if content_bytes:
                payload = json.loads(content_bytes.decode("utf-8"))
                
                matrix_result.labels = payload.get("labels", [])
                matrix_result.matrix = payload.get("matrix", [])
                # If cells/ranking not in json, we might need to recompute or expect them
                matrix_result.cells = payload.get("cells", []) 
                matrix_result.ranking = payload.get("ranking", [])
                matrix_result.meta = payload.get("meta", {})
                matrix_result.summary = {"generated": True}

                replay_artifact = (
                    db.query(models.Artifact)
                    .filter(
                        models.Artifact.run_id == run.id,
                        models.Artifact.path.ilike("/matrix/%.replay.json"),
                    )
                    .order_by(models.Artifact.created_at.desc())
                    .first()
                )
                replay_payload = None
                if replay_artifact:
                    try:
                        replay_bytes = s3_client.get_object_bytes(replay_artifact.object_key)
                        if replay_bytes:
                            parsed = json.loads(replay_bytes.decode("utf-8"))
                            if isinstance(parsed, dict):
                                replay_payload = parsed
                    except Exception:
                        replay_payload = None
                if replay_payload:
                    matrix_result.summary["replay"] = replay_payload
                
                # Update URLs
                matrix_result.artifacts = {
                    "jsonUri": f"s3://runs/{run.id}/matrix/matrix.json",
                }
                if replay_artifact:
                    matrix_result.artifacts["replayUri"] = f"s3://runs/{run.id}/{replay_artifact.path.lstrip('/')}"
                
                # Check for CSV
                csv_artifact = (
                    db.query(models.Artifact)
                    .filter(models.Artifact.run_id == run.id, models.Artifact.path == "/matrix/matrix.csv")
                    .first()
                )
                if csv_artifact:
                    matrix_result.artifacts["csvUri"] = f"s3://runs/{run.id}/matrix/matrix.csv"
                    matrix_result.export_url = s3_client.presigned_get_url(csv_artifact.object_key)
                
                # Check for Heatmap
                heatmap_artifact = (
                    db.query(models.Artifact)
                    .filter(models.Artifact.run_id == run.id, models.Artifact.path == "/matrix/heatmap.json")
                    .first()
                )
                if heatmap_artifact:
                     matrix_result.artifacts["heatmapUri"] = f"s3://runs/{run.id}/matrix/heatmap.json"

                print(f"[EvalMatrix] Materialized matrix for {run.id}")

        except Exception as e:
            print(f"[EvalMatrix] Failed to process matrix artifact for run {run.id}: {e}")


eval_matrix_service = EvalMatrixService()
