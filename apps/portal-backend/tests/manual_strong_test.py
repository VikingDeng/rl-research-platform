import os
if __name__ != "__main__":
    import pytest
    pytest.skip("manual_strong_test is a manual integration script", allow_module_level=True)

import sys
import shutil
import time
import json
import threading
from pathlib import Path
from unittest.mock import MagicMock

# --- 1. Environment Setup (Must be before imports) ---
TEST_ROOT = Path("./test_strong_artifacts").resolve()
if TEST_ROOT.exists():
    shutil.rmtree(TEST_ROOT)
TEST_ROOT.mkdir()

DB_PATH = TEST_ROOT / "test.db"
RUN_ROOT = TEST_ROOT / "runs"
ALGO_STORE = TEST_ROOT / "algo_store"
S3_ROOT = TEST_ROOT / "s3"

RUN_ROOT.mkdir()
ALGO_STORE.mkdir()
S3_ROOT.mkdir()

os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
os.environ["EXECUTOR_MODE"] = "local"
os.environ["LOCAL_RUN_ROOT"] = str(RUN_ROOT)
os.environ["ALGO_STORE_DIR"] = str(ALGO_STORE)
os.environ["S3_BUCKET"] = "test-bucket"
os.environ["RUNTIME_AUTO_INSTALL"] = "true"
os.environ["RUNTIME_CACHE_ROOT"] = str(TEST_ROOT / "runtime_cache")
# Disable S3 checks in conftest-like logic if any (we are bypassing conftest here)

# Add backend to path
sys.path.append(str(Path.cwd()))

# --- 2. Mock S3 Client ---
class MockS3Client:
    def __init__(self):
        self.bucket = "test-bucket"
        
    def ensure_bucket(self):
        pass

    def put_text(self, key: str, body: str, content_type: str) -> None:
        p = S3_ROOT / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")

    def put_object(self, key: str, body: bytes, content_type: str) -> None:
        p = S3_ROOT / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)

    def object_exists(self, key: str) -> bool:
        return (S3_ROOT / key).exists()

    def get_object_bytes(self, key: str) -> bytes:
        return (S3_ROOT / key).read_bytes()
        
    def download_file(self, bucket, key, dest):
        src = S3_ROOT / key
        shutil.copy(src, dest)
        
    def presigned_get_url(self, key, expires_in=3600):
        return f"file://{S3_ROOT}/{key}"

# Patch S3 BEFORE importing app
import app.services.s3 as s3_service
s3_service.s3_client = MockS3Client()

# Now import App and DB
from fastapi.testclient import TestClient
from app.main import app
from app.db.base import Base
from app.db.session import engine

# Create Tables
Base.metadata.create_all(bind=engine)

client = TestClient(app)

