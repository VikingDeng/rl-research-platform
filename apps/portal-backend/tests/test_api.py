import time
from datetime import datetime
from typing import Optional

from app.db import models


def create_project(client, name="Test Project"):
    payload = {"name": name, "description": "desc", "tags": ["rl"]}
    res = client.post("/api/v1/projects", json=payload)
    assert res.status_code == 201
    return res.json()


def create_template(client, project_id: str):
    payload = {
        "name": "Template",
        "description": "tmpl",
        "type": "Single-Agent",
        "defaultConfig": {"lr": 0.001},
    }
    res = client.post(f"/api/v1/projects/{project_id}/templates", json=payload)
    assert res.status_code == 201
    return res.json()


def ensure_algo_version(client, algo_id: str = "mappo", version: str = "1.0.0"):
    res = client.post("/api/v1/admin/algos", json={"id": algo_id, "name": algo_id.upper(), "description": "algo"})
    assert res.status_code == 201
    manifest = {
        "name": algo_id,
        "version": version,
        "entrypoint": "algorithms.simple_train:train",
        "python": "3.10",
        "dependencies": [],
        "default_config": {"train": {"lr": 0.001}},
        "config_schema": {"type": "object"},
    }
    payload = {
        "version": version,
        "entrypoint": manifest["entrypoint"],
        "metadata": {"manifest": manifest},
        "active": True,
    }
    res = client.post(f"/api/v1/admin/algos/{algo_id}/versions", json=payload)
    if res.status_code == 201:
        return res.json()
    if res.status_code == 400:
        list_res = client.get(f"/api/v1/algos/{algo_id}/versions")
        assert list_res.status_code == 200
        versions = list_res.json()
        matched = next((v for v in versions if v["version"] == version), None)
        assert matched is not None
        return matched
    assert res.status_code == 201
    return res.json()


def create_template_version(client, template_id: str, algo_version_id: Optional[str] = None):
    if algo_version_id is None:
        algo_version_id = ensure_algo_version(client)["id"]
    payload = {"version": "1.0.0", "algoVersionId": algo_version_id, "defaultConfig": {"lr": 0.0003}}
    res = client.post(f"/api/v1/templates/{template_id}/versions", json=payload)
    assert res.status_code == 201
    return res.json()


def ensure_env_version(client, env_id: str = "smac", version: str = "1.0.0"):
    payload = {
        "envId": env_id,
        "version": version,
        "apiMode": "gym",
        "entrypoint": "app.envs.dummy:make_env",
        "mapSets": [{"id": "easy", "maps": ["CartPole-v1"]}],
        "active": True,
    }
    res = client.post("/api/v1/admin/envs", json=payload)
    assert res.status_code == 201
    return res.json()


def create_eval_protocol(client, name="EvalProto"):
    ensure_env_version(client)
    payload = {
        "name": name,
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "evalSeeds": [1, 2],
        "episodesPerMatch": 4,
    }
    res = client.post("/api/v1/eval-protocols", json=payload)
    assert res.status_code == 201, res.text
    return res.json()


def create_opponent_pool(client, name="Pool"):
    payload = {"name": name, "env": "smac", "version": "1.0.0", "memberSnapshotIds": ["snap_a", "snap_b"]}
    res = client.post("/api/v1/opponent-pools", json=payload)
    assert res.status_code == 201
    return res.json()


def wait_for_job_status(client, job_id: str, target: str = "SUCCEEDED", timeout: float = 15) -> dict:
    start = time.time()
    while time.time() - start < timeout:
        res = client.get(f"/api/v1/jobs/{job_id}")
        assert res.status_code == 200
        payload = res.json()
        status = payload["status"]
        if status == target:
            return payload
        if status in {"FAILED", "CANCELED"}:
            break
        time.sleep(0.3)
    raise AssertionError(f"job {job_id} did not reach {target}")


