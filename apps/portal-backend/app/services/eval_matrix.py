import csv
import io
import json
import math
import random
from datetime import datetime
from typing import Dict, List, Tuple

from sqlalchemy.orm import Session

from app.db import models
from app.services.artifacts import artifact_service
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
            return

        try:
            content_stream = s3_client.get_object(summary_artifact.object_key)
            if content_stream:
                summary_data = json.load(content_stream)
                
                eval_result.metrics = {"winRate": summary_data.get("winRate", 0.0)}
                eval_result.summary = summary_data
                # Assuming summary has std/count, we can approx ci if needed, or just use mean
                eval_result.ci = {
                    "mean": summary_data.get("mean", 0.0),
                    "std": summary_data.get("std", 0.0)
                }
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
            return

        try:
            content_stream = s3_client.get_object(json_artifact.object_key)
            if content_stream:
                payload = json.load(content_stream)
                
                matrix_result.labels = payload.get("labels", [])
                matrix_result.matrix = payload.get("matrix", [])
                # If cells/ranking not in json, we might need to recompute or expect them
                matrix_result.cells = payload.get("cells", []) 
                matrix_result.ranking = payload.get("ranking", [])
                matrix_result.meta = payload.get("meta", {})
                matrix_result.summary = {"generated": True}
                
                # Update URLs
                matrix_result.artifacts = {
                    "jsonUri": f"s3://runs/{run.id}/matrix/matrix.json",
                }
                
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
