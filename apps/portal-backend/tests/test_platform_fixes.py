import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import pytest

from app.db import models
from app.services.webhook_service import dispatch_webhooks

from tests.test_api import (
    create_project,
    create_template,
    create_template_version,
    ensure_env_version,
    create_eval_protocol,
    wait_for_job_status,
)


def test_init_db_direct_sqlite_bootstrap_is_supported(tmp_path):
    backend_root = Path(__file__).resolve().parents[1]
    db_path = tmp_path / "bootstrap.db"
    script_path = backend_root / "scripts" / "init_db_direct.py"

    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    env["PYTHONPATH"] = str(backend_root)
    env["DATABASE_STRICT"] = "1"

    result = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=str(backend_root),
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    assert db_path.exists()

    conn = sqlite3.connect(db_path)
    try:
        table_rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        table_names = {row[0] for row in table_rows}
        assert "projects" in table_names
        assert "runs" in table_names
        assert "eval_protocols" in table_names

        columns = conn.execute("PRAGMA table_info('eval_protocols')").fetchall()
        column_names = {row[1] for row in columns}
        assert "scenario_grid" in column_names
        assert "opponent_sampling" in column_names
    finally:
        conn.close()


def test_train_job_with_dataset_injection(client):
    ensure_env_version(client)
    project = create_project(client, name="Dataset Project")
    template = create_template(client, project["id"])
    version = create_template_version(client, template["id"])

    ds_res = client.post(
        "/api/v1/datasets",
        json={
            "name": "Offline Demo",
            "description": "test dataset",
            "path": "s3://rl-platform/datasets/demo.jsonl",
            "format": "jsonl",
        },
    )
    assert ds_res.status_code == 201
    dataset_id = ds_res.json()["id"]

    payload = {
        "projectId": project["id"],
        "templateVersionId": version["id"],
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "algo": {"algoId": "mappo", "algoVersionId": version["algoVersionId"]},
        "train": {"totalEnvSteps": 100, "rolloutLen": 10, "batchSize": 32, "lr": 0.0003},
        "resources": {"gpus": 1},
        "datasetId": dataset_id,
    }
    res = client.post("/api/v1/train-jobs", json=payload)
    assert res.status_code == 201
    data = res.json()

    wait_for_job_status(client, data["jobId"], "SUCCEEDED")


def test_eval_job_does_not_stall(client, db_session):
    project = create_project(client, name="Eval Project")
    base_run = models.Run(
        project_id=project["id"],
        name="seed-run",
        type="TRAIN",
        status="SUCCEEDED",
        algo="simple-train",
        env="smac:1.0.0",
        config={},
        metrics={},
    )
    db_session.add(base_run)
    db_session.commit()

    checkpoint = models.Checkpoint(
        run_id=base_run.id,
        step=1,
        metrics={},
        path=f"s3://runs/{base_run.id}/checkpoints/ckpt_1.json",
        tags=["latest"],
    )
    db_session.add(checkpoint)
    db_session.commit()

    protocol = create_eval_protocol(client)
    res = client.post(
        "/api/v1/eval-jobs",
        json={"protocolId": protocol["id"], "policySnapshotId": checkpoint.id},
    )
    assert res.status_code == 201
    payload = res.json()

    wait_for_job_status(client, payload["jobId"], "SUCCEEDED")
    artifacts_res = client.get(f"/api/v1/runs/{payload['runId']}/artifacts")
    assert artifacts_res.status_code == 200
    artifacts = artifacts_res.json()
    assert any(str(item.get("name", "")).endswith(".replay.json") for item in artifacts)