def run_strong_test():
    print(">>> Starting Strong Test (CLI Mode)...")
    
    # 1. Create Project
    print(">>> Creating Project...")
    res = client.post("/api/v1/projects", json={
        "name": "StrongTestProject",
        "description": "Integration Test",
        "tags": ["test"]
    })
    assert res.status_code == 201, f"Create Project failed: {res.text}"
    project_id = res.json()["id"]
    print(f"    Project ID: {project_id}")

    # 2. Create Env Spec & Version (Using CartPole-v1 via gymnasium)
    print(">>> Creating Environment (CartPole-v1)...")
    res = client.post("/api/v1/admin/envs", json={
        "envId": "CartPole-v1",
        "version": "1.0.0",
        "apiMode": "gym",
        "entrypoint": "gymnasium:make", # Not used directly by simple_train but required by schema
        "package": "gymnasium",
        "active": True
    })
    assert res.status_code == 201, f"Create Env failed: {res.text}"
    
    # 3. Create Algo Spec & Version (Using built-in simple_train)
    print(">>> Creating Algorithm (simple_train)...")
    res = client.post("/api/v1/admin/algos", json={
        "id": "simple_train",
        "name": "Simple Train",
        "description": "Basic training loop"
    })
    assert res.status_code == 201
    
    # Register Version
    res = client.post("/api/v1/admin/algos/simple_train/versions", json={
        "version": "1.0.0",
        "entrypoint": "algorithms.simple_train:train",
        "metadata": {
            "manifest": {
                "name": "simple_train", 
                "version": "1.0.0",
                "python": "3.9",
                "entrypoint": "algorithms.simple_train:train",
                "config_schema": {"type": "object"}
            }
        }
    })
    
    # Handle case if it already exists (idempotency)
    if res.status_code == 400 and "exists" in res.text:
         print("    Algo version exists, fetching ID...")
         # fetch it
         vers = client.get("/api/v1/algos/simple_train/versions").json()
         algo_version_id = vers[0]["id"]
    else:
        assert res.status_code == 201, f"Create Algo Version failed: {res.text}"
        algo_version_id = res.json()["id"]
        
    print(f"    Algo Version ID: {algo_version_id}")

    # 4. Create Template
    print(">>> Creating Template...")
    res = client.post(f"/api/v1/projects/{project_id}/templates", json={
        "name": "TestTemplate",
        "type": "Test",
        "defaultConfig": {}
    })
    assert res.status_code == 201
    template_id = res.json()["id"]
    
    # Create Template Version
    res = client.post(f"/api/v1/templates/{template_id}/versions", json={
        "version": "1.0.0",
        "algoVersionId": algo_version_id,
        "defaultConfig": {
            "train": {"totalEnvSteps": 100, "rolloutLen": 10}
        }
    })
    assert res.status_code == 201
    template_version_id = res.json()["id"]

    # 5. Submit Job
    print(">>> Submitting Job...")
    payload = {
        "projectId": project_id,
        "templateVersionId": template_version_id,
        "env": {"envId": "CartPole-v1", "version": "1.0.0", "mapSet": "default"},
        "algo": {"algoId": "simple_train", "algoVersionId": algo_version_id},
        "train": {"totalEnvSteps": 50, "rolloutLen": 10, "batchSize": 32, "lr": 0.001}, # Override
        "resources": {"gpus": 0, "priority": 3}
    }
    res = client.post("/api/v1/train-jobs", json=payload)
    assert res.status_code == 201, f"Submit Job failed: {res.text}"
    job_data = res.json()
    job_id = job_data["jobId"]
    run_id = job_data["runId"]
    print(f"    Job ID: {job_id}")
    print(f"    Run ID: {run_id}")

    # 6. Wait for Completion
    print(">>> Waiting for Job Completion...")
    for _ in range(30): # 30 seconds max
        res = client.get(f"/api/v1/jobs/{job_id}")
        assert res.status_code == 200
        status = res.json()["status"]
        print(f"    Status: {status}")
        if status == "SUCCEEDED":
            break
        if status in ["FAILED", "CANCELED"]:
            msg = res.json().get("message")
            raise AssertionError(f"Job failed with status {status}: {msg}")
        time.sleep(1)
    else:
        raise AssertionError("Job timed out")

    # 7. Verify Artifacts
    print(">>> Verifying Artifacts...")
    res = client.get(f"/api/v1/runs/{run_id}/metrics")
    assert res.status_code == 200
    metrics = res.json()
    series = metrics.get("series", {})
    # simple_train logs "returnMean"
    assert "returnMean" in series, "returnMean metric missing"
    assert len(series["returnMean"]) > 0, "No metric points found"
    print(f"    Metrics found: {list(series.keys())}")
    
    res = client.get(f"/api/v1/runs/{run_id}/checkpoints")
    assert res.status_code == 200
    ckpts = res.json()
    assert len(ckpts) > 0, "No checkpoints found"
    print(f"    Checkpoints found: {len(ckpts)}")

    # 8. Verify List Runs Optimization
    print(">>> Verifying List Runs Optimization...")
    res = client.get("/api/v1/runs?page=1&page_size=10")
    assert res.status_code == 200
    runs = res.json()
    assert len(runs) > 0
    first_run = runs[0]
    # Check that heavy fields are missing or None
    assert first_run.get("metrics") is None, "Metrics should be deferred/excluded in list view"
    assert first_run.get("config") is None, "Config should be deferred/excluded in list view"

    # 9. Verify Notebook API
    print(">>> Verifying Notebook API...")
    # Create
    res = client.post("/api/v1/notebooks", json={"project_id": project_id, "name": "TestNB"})
    assert res.status_code == 201, f"Create Notebook failed: {res.text}"
    nb_data = res.json()
    nb_id = nb_data["runId"]
    print(f"    Notebook ID: {nb_id}")
    print(f"    URL: {nb_data['url']}")
    
    # List (should be in runs)
    res = client.get("/api/v1/runs?type=NOTEBOOK")
    assert res.status_code == 200
    nb_runs = res.json()
    assert any(r["id"] == nb_id for r in nb_runs), "Notebook not found in run list"
    
    # Stop/Delete
    res = client.delete(f"/api/v1/notebooks/{nb_id}")
    assert res.status_code == 204, f"Delete Notebook failed: {res.text}"
    
    # Create a run to cancel
    res = client.post("/api/v1/train-jobs", json=payload)
    cancel_run_id = res.json()["runId"]
    cancel_job_id = res.json()["jobId"]
    print(f"    Created Run to Cancel: {cancel_run_id}")
    
    # Cancel it
    client.post(f"/api/v1/jobs/{cancel_job_id}/cancel", json={"reason": "test cleanup"})
    
    # 10. Verify Batch Delete
    print(">>> Verifying Batch Delete (Cancelled Run)...")
    res = client.post("/api/v1/runs/batch/delete", json=[cancel_run_id])
    assert res.status_code == 200, f"Batch delete failed: {res.text}"
    deleted_count = res.json()["deleted"]
    print(f"    Deleted count: {deleted_count}")
    assert deleted_count == 1, "Should have deleted 1 run"
    
    # Verify it's gone
    res = client.get(f"/api/v1/runs/{cancel_run_id}")
    assert res.status_code == 404, "Run should be deleted"

    print(">>> STRONG TEST PASSED! <<<")

if __name__ == "__main__":
    try:
        run_strong_test()
    except Exception as e:
        print(f"\n!!! TEST FAILED: {e}")
        # Print backend logs if any (captured in run_root usually)
        sys.exit(1)
