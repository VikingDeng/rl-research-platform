import json
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