def test_project_crud(client):
    project = create_project(client)

    list_res = client.get("/api/v1/projects")
    assert list_res.status_code == 200
    assert any(p["id"] == project["id"] for p in list_res.json())

    get_res = client.get(f"/api/v1/projects/{project['id']}")
    assert get_res.status_code == 200

    update_res = client.patch(f"/api/v1/projects/{project['id']}", json={"name": "Updated"})
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "Updated"

    delete_res = client.delete(f"/api/v1/projects/{project['id']}")
    assert delete_res.status_code == 204


def test_env_version_flow(client):
    payload = {
        "envId": "smac",
        "version": "1.0.0",
        "apiMode": "gym",
        "entrypoint": "myenvs.smac:make_env",
        "package": "smac==1.0.0",
        "mapSets": [{"id": "easy", "maps": ["3s5z"]}],
        "active": True,
    }
    res = client.post("/api/v1/admin/envs", json=payload)
    assert res.status_code == 201

    list_res = client.get("/api/v1/envs")
    assert list_res.status_code == 200
    assert any(env["id"] == "smac" for env in list_res.json())

    versions_res = client.get("/api/v1/envs/smac/versions")
    assert versions_res.status_code == 200
    assert len(versions_res.json()) >= 1

    update_res = client.patch("/api/v1/admin/envs/smac/versions/1.0.0", json={"active": False})
    assert update_res.status_code == 200
    assert update_res.json().get("active") is False


def test_template_version_flow(client):
    project = create_project(client, name="Template Project")
    template = create_template(client, project["id"])
    version = create_template_version(client, template["id"])

    res = client.get(f"/api/v1/templates/{template['id']}")
    assert res.status_code == 200
    assert any(v["id"] == version["id"] for v in res.json().get("versions", []))


def test_train_job_creates_run_and_job(client):
    ensure_env_version(client)
    project = create_project(client, name="Train Project")
    template = create_template(client, project["id"])
    version = create_template_version(client, template["id"])

    payload = {
        "projectId": project["id"],
        "templateVersionId": version["id"],
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "algo": {"algoId": "mappo", "algoVersionId": version["algoVersionId"]},
        "train": {"totalEnvSteps": 100, "rolloutLen": 10, "batchSize": 32, "lr": 0.0003},
        "resources": {"gpus": 1},
    }
    res = client.post("/api/v1/train-jobs", json=payload)
    assert res.status_code == 201, res.text
    data = res.json()

    run_res = client.get(f"/api/v1/runs/{data['runId']}")
    assert run_res.status_code == 200

    job_res = client.get(f"/api/v1/jobs/{data['jobId']}")
    assert job_res.status_code == 200


def test_train_job_end_to_end(client):
    ensure_env_version(client)
    project = create_project(client, name="E2E Project")
    template = create_template(client, project["id"])
    version = create_template_version(client, template["id"])

    payload = {
        "projectId": project["id"],
        "templateVersionId": version["id"],
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "algo": {"algoId": "mappo", "algoVersionId": version["algoVersionId"]},
        "train": {"totalEnvSteps": 100, "rolloutLen": 10, "batchSize": 32, "lr": 0.0003},
        "resources": {"gpus": 1},
    }
    res = client.post("/api/v1/train-jobs", json=payload)
    assert res.status_code == 201
    data = res.json()

    wait_for_job_status(client, data["jobId"], "SUCCEEDED")

    ckpt_res = client.get(f"/api/v1/runs/{data['runId']}/checkpoints")
    assert ckpt_res.status_code == 200
    assert len(ckpt_res.json()) >= 1

    metrics_res = client.get(f"/api/v1/runs/{data['runId']}/metrics")
    assert metrics_res.status_code == 200
    series = metrics_res.json().get("series", {})
    assert any(series.values())

    artifacts_res = client.get(f"/api/v1/runs/{data['runId']}/artifacts")
    assert artifacts_res.status_code == 200
    artifacts = artifacts_res.json()
    assert len(artifacts) >= 1

    download_res = client.get(f"/api/v1/artifacts/{artifacts[0]['id']}/download_url")
    assert download_res.status_code == 200


