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


def _stable_int(value: str) -> int:
    acc = 0
    for char in value:
        acc = (acc * 33 + ord(char)) % 2**31
    return acc


def _compute_stats(values: List[float], level: float = 0.95) -> Tuple[Dict[str, float], Dict[str, float]]:
    n = len(values)
    if n == 0:
        return {"mean": 0.0, "std": 0.0, "n": 0}, {"low": 0.0, "high": 0.0, "level": level}
    mean = sum(values) / n
    if n > 1:
        variance = sum((v - mean) ** 2 for v in values) / (n - 1)
        std = math.sqrt(variance)
    else:
        std = 0.0
    z = 1.96 if level == 0.95 else 1.96
    margin = z * (std / math.sqrt(n)) if n > 1 else 0.0
    return (
        {"mean": mean, "std": std, "n": n},
        {"low": mean - margin, "high": mean + margin, "level": level},
    )


class EvalMatrixService:
    def generate_eval(self, protocol: models.EvalProtocol, policy_snapshot_id: str) -> Dict[str, object]:
        seeds = protocol.eval_seeds or [0]
        episodes = protocol.episodes_per_match or 1
        values: List[float] = []
        for seed in seeds:
            rng = random.Random(_stable_int(f"{protocol.id}:{policy_snapshot_id}:{seed}"))
            base = 0.45 + (rng.random() * 0.1)
            for _ in range(episodes):
                noise = rng.uniform(-0.08, 0.08)
                value = min(1.0, max(0.0, base + noise))
                values.append(value)

        summary, ci = _compute_stats(values)
        return {
            "values": values,
            "summary": summary,
            "ci": ci,
            "metrics": {"winRate": summary["mean"]},
        }

    def generate_matrix(
        self,
        policy_snapshot_ids: List[str],
        protocol: models.EvalProtocol,
        games_per_pair: int,
        metric: str,
    ) -> Dict[str, object]:
        labels = list(policy_snapshot_ids)
        size = len(labels)
        matrix = [[0.5 for _ in range(size)] for _ in range(size)]
        cells: List[Dict[str, object]] = []
        metric = metric or "winRate"

        for i in range(size):
            for j in range(i, size):
                if i == j:
                    if metric == "returnMean":
                        value = 5.0
                    elif metric == "survivalTime":
                        value = 50.0
                    else:
                        value = 0.5
                else:
                    rng = random.Random(_stable_int(f"{protocol.id}:{labels[i]}:{labels[j]}"))
                    if metric == "returnMean":
                        value = 2.0 + rng.random() * 8.0
                        matrix[j][i] = value
                    elif metric == "survivalTime":
                        value = 10.0 + rng.random() * 90.0
                        matrix[j][i] = value
                    else:
                        value = 0.1 + rng.random() * 0.8
                        matrix[j][i] = 1.0 - value
                matrix[i][j] = value

        for i in range(size):
            for j in range(size):
                cells.append({"row": labels[i], "col": labels[j], "value": matrix[i][j]})

        ranking = []
        for i, label in enumerate(labels):
            row_values = [matrix[i][j] for j in range(size) if j != i]
            summary, ci = _compute_stats(row_values)
            ranking.append({"id": label, "score": summary["mean"], "ci": ci})

        meta = {
            "gamesPerPair": games_per_pair,
            "seeds": protocol.eval_seeds or [],
            "metric": metric,
        }
        return {
            "labels": labels,
            "matrix": matrix,
            "cells": cells,
            "ranking": ranking,
            "meta": meta,
        }

    def materialize_eval_result(self, db: Session, run: models.Run) -> None:
        eval_result_id = run.config.get("evalResultId") if isinstance(run.config, dict) else None
        eval_result = None
        if eval_result_id:
            eval_result = db.query(models.EvalResult).filter(models.EvalResult.id == eval_result_id).first()
        if not eval_result:
            eval_result = db.query(models.EvalResult).filter(models.EvalResult.run_id == run.id).first()
        if not eval_result:
            return

        protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == eval_result.protocol_id).first()
        if not protocol:
            return

        policy_snapshot_id = ""
        if isinstance(run.config, dict):
            policy_snapshot_id = run.config.get("policySnapshotId", "")

        payload = self.generate_eval(protocol, policy_snapshot_id)
        eval_result.metrics = payload["metrics"]
        eval_result.summary = payload["summary"]
        eval_result.ci = payload["ci"]

        artifact_payload = {
            "protocolId": eval_result.protocol_id,
            "policySnapshotId": policy_snapshot_id,
            "summary": payload["summary"],
            "ci": payload["ci"],
            "values": payload["values"],
            "generatedAt": datetime.utcnow().isoformat(),
        }
        artifact_json = json.dumps(artifact_payload, indent=2)
        artifact = artifact_service.write_artifact(
            db,
            run.id,
            "/eval/eval_result.json",
            artifact_json,
            "application/json",
        )
        eval_result.artifact_url = s3_client.presigned_get_url(artifact.object_key)

    def materialize_matrix_result(self, db: Session, run: models.Run) -> None:
        matrix_id = run.config.get("matrixId") if isinstance(run.config, dict) else None
        if not matrix_id:
            return
        matrix_result = db.query(models.MatrixResult).filter(models.MatrixResult.id == matrix_id).first()
        if not matrix_result:
            return

        protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == matrix_result.protocol_id).first()
        if not protocol:
            return

        policy_snapshot_ids = []
        if isinstance(run.config, dict):
            policy_snapshot_ids = run.config.get("policySnapshotIds") or []
        if not isinstance(policy_snapshot_ids, list):
            policy_snapshot_ids = []

        games_per_pair = 10
        if isinstance(run.config, dict):
            games_per_pair = int(run.config.get("gamesPerPair") or games_per_pair)

        metric = "winRate"
        if isinstance(run.config, dict):
            metric = str(run.config.get("metric") or metric)
        payload = self.generate_matrix(policy_snapshot_ids, protocol, games_per_pair, metric)
        matrix_result.labels = payload["labels"]
        matrix_result.matrix = payload["matrix"]
        matrix_result.cells = payload["cells"]
        matrix_result.ranking = payload["ranking"]
        matrix_result.meta = payload["meta"]
        matrix_result.summary = {"generated": True}

        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)
        writer.writerow([""] + payload["labels"])
        for idx, label in enumerate(payload["labels"]):
            writer.writerow([label] + payload["matrix"][idx])

        matrix_payload = {
            "labels": payload["labels"],
            "matrix": payload["matrix"],
            "meta": payload["meta"],
            "ranking": payload["ranking"],
        }
        json_body = json.dumps(matrix_payload, indent=2)

        csv_artifact = artifact_service.write_artifact(
            db,
            run.id,
            "/matrix/matrix.csv",
            csv_buffer.getvalue(),
            "text/csv",
        )
        json_artifact = artifact_service.write_artifact(
            db,
            run.id,
            "/matrix/matrix.json",
            json_body,
            "application/json",
        )
        heatmap_artifact = artifact_service.write_artifact(
            db,
            run.id,
            "/matrix/heatmap.json",
            json_body,
            "application/json",
        )

        matrix_result.artifacts = {
            "csvUri": f"s3://runs/{run.id}/matrix/matrix.csv",
            "jsonUri": f"s3://runs/{run.id}/matrix/matrix.json",
            "heatmapUri": f"s3://runs/{run.id}/matrix/heatmap.json",
        }
        matrix_result.export_url = s3_client.presigned_get_url(csv_artifact.object_key)


eval_matrix_service = EvalMatrixService()
