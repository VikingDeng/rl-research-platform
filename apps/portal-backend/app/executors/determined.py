import base64
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
import yaml

from app.core.config import settings
from app.executors.base import ExecutionBackend, ExecutionJob, ExecutionResult
from app.executors.local import LocalExecutor
from app.services import paths
from app.services import plugin_runtime


class DeterminedAPIError(RuntimeError):
    pass


class DeterminedClient:
    def __init__(self) -> None:
        if not settings.determined_master_url:
            raise DeterminedAPIError("determined_master_url_missing")
        self._client = httpx.Client(
            base_url=settings.determined_master_url.rstrip("/"),
            timeout=10.0,
        )

    def _headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {"Accept": "application/json"}
        if settings.determined_token:
            headers["Authorization"] = f"Bearer {settings.determined_token}"
        return headers

    def create_experiment(self, config: Dict[str, Any]) -> int:
        payload = {"config": config, "activate": True}
        response = self._client.post("/api/v1/experiments", json=payload, headers=self._headers())
        if response.status_code >= 400:
            yaml_config = yaml.safe_dump(config, sort_keys=False)
            payload = {"config": yaml_config, "activate": True}
            response = self._client.post("/api/v1/experiments", json=payload, headers=self._headers())
        if response.status_code >= 400:
            raise DeterminedAPIError(f"determined_submit_failed:{response.text}")
        data = response.json()
        for key in ("experiment", "experimentId", "id"):
            value = data.get(key) if isinstance(data, dict) else None
            if isinstance(value, dict):
                exp_id = value.get("id")
                if exp_id is not None:
                    return int(exp_id)
            if value is not None and not isinstance(value, dict):
                return int(value)
        raise DeterminedAPIError("determined_experiment_id_missing")

    def get_experiment(self, experiment_id: int) -> Dict[str, Any]:
        response = self._client.get(
            f"/api/v1/experiments/{experiment_id}",
            headers=self._headers(),
        )
        if response.status_code >= 400:
            raise DeterminedAPIError(f"determined_fetch_failed:{response.text}")
        payload = response.json()
        if isinstance(payload, dict) and isinstance(payload.get("experiment"), dict):
            return payload["experiment"]
        return payload

    def cancel_experiment(self, experiment_id: int) -> None:
        response = self._client.post(
            f"/api/v1/experiments/{experiment_id}/cancel",
            headers=self._headers(),
        )
        if response.status_code >= 400:
            response = self._client.post(
                f"/api/v1/experiments/{experiment_id}/kill",
                headers=self._headers(),
            )
        if response.status_code >= 400:
            raise DeterminedAPIError(f"determined_cancel_failed:{response.text}")