def test_eval_job_fails_when_model_artifact_missing(client, db_session, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "eval_entrypoint", "algorithms.sb3_eval:evaluate")
    monkeypatch.setattr(settings, "eval_algo_name", "SB3 Evaluator")

    project = create_project(client, name="Eval Fallback Project")
    base_run = models.Run(
        project_id=project["id"],
        name="seed-run-no-model",
        type="TRAIN",
        status="SUCCEEDED",
        algo="custom-train",
        env="smac:1.0.0",
        config={},
        metrics={},
    )
    db_session.add(base_run)
    db_session.commit()

    checkpoint = models.Checkpoint(
        run_id=base_run.id,
        step=1,
        metrics={},
        path=f"s3://runs/{base_run.id}/checkpoints/ckpt_1.json",
        tags=["latest"],
    )
    db_session.add(checkpoint)
    db_session.commit()

    protocol = create_eval_protocol(client, name="EvalFallbackProto")
    res = client.post(
        "/api/v1/eval-jobs",
        json={"protocolId": protocol["id"], "policySnapshotId": checkpoint.id},
    )
    assert res.status_code == 201
    payload = res.json()

    wait_for_job_status(client, payload["jobId"], "FAILED")

    eval_run = db_session.query(models.Run).filter(models.Run.id == payload["runId"]).first()
    assert eval_run is not None
    assert eval_run.status == "FAILED"
    eval_job = (
        db_session.query(models.Job)
        .filter(models.Job.id == payload["jobId"])
        .first()
    )
    assert eval_job is not None
    assert eval_job.status == "FAILED"
    assert eval_job.message == "eval_model_artifact_missing"


def test_matrix_materialization_includes_replay_payload(db_session):
    from app.services.artifacts import artifact_service
    from app.services.eval_matrix import eval_matrix_service

    project = models.Project(name="Matrix Replay Project", description="matrix replay", tags=["test"])
    db_session.add(project)
    db_session.commit()
    run = models.Run(
        project_id=project.id,
        name="matrix-run",
        type="MATRIX",
        status="SUCCEEDED",
        algo="matrix-eval",
        env="smac:1.0.0",
        config={},
        metrics={},
    )
    db_session.add(run)
    db_session.commit()

    matrix_result = models.MatrixResult(protocol_id="proto-1", pool_id=None, cells=[])
    db_session.add(matrix_result)
    db_session.commit()
    run.config = {"matrixId": matrix_result.id}
    db_session.commit()

    matrix_payload = {
        "labels": ["p1", "p2"],
        "matrix": [[0.5, 0.62], [0.38, 0.5]],
        "cells": [{"row": "p1", "col": "p2", "value": 0.62}, {"row": "p2", "col": "p1", "value": 0.38}],
        "ranking": [{"id": "p1", "score": 0.56}, {"id": "p2", "score": 0.44}],
        "meta": {"metric": "winRate", "gamesPerPair": 4},
    }
    artifact_service.write_artifact(
        db_session,
        run.id,
        "/matrix/matrix.json",
        json.dumps(matrix_payload),
        "application/json",
    )

    replay_payload = {
        "kind": "rl_adversarial_replay_v1",
        "title": "Matrix Replay",
        "map": "3s5z",
        "durationSec": 18,
        "fps": 24,
        "seed": 7,
        "arena": {"width": 120, "height": 80},
        "teams": [
            {"id": "blue", "name": "Blue", "color": "#38bdf8"},
            {"id": "red", "name": "Red", "color": "#fb7185"},
        ],
        "units": [
            {"id": "b1", "team": "blue", "role": "tank", "x": 10, "y": 10, "vx": 0.3, "vy": 0.1, "hp": 160},
            {"id": "r1", "team": "red", "role": "tank", "x": 90, "y": 70, "vx": -0.2, "vy": -0.1, "hp": 160},
        ],
        "events": [{"t": 6.2, "type": "kill", "actor": "b1", "target": "r1", "text": "B1 eliminated R1."}],
    }
    artifact_service.write_artifact(
        db_session,
        run.id,
        "/matrix/matrix_matchup_overview.replay.json",
        json.dumps(replay_payload),
        "application/json",
    )

    eval_matrix_service.materialize_matrix_result(db_session, run)
    db_session.commit()
    db_session.refresh(matrix_result)

    assert matrix_result.summary is not None
    assert isinstance(matrix_result.summary.get("replay"), dict)
    assert matrix_result.summary["replay"].get("kind") == "rl_adversarial_replay_v1"
    assert matrix_result.artifacts is not None
    assert matrix_result.artifacts.get("replayUri")


