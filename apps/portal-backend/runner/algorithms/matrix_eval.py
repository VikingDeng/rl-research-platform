import csv
import json
import os
import math
from pathlib import Path
from typing import List, Optional


def _logistic(a: float, b: float) -> float:
    return 1.0 / (1.0 + math.exp(-(a - b)))


def _build_matrix(labels: List[str], scores: List[Optional[float]]) -> List[List[float]]:
    size = len(labels)
    matrix = [[0.5 for _ in range(size)] for _ in range(size)]
    for i in range(size):
        for j in range(i + 1, size):
            if scores[i] is None or scores[j] is None:
                win_rate = 0.5
            else:
                win_rate = _logistic(scores[i], scores[j])
            matrix[i][j] = round(win_rate, 4)
            matrix[j][i] = round(1.0 - win_rate, 4)
    return matrix


def _build_cells(labels: List[str], matrix: List[List[float]]) -> List[dict]:
    cells = []
    for i, row in enumerate(labels):
        for j, col in enumerate(labels):
            if i == j:
                continue
            cells.append({"row": row, "col": col, "value": matrix[i][j]})
    return cells


def _build_ranking(labels: List[str], matrix: List[List[float]]) -> List[dict]:
    ranking = []
    for i, label in enumerate(labels):
        row = matrix[i]
        score = sum(row) / max(1, len(row))
        ranking.append({"id": label, "score": round(score, 4)})
    ranking.sort(key=lambda entry: entry["score"], reverse=True)
    return ranking


def _evaluate_policy(policy: dict, protocol: dict, output_dir: Path) -> Optional[float]:
    eval_config = {
        "env": protocol.get("env") or {},
        "episodesPerMatch": protocol.get("episodesPerMatch", 10),
        "evalSeeds": protocol.get("evalSeeds", [0]),
        "modelPath": policy.get("modelPath"),
    }
    if not eval_config["modelPath"]:
        return None

    family = (policy.get("family") or "").lower()
    if family == "sb3":
        from algorithms import sb3_eval
        sb3_eval.evaluate(eval_config, output_dir=str(output_dir))
        summary_path = output_dir / "eval" / "summary.json"
        if summary_path.exists():
            payload = json.loads(summary_path.read_text(encoding="utf-8"))
            return float(payload.get("mean", 0.0))
        return None
    if family == "marl":
        from algorithms import marl_eval
        summary = marl_eval.evaluate(eval_config, output_dir=str(output_dir))
        return float(summary.get("mean", 0.0)) if summary else None
    return None


def run(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None, output_dir=None):
    output_dir = output_dir or os.environ.get("OUTPUT_DIR", ".")
    output_root = Path(output_dir)
    matrix_dir = output_root / "matrix"
    matrix_dir.mkdir(parents=True, exist_ok=True)

    protocol = config.get("protocol") or {}
    policies = config.get("policySnapshots") or []
    if not policies:
        policies = [{"id": str(x)} for x in (config.get("policySnapshotIds") or [])]

    labels = [str(p.get("id")) for p in policies] if policies else ["A", "B"]
    scores: List[Optional[float]] = []
    for policy in policies:
        policy_id = str(policy.get("id"))
        policy_dir = matrix_dir / f"policy_{policy_id}"
        policy_dir.mkdir(parents=True, exist_ok=True)
        scores.append(_evaluate_policy(policy, protocol, policy_dir))

    if len(scores) < len(labels):
        scores.extend([None] * (len(labels) - len(scores)))
    matrix = _build_matrix(labels, scores)
    cells = _build_cells(labels, matrix)
    ranking = _build_ranking(labels, matrix)

    payload = {
        "labels": labels,
        "matrix": matrix,
        "cells": cells,
        "ranking": ranking,
        "meta": {
            "gamesPerPair": config.get("gamesPerPair"),
            "metric": config.get("metric") or "winRate",
        },
    }

    (matrix_dir / "matrix.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    with (matrix_dir / "matrix.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([""] + labels)
        for idx, label in enumerate(labels):
            writer.writerow([label] + matrix[idx])

    heatmap = {"labels": labels, "matrix": matrix}
    (matrix_dir / "heatmap.json").write_text(json.dumps(heatmap, indent=2), encoding="utf-8")