class DeterminedExecutor(ExecutionBackend):
    def __init__(self) -> None:
        self._local = LocalExecutor()
        self._mapping: Dict[str, str] = {}
        self._mock = settings.determined_mock
        self._client: Optional[DeterminedClient] = None
        self._run_mapping: Dict[str, str] = {}

    def submit(self, job: ExecutionJob) -> str:
        if not self._mock:
            backend_ref = self._submit_real(job)
            self._run_mapping[backend_ref] = job.run_id
            return backend_ref
        local_ref = self._local.submit(job)
        backend_ref = f"det-{local_ref}"
        self._mapping[backend_ref] = local_ref
        return backend_ref

    def status(self, backend_ref: str) -> str:
        if not self._mock:
            experiment_id = self._parse_experiment_id(backend_ref)
            exp = self._client_or_raise().get_experiment(experiment_id)
            state = str(exp.get("state") or exp.get("status") or "UNKNOWN")
            return self._map_state(state)
        local_ref = self._mapping.get(backend_ref, backend_ref.replace("det-", "", 1))
        return self._local.status(local_ref)

    def cancel(self, backend_ref: str) -> None:
        if not self._mock:
            experiment_id = self._parse_experiment_id(backend_ref)
            self._client_or_raise().cancel_experiment(experiment_id)
            return
        local_ref = self._mapping.get(backend_ref, backend_ref.replace("det-", "", 1))
        self._local.cancel(local_ref)

    def wait(self, backend_ref: str) -> ExecutionResult:
        if not self._mock:
            experiment_id = self._parse_experiment_id(backend_ref)
            client = self._client_or_raise()
            status = "RUNNING"
            while status in {"PENDING", "RUNNING"}:
                exp = client.get_experiment(experiment_id)
                status = self._map_state(str(exp.get("state") or exp.get("status") or "UNKNOWN"))
                if status in {"SUCCEEDED", "FAILED", "CANCELED"}:
                    break
                time.sleep(settings.determined_poll_interval)
            exit_code = 0 if status == "SUCCEEDED" else 1
            run_id = self._run_mapping.pop(backend_ref, None)
            metrics_path, checkpoint_path = self._resolve_paths(run_id)
            return ExecutionResult(
                backend_ref=backend_ref,
                exit_code=exit_code,
                metrics_path=metrics_path or "",
                checkpoint_path=checkpoint_path,
            )
        local_ref = self._mapping.get(backend_ref, backend_ref.replace("det-", "", 1))
        result = self._local.wait(local_ref)
        self._mapping.pop(backend_ref, None)
        result.backend_ref = backend_ref
        return result

    def pause(self, backend_ref: str) -> None:
        if not self._mock:
            return
        local_ref = self._mapping.get(backend_ref, backend_ref.replace("det-", "", 1))
        if hasattr(self._local, "pause"):
            self._local.pause(local_ref)

    def resume(self, backend_ref: str) -> None:
        if not self._mock:
            return
        local_ref = self._mapping.get(backend_ref, backend_ref.replace("det-", "", 1))
        if hasattr(self._local, "resume"):
            self._local.resume(local_ref)

    def _client_or_raise(self) -> DeterminedClient:
        if not self._client:
            self._client = DeterminedClient()
        return self._client

    def _submit_real(self, job: ExecutionJob) -> str:
        client = self._client_or_raise()
        shared_root = settings.determined_shared_fs_root or settings.local_run_root
        run_dir = Path(shared_root).expanduser().resolve() / job.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        metrics_path = run_dir / "metrics.jsonl"
        checkpoint_dir = run_dir / "checkpoints"
        checkpoint_dir.mkdir(parents=True, exist_ok=True)

        config_payload = dict(job.config) if isinstance(job.config, dict) else {}
        config_payload["runId"] = job.run_id
        config_payload["jobId"] = job.job_id
        config_payload["runType"] = job.run_type
        config_path = run_dir / "config.json"
        config_path.write_text(json.dumps(config_payload, indent=2), encoding="utf-8")

        env_vars = {
            "RUN_ID": job.run_id,
            "JOB_ID": job.job_id,
            "OUTPUT_DIR": str(run_dir),
            "METRICS_PATH": str(metrics_path),
            "CHECKPOINT_DIR": str(checkpoint_dir),
            "RUN_CONFIG_PATH": str(config_path),
            "RUN_CONFIG_B64": base64.b64encode(json.dumps(config_payload).encode("utf-8")).decode("utf-8"),
        }

        python_paths = []
        plugin_cfg = config_payload.get("plugin") if isinstance(config_payload, dict) else None
        if isinstance(plugin_cfg, dict):
            runtime = plugin_runtime.prepare_runtime(job.run_id, plugin_cfg, config_payload)
            env_vars["PLUGIN_SPEC_PATH"] = str(runtime.spec_path)
            python_paths.append(str(runtime.python_path))

        if python_paths:
            env_vars["PYTHONPATH"] = os.pathsep.join(python_paths)

        image = settings.determined_image
        if not image and isinstance(config_payload, dict):
            env_cfg = config_payload.get("env")
            if isinstance(env_cfg, dict):
                image = env_cfg.get("defaultImageDigest") or env_cfg.get("default_image_digest")

        exp_config = {
            "name": f"run-{job.run_id}",
            "project_id": settings.determined_project_id,
            "entrypoint": settings.determined_entrypoint,
            "environment": {"environment_variables": env_vars},
            "resources": {"slots_per_trial": max(job.gpus, 1)},
            "searcher": {
                "name": "single",
                "metric": "returnMean",
                "max_length": {"batches": 1},
            },
        }

        if image:
            exp_config["environment"]["image"] = image

        experiment_id = client.create_experiment(exp_config)
        backend_ref = f"det-exp-{experiment_id}"
        return backend_ref

    def _parse_experiment_id(self, backend_ref: str) -> int:
        if backend_ref.startswith("det-exp-"):
            return int(backend_ref.replace("det-exp-", "", 1))
        if backend_ref.startswith("det-"):
            return int(backend_ref.replace("det-", "", 1))
        return int(backend_ref)

    def _map_state(self, state: str) -> str:
        normalized = state.upper()
        if normalized in {"COMPLETED", "SUCCEEDED", "SUCCESS"}:
            return "SUCCEEDED"
        if normalized in {"ERROR", "FAILED", "CRASHED", "UNRECOVERABLE"}:
            return "FAILED"
        if normalized in {"CANCELED", "CANCELLED", "STOPPED"}:
            return "CANCELED"
        if normalized in {"PAUSED", "QUEUED", "PENDING", "PULLING", "STARTING"}:
            return "PENDING"
        return "RUNNING"

    def _resolve_paths(self, run_id: Optional[str]) -> tuple[Optional[str], Optional[str]]:
        if not run_id:
            return None, None
        metrics_path = paths.metrics_path(run_id)
        checkpoint_dir = paths.checkpoints_dir(run_id)
        checkpoint_path = None
        if checkpoint_dir.exists():
            checkpoints = sorted(checkpoint_dir.glob("ckpt_*.json"))
            if checkpoints:
                checkpoint_path = str(checkpoints[-1])
        return str(metrics_path), checkpoint_path