def test_list_runs_filter(client):
    ensure_env_version(client)
    project = create_project(client, name="Filter Project")
    template = create_template(client, project["id"])
    version = create_template_version(client, template["id"])

    payload = {
        "projectId": project["id"],
        "templateVersionId": version["id"],
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "algo": {"algoId": "mappo", "algoVersionId": version["algoVersionId"]},
        "train": {"totalEnvSteps": 100, "rolloutLen": 10, "batchSize": 32, "lr": 0.0003},
        "resources": {"gpus": 1},
    }
    client.post("/api/v1/train-jobs", json=payload)

    res = client.get(f"/api/v1/runs?projectId={project['id']}")
    assert res.status_code == 200
    assert len(res.json()) >= 1


def test_eval_protocol_flow(client):
    ensure_env_version(client)
    payload = {
        "name": "EvalProto",
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "evalSeeds": [1, 2],
        "episodesPerMatch": 10,
    }
    res = client.post("/api/v1/eval-protocols", json=payload)
    assert res.status_code == 201
    protocol = res.json()
    protocol_id = protocol["id"]
    assert protocol["version"]

    list_res = client.get("/api/v1/eval-protocols")
    assert list_res.status_code == 200

    freeze_res = client.post(f"/api/v1/eval-protocols/{protocol_id}/freeze")
    assert freeze_res.status_code == 200
    assert freeze_res.json()["frozen"] is True


def test_eval_protocol_versioning(client):
    payload = {
        "name": "EvalProtoV1",
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "evalSeeds": [3, 4],
        "episodesPerMatch": 5,
    }
    res = client.post("/api/v1/eval-protocols", json=payload)
    assert res.status_code == 201
    protocol_id = res.json()["id"]

    version_res = client.post(
        f"/api/v1/eval-protocols/{protocol_id}/versions",
        json={"version": "2.0.0", "episodesPerMatch": 6},
    )
    assert version_res.status_code == 201

    list_res = client.get(f"/api/v1/eval-protocols/{protocol_id}/versions")
    assert list_res.status_code == 200
    versions = list_res.json()
    assert len(versions) >= 2
    assert any(v["version"] == "2.0.0" for v in versions)


def test_eval_protocol_update_with_pool(client):
    ensure_env_version(client)
    pool = create_opponent_pool(client)
    payload = {
        "name": "EvalProtoPool",
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "evalSeeds": [1],
        "episodesPerMatch": 2,
        "scenarioGrid": {"axes": {"delay": ["low", "high"]}},
        "opponentPoolRef": {"poolId": pool["id"], "version": pool["version"]},
    }
    res = client.post("/api/v1/eval-protocols", json=payload)
    assert res.status_code == 201
    protocol = res.json()
    assert protocol["opponentPoolRef"]["poolId"] == pool["id"]

    patch = {
        "evalSeeds": [1, 2, 3],
        "episodesPerMatch": 4,
        "opponentPoolRef": None,
    }
    update_res = client.patch(f"/api/v1/eval-protocols/{protocol['id']}", json=patch)
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["evalSeeds"] == [1, 2, 3]
    assert updated["opponentPoolRef"] is None


def test_eval_protocol_invalid_pool_version(client):
    ensure_env_version(client)
    pool = create_opponent_pool(client, name="InvalidPool")
    payload = {
        "name": "EvalProtoInvalidPool",
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "evalSeeds": [1],
        "episodesPerMatch": 2,
        "opponentPoolRef": {"poolId": pool["id"], "version": "9.9.9"},
    }
    res = client.post("/api/v1/eval-protocols", json=payload)
    assert res.status_code == 404


def test_opponent_pool_members(client):
    payload = {"name": "Pool", "env": "smac", "memberSnapshotIds": ["snap1", "snap2"]}
    res = client.post("/api/v1/opponent-pools", json=payload)
    assert res.status_code == 201
    pool_id = res.json()["id"]

    update_res = client.post(
        f"/api/v1/opponent-pools/{pool_id}/members",
        json={"snapshotIds": ["snap3"], "mode": "append"},
    )
    assert update_res.status_code == 200
    assert "snap3" in update_res.json()["memberSnapshotIds"]