def test_delete_run_cleans_artifacts(client, db_session):
    from app.services.artifacts import artifact_service
    from app.services.s3 import s3_client

    project = create_project(client, name="Cleanup Project")
    run = models.Run(
        project_id=project["id"],
        name="cleanup-run",
        type="TRAIN",
        status="SUCCEEDED",
        algo="simple-train",
        env="smac:1.0.0",
        config={},
        metrics={},
    )
    db_session.add(run)
    db_session.commit()

    artifact = artifact_service.write_artifact(
        db_session,
        run.id,
        "/metrics/sample.jsonl",
        '{"step": 1, "values": {"returnMean": 1.0}}',
        "application/json",
    )

    local_path = None
    if s3_client.mode == "local":
        local_path = s3_client.local_root / s3_client.bucket / artifact.object_key
        assert local_path.exists()

    res = client.delete(f"/api/v1/runs/{run.id}")
    assert res.status_code == 204

    if local_path is not None:
        assert not local_path.exists()


def test_artifact_manifest_written(db_session):
    from app.services.artifacts import artifact_service
    from app.services.s3 import s3_client

    run = models.Run(
        project_id="proj-artifacts",
        name="artifact-manifest-run",
        type="TRAIN",
        status="SUCCEEDED",
        algo="simple-train",
        env="smac:1.0.0",
        config={},
        metrics={},
    )
    db_session.add(run)
    db_session.commit()

    artifact_service.write_artifact(
        db_session,
        run.id,
        "/metrics/sample.jsonl",
        '{"step": 1, "values": {"returnMean": 1.0}}',
        "application/json",
    )
    artifact_service.write_artifact(
        db_session,
        run.id,
        "/checkpoints/ckpt_1.json",
        '{"step": 1, "metrics": {"returnMean": 1.0}}',
        "application/json",
    )

    manifest_artifact = artifact_service.write_artifact_manifest(db_session, run.id)
    assert manifest_artifact.path == "/manifest/artifacts.json"

    content = s3_client.get_object_bytes(manifest_artifact.object_key).decode("utf-8")
    manifest = json.loads(content)
    assert manifest["run_id"] == run.id
    paths = {item["path"] for item in manifest["artifacts"]}
    assert "/metrics/sample.jsonl" in paths
    assert "/checkpoints/ckpt_1.json" in paths


def test_webhook_dispatch(client, monkeypatch, db_session):
    posts = []

    class DummyClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, json=None, headers=None):
            posts.append((url, json, headers))

    import httpx

    monkeypatch.setattr(httpx, "Client", DummyClient)

    webhook = models.Webhook(url="http://example.com/hook", events=["job.finished"], secret="secret", active=True)
    db_session.add(webhook)
    db_session.commit()

    dispatch_webhooks(db_session, "job.finished", {"job_id": "job-1", "timestamp": "now"})

    assert len(posts) == 1
    assert posts[0][0] == "http://example.com/hook"
    assert posts[0][2].get("X-Webhook-Secret") == "secret"


def test_auth_required(client, monkeypatch, db_session):
    from app.core.config import settings
    from app.services.auth import get_api_token

    monkeypatch.setattr(settings, "allow_anon", False)

    res = client.get("/api/v1/projects")
    assert res.status_code == 401

    token = get_api_token(db_session)
    login_res = client.post("/api/v1/auth/login", json={"email": token, "password": token})
    assert login_res.status_code == 200
    issued = login_res.json()["token"]

    res = client.get("/api/v1/projects", headers={"Authorization": f"Bearer {issued}"})
    assert res.status_code == 200