def test_opponent_pool_versioning(client):
    payload = {"name": "PoolV1", "env": "smac", "memberSnapshotIds": ["snap_a"]}
    res = client.post("/api/v1/opponent-pools", json=payload)
    assert res.status_code == 201
    pool_id = res.json()["id"]

    version_res = client.post(
        f"/api/v1/opponent-pools/{pool_id}/versions",
        json={"version": "2.0.0", "memberSnapshotIds": ["snap_b", "snap_c"]},
    )
    assert version_res.status_code == 201

    list_res = client.get(f"/api/v1/opponent-pools/{pool_id}/versions")
    assert list_res.status_code == 200
    versions = list_res.json()
    assert len(versions) >= 2


def test_eval_job_and_result(client):
    protocol = create_eval_protocol(client, name="Eval Job Proto")
    payload = {"policySnapshotId": "snap_x", "protocolId": protocol["id"], "resources": {"gpus": 1}}
    res = client.post("/api/v1/eval-jobs", json=payload)
    assert res.status_code == 201
    data = res.json()

    wait_for_job_status(client, data["jobId"], "SUCCEEDED")
    result_res = client.get(f"/api/v1/eval-results/{data['evalResultId']}")
    assert result_res.status_code == 200
    payload = result_res.json()
    assert payload.get("summary")
    assert payload.get("ci")


def test_matrix_job_and_result(client):
    protocol = create_eval_protocol(client, name="Matrix Proto")
    payload = {"policySnapshotIds": ["a", "b"], "protocolId": protocol["id"], "gamesPerPair": 10}
    res = client.post("/api/v1/matrix-jobs", json=payload)
    assert res.status_code == 201
    data = res.json()

    wait_for_job_status(client, data["jobId"], "SUCCEEDED")
    result_res = client.get(f"/api/v1/matrix-results/{data['matrixId']}")
    assert result_res.status_code == 200
    matrix = result_res.json()
    assert matrix.get("labels")
    assert matrix.get("matrix")
    assert matrix.get("ranking")
    assert matrix.get("artifacts")


def test_repro_bundle_and_artifact_download(client, db_session):
    project = create_project(client, name="Repro Project")
    template = create_template(client, project["id"])
    version = create_template_version(client, template["id"])

    payload = {
        "projectId": project["id"],
        "templateVersionId": version["id"],
        "env": {"envId": "smac", "version": "1.0.0", "mapSet": "easy"},
        "algo": {"algoId": "mappo", "algoVersionId": version["algoVersionId"]},
        "train": {"totalEnvSteps": 100, "rolloutLen": 10, "batchSize": 32, "lr": 0.0003},
        "resources": {"gpus": 1},
    }
    res = client.post("/api/v1/train-jobs", json=payload)
    run_id = res.json()["runId"]

    checkpoint = models.Checkpoint(
        run_id=run_id,
        step=1000,
        metrics={"winRate": 0.5, "returnMean": 10.0},
        path=f"s3://runs/{run_id}/checkpoints/ckpt_1000",
        tags=["latest"],
    )
    db_session.add(checkpoint)
    db_session.commit()

    ckpt_res = client.get(f"/api/v1/runs/{run_id}/checkpoints")
    assert ckpt_res.status_code == 200
    assert len(ckpt_res.json()) >= 1

    bundle_res = client.get(f"/api/v1/runs/{run_id}/repro-bundle")
    assert bundle_res.status_code == 200
    assert bundle_res.json().get("url")

    artifacts_res = client.get(f"/api/v1/runs/{run_id}/artifacts")
    assert artifacts_res.status_code == 200
    artifacts = artifacts_res.json()
    assert len(artifacts) >= 1

    artifact = db_session.query(models.Artifact).filter(models.Artifact.run_id == run_id).first()
    download_res = client.get(f"/api/v1/artifacts/{artifact.id}/download_url")
    assert download_res.status_code == 200
    assert download_res.json().get("url")
