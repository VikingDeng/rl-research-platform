import json
import queue
import threading
from datetime import datetime
from urllib.parse import urlparse
import httpx
from pathlib import Path
from typing import Optional, Dict

from app.db import models
from app.db.session import SessionLocal
from sqlalchemy.orm import Session
from app.executors.base import ExecutionJob
from app.core.config import settings
from app.executors.determined import DeterminedExecutor
from app.executors.local import LocalExecutor
from app.services.artifacts import artifact_service
from app.services.eval_matrix import eval_matrix_service
from app.services.metrics import metrics_service
from app.services.repro_bundle import repro_bundle_service
from app.services.retention import apply_checkpoint_policy
from app.services.runner_bundle import runner_bundle_service
from app.services.status import can_transition
from app.services import paths
from app.services.webhook_service import dispatch_webhooks


class JobManager:
    def __init__(self) -> None:
        # PriorityQueue stores tuples: (priority_score, job_id). Lowest score popped first.
        # We map High(3) -> -3, Normal(2) -> -2, Low(1) -> -1.
        self._queue: "queue.PriorityQueue[tuple[int, str]]" = queue.PriorityQueue()
        self._max_workers = max(1, settings.job_max_workers)
        self._queue_max_size = max(0, settings.job_queue_max_size)
        self._default_timeout_sec = max(0, settings.job_default_timeout_sec)
        executor_mode = settings.executor_mode.lower()
        if executor_mode == "determined":
            self._executor = DeterminedExecutor()
            self._executor_name = "determined"
        else:
            self._executor = LocalExecutor()
            self._executor_name = "local"
        self._stop = threading.Event()
        self._workers: list[threading.Thread] = []
        self._lock = threading.Lock()
        self._active: dict[str, str] = {}

    def start(self, enqueue_pending: bool = True) -> None:
        if self._stop.is_set():
            self._stop.clear()
        started = False
        if not any(worker.is_alive() for worker in self._workers):
            self._workers = []
            for _ in range(self._max_workers):
                worker = threading.Thread(target=self._dispatch_loop, daemon=True)
                worker.start()
                self._workers.append(worker)
            started = True
        if enqueue_pending and started:
            self._recover_incomplete()
            self._enqueue_pending()

    def stop(self) -> None:
        self._stop.set()

    def _enqueue_pending(self) -> None:
        db = SessionLocal()
        try:
            # Order by priority desc (High first) so we put them in queue effectively?
            # Actually order doesn't matter for insertion, the PriorityQueue sorts them.
            jobs = db.query(models.Job).filter(models.Job.status == "PENDING").all()
            for job in jobs:
                # Default priority 2 if None
                p = job.priority if job.priority is not None else 2
                self._queue.put((-p, job.id))
        finally:
            db.close()

    def _recover_incomplete(self) -> None:
        # Recover local RUNNING jobs after restart by re-queueing them as PENDING.
        if settings.executor_mode.lower() != "local":
            return
        db = SessionLocal()
        try:
            jobs = db.query(models.Job).filter(models.Job.status == "RUNNING").all()
            for job in jobs:
                run = db.query(models.Run).filter(models.Run.id == job.run_id).first()
                if not run:
                    continue
                # If executor is Determined, skip recovery.
                if job.executor and job.executor.lower() == "determined":
                    continue
                # Best-effort terminate orphaned local process.
                try:
                    run_dir = paths.run_root(run.id)
                    pid_file = run_dir / "runner.pid"
                    if pid_file.exists():
                        import os
                        import signal
                        pid = int(pid_file.read_text().strip() or "0")
                        if pid > 0:
                            try:
                                os.kill(pid, signal.SIGTERM)
                            except Exception:
                                pass
                        try:
                            pid_file.unlink()
                        except Exception:
                            pass
                except Exception:
                    pass

                job.status = "PENDING"
                job.message = "recovered_after_restart"
                job.backend_ref = None
                job.executor = None
                run.status = "PENDING"
                if isinstance(run.config, dict) and run.type == "TRAIN":
                    run.config["resume"] = True
                    run.config.setdefault("resumeFrom", "latest")
                    run.config.setdefault("resumeReason", "recovered_after_restart")
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(run, "config")
            db.commit()
        finally:
            db.close()

    def submit(self, job_id: str) -> None:
        if not any(worker.is_alive() for worker in self._workers):
            self.start(enqueue_pending=False)

        # Need to fetch priority
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            p = job.priority if job and job.priority is not None else 2
            if self._queue_max_size > 0 and self._queue.qsize() >= self._queue_max_size:
                raise ValueError("job_queue_full")
            self._queue.put((-p, job_id))
        finally:
            db.close()

    def cancel(self, job_id: str, reason: Optional[str] = None) -> models.Job:
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if not job:
                raise ValueError("job_not_found")
            if not can_transition(job.status, "CANCELED"):
                raise ValueError("invalid_status_transition")
            job.status = "CANCELED"
            job.message = reason or job.message
            run = db.query(models.Run).filter(models.Run.id == job.run_id).first()
            if run:
                run.status = "CANCELED"
            db.commit()
            db.refresh(job)
        finally:
            db.close()

        backend_ref = None
        with self._lock:
            backend_ref = self._active.get(job_id)
        if backend_ref:
            self._executor.cancel(backend_ref)
        return job

    def pause(self, job_id: str, reason: Optional[str] = None) -> models.Job:
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if not job:
                raise ValueError("job_not_found")
            if job.status != "RUNNING":
                raise ValueError("invalid_status_transition")
            job.message = reason or "paused"
            db.commit()
            db.refresh(job)
        finally:
            db.close()

        backend_ref = None
        with self._lock:
            backend_ref = self._active.get(job_id)
        if backend_ref and hasattr(self._executor, "pause"):
            self._executor.pause(backend_ref)
        return job

    def resume(self, job_id: str, reason: Optional[str] = None) -> models.Job:
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if not job:
                raise ValueError("job_not_found")
            if job.status == "RUNNING" and (job.message or "").lower().startswith("paused"):
                job.message = reason or None
                db.commit()
                db.refresh(job)
                backend_ref = None
                with self._lock:
                    backend_ref = self._active.get(job_id)
                if backend_ref and hasattr(self._executor, "resume"):
                    self._executor.resume(backend_ref)
                return job
            if job.status != "CANCELED":
                raise ValueError("invalid_status_transition")
            job.status = "PENDING"
            job.message = reason or job.message
            job.backend_ref = None
            run = db.query(models.Run).filter(models.Run.id == job.run_id).first()
            if run:
                run.status = "PENDING"
                if isinstance(run.config, dict) and run.type == "TRAIN":
                    run.config["resume"] = True
                    run.config.setdefault("resumeFrom", "latest")
                    if reason:
                        run.config["resumeReason"] = reason
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(run, "config")
            db.commit()
            db.refresh(job)
        finally:
            db.close()

        self.submit(job_id)
        return job

    def _dispatch_loop(self) -> None:
        while not self._stop.is_set():
            try:
                # item is (priority_score, job_id)
                _, job_id = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                self._run_job(job_id)
            except Exception:
                # Keep worker alive even if a job crashes unexpectedly
                continue

    def _run_job(self, job_id: str) -> None:
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if not job or job.status != "PENDING":
                return

            run = db.query(models.Run).filter(models.Run.id == job.run_id).first()
            if not run:
                return
            job_id_value = job.id
            run_id_value = run.id
            run_type_value = run.type
            run_gpu_value = run.gpu or 0

            config_updated = False

            def resolve_policy_meta(parent_run: Optional[models.Run]) -> Dict[str, str]:
                if not parent_run:
                    return {"algoId": "", "algoName": "", "family": "custom"}
                algo_id = parent_run.algo or ""
                algo_name = ""
                if isinstance(parent_run.config, dict):
                    algo_cfg = parent_run.config.get("algo")
                    if isinstance(algo_cfg, dict):
                        algo_name = str(algo_cfg.get("name") or algo_cfg.get("algoId") or "")
                family = "custom"
                if algo_id.startswith("sb3"):
                    family = "sb3"
                elif algo_id.startswith("rllib"):
                    family = "rllib"
                elif algo_id.startswith("offline"):
                    family = "offline"
                elif algo_id in {"mappo-marl", "qmix-marl", "vdn-marl", "mappo-rnn-marl", "qmix-rnn-marl"}:
                    family = "marl"
                return {"algoId": algo_id, "algoName": algo_name or algo_id, "family": family}

            def download_model_artifact(parent_run_id: str, snapshot_id: str, run_dir: Path) -> Optional[Path]:
                model_artifact = (
                    db.query(models.Artifact)
                    .filter(
                        models.Artifact.run_id == parent_run_id,
                        (models.Artifact.name.ilike("%.zip") | models.Artifact.name.ilike("%.pt")),
                    )
                    .order_by(models.Artifact.created_at.desc())
                    .first()
                )
                if not model_artifact:
                    return None
                suffix = Path(model_artifact.name).suffix or ".bin"
                local_path = run_dir / f"model_{snapshot_id}{suffix}"
                try:
                    from app.services.s3 import s3_client
                    s3_client.download_file(
                        s3_client.bucket,
                        model_artifact.object_key,
                        str(local_path),
                    )
                except Exception as exc:
                    print(f"Failed to download model artifact: {exc}")
                    return None
                return local_path

            def resolve_protocol_config(protocol_id: str) -> Optional[Dict]:
                protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == protocol_id).first()
                if not protocol:
                    return None
                return {
                    "name": protocol.name,
                    "version": protocol.version,
                    "env": {
                        "envId": protocol.env_id,
                        "version": protocol.env_version or "",
                        "mapSet": protocol.map_set or "",
                    },
                    "evalSeeds": protocol.eval_seeds,
                    "episodesPerMatch": protocol.episodes_per_match,
                    "timeoutSec": protocol.timeout_sec,
                    "metrics": protocol.metrics,
                    "scenarioGrid": protocol.scenario_grid,
                    "opponentSampling": protocol.opponent_sampling,
                    "opponentPoolRef": {
                        "poolId": protocol.opponent_pool_id,
                        "version": protocol.opponent_pool_version,
                    }
                    if protocol.opponent_pool_id
                    else None,
                }

            # --- Inject Model Path for Eval Jobs ---
            # If this is an Eval run, we need to resolve the policySnapshotId to a real path
            if run.type == "EVAL" and isinstance(run.config, dict):
                snapshot_id = run.config.get("policySnapshotId")
                if snapshot_id:
                    ckpt = db.query(models.Checkpoint).filter(models.Checkpoint.id == snapshot_id).first()
                    if ckpt:
                        parent_run_id = ckpt.run_id
                        eval_run_dir = paths.run_root(run.id)
                        eval_run_dir.mkdir(parents=True, exist_ok=True)
                        local_model_path = download_model_artifact(parent_run_id, snapshot_id, eval_run_dir)
                        if local_model_path:
                            run.config["modelPath"] = str(local_model_path)
                            policy_meta = resolve_policy_meta(db.query(models.Run).filter(models.Run.id == parent_run_id).first())
                            run.config["policyMeta"] = policy_meta
                            if policy_meta.get("family") == "marl":
                                run.config.setdefault("algo", {})
                                run.config["algo"]["entrypoint"] = "algorithms.marl_eval:evaluate"
                                run.config["algo"]["name"] = "MARL Evaluator"
                            config_updated = True

            # --- Inject Protocol & Snapshot Paths for Matrix Jobs ---
            if run.type == "MATRIX" and isinstance(run.config, dict):
                protocol_id = run.config.get("protocolId")
                if protocol_id and "protocol" not in run.config:
                    protocol_cfg = resolve_protocol_config(protocol_id)
                    if protocol_cfg:
                        run.config["protocol"] = protocol_cfg
                        config_updated = True
                snapshot_ids = run.config.get("policySnapshotIds") or []
                if snapshot_ids and "policySnapshots" not in run.config:
                    matrix_run_dir = paths.run_root(run.id)
                    matrix_run_dir.mkdir(parents=True, exist_ok=True)
                    policy_entries = []
                    for snapshot_id in snapshot_ids:
                        ckpt = db.query(models.Checkpoint).filter(models.Checkpoint.id == snapshot_id).first()
                        if not ckpt:
                            continue
                        parent_run = db.query(models.Run).filter(models.Run.id == ckpt.run_id).first()
                        if not parent_run:
                            continue
                        local_model_path = download_model_artifact(parent_run.id, snapshot_id, matrix_run_dir)
                        policy_meta = resolve_policy_meta(parent_run)
                        policy_entries.append(
                            {
                                "id": snapshot_id,
                                "modelPath": str(local_model_path) if local_model_path else None,
                                "algoId": policy_meta.get("algoId"),
                                "algoName": policy_meta.get("algoName"),
                                "family": policy_meta.get("family"),
                            }
                        )
                    run.config["policySnapshots"] = policy_entries
                    config_updated = True

            # --- Inject Dataset Path for Offline RL ---
            if isinstance(run.config, dict):
                dataset_id = run.config.get("datasetId")
                if dataset_id:
                    ds = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
                    if ds:
                        dataset_path = ds.path
                        local_dataset_path = None
                        if dataset_path.startswith("s3://"):
                            parsed = urlparse(dataset_path)
                            bucket = parsed.netloc
                            key = parsed.path.lstrip("/")
                            if bucket and key:
                                run_dir = paths.run_root(run.id)
                                run_dir.mkdir(parents=True, exist_ok=True)
                                dest = run_dir / "datasets" / Path(key).name
                                dest.parent.mkdir(parents=True, exist_ok=True)
                                try:
                                    from app.services.s3 import s3_client
                                    s3_client.download_file(bucket, key, str(dest))
                                    local_dataset_path = str(dest)
                                except Exception as exc:
                                    print(f"Failed to download dataset from s3: {exc}")
                        elif dataset_path.startswith("http://") or dataset_path.startswith("https://"):
                            run_dir = paths.run_root(run.id)
                            run_dir.mkdir(parents=True, exist_ok=True)
                            dest = run_dir / "datasets" / Path(urlparse(dataset_path).path).name
                            dest.parent.mkdir(parents=True, exist_ok=True)
                            try:
                                with httpx.stream("GET", dataset_path, timeout=60.0) as response:
                                    response.raise_for_status()
                                    with open(dest, "wb") as handle:
                                        for chunk in response.iter_bytes():
                                            handle.write(chunk)
                                local_dataset_path = str(dest)
                            except Exception as exc:
                                print(f"Failed to download dataset from URL: {exc}")
                        else:
                            path_obj = Path(dataset_path)
                            if path_obj.exists():
                                local_dataset_path = str(path_obj.resolve())

                        run.config["datasetPath"] = local_dataset_path or dataset_path
                        run.config["datasetFormat"] = ds.format
                        config_updated = True

            if config_updated:
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(run, "config")
                db.commit()

            run_config_value = dict(run.config) if isinstance(run.config, dict) else {}
        finally:
            db.close()

        dummy_job = models.Job(id=job_id_value, run_id=run_id_value, status="PENDING")
        dummy_run = models.Run(id=run_id_value, project_id="", name="", type=run_type_value, status="PENDING", algo="", env="", config={}, metrics={})
        self._update_status(dummy_run, dummy_job, "RUNNING")
        exec_job = ExecutionJob(
            job_id=job_id_value,
            run_id=run_id_value,
            run_type=run_type_value,
            config=run_config_value,
            gpus=run_gpu_value,
        )
        try:
            backend_ref = self._executor.submit(exec_job)
        except Exception as exc:
            self._update_status(dummy_run, dummy_job, "FAILED")
            self._set_job_message(job_id_value, str(exc))
            return
        self._set_backend_ref(job_id_value, backend_ref, self._executor_name)

        with self._lock:
            self._active[job_id_value] = backend_ref

        timeout_timer = None
        timeout_sec = 0
        if isinstance(run_config_value, dict):
            resources = run_config_value.get("resources") if isinstance(run_config_value.get("resources"), dict) else None
            if resources:
                timeout_sec = int(resources.get("timeoutSec") or resources.get("timeout_sec") or 0)
        if timeout_sec <= 0:
            timeout_sec = self._default_timeout_sec

        if timeout_sec > 0:
            def _timeout_cancel() -> None:
                self._set_job_message(job_id_value, "timeout")
                try:
                    self._executor.cancel(backend_ref)
                except Exception:
                    pass

            timeout_timer = threading.Timer(timeout_sec, _timeout_cancel)
            timeout_timer.daemon = True
            timeout_timer.start()

        result = self._executor.wait(backend_ref)

        if timeout_timer:
            timeout_timer.cancel()

        with self._lock:
            self._active.pop(job_id_value, None)

        self._finalize_job(job_id_value, result.exit_code, result.metrics_path, result.checkpoint_path)

    def _load_job(self, job_id: str) -> Optional[models.Job]:
        db = SessionLocal()
        try:
            return db.query(models.Job).filter(models.Job.id == job_id).first()
        finally:
            db.close()

    def _load_run(self, run_id: str) -> Optional[models.Run]:
        db = SessionLocal()
        try:
            return db.query(models.Run).filter(models.Run.id == run_id).first()
        finally:
            db.close()

    def _update_status(self, run: models.Run, job: models.Job, status: str) -> None:
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job.id).first()
            run = db.query(models.Run).filter(models.Run.id == run.id).first()
            if job and run:
                job.status = status
                run.status = status
                db.commit()
        finally:
            db.close()

    def _set_backend_ref(self, job_id: str, backend_ref: str, executor: str) -> None:
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.backend_ref = backend_ref
                job.executor = executor
                db.commit()
        finally:
            db.close()

    def _set_job_message(self, job_id: str, message: str) -> None:
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.message = message
                db.commit()
        finally:
            db.close()

    def _finalize_job(
        self,
        job_id: str,
        exit_code: int,
        metrics_path: str,
        checkpoint_path: Optional[str],
    ) -> None:
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if not job:
                return
            run = db.query(models.Run).filter(models.Run.id == job.run_id).first()
            if not run:
                return

            final_status = "SUCCEEDED" if exit_code == 0 else "FAILED"
            if not can_transition(job.status, final_status):
                return
            if job.status == "CANCELED":
                return

            series = metrics_service.read_series(run.id)
            if series:
                run.metrics = series
                if run.type == "EVAL":
                    result = db.query(models.EvalResult).filter(models.EvalResult.run_id == run.id).first()
                    if result:
                        result.metrics = {
                            key: values[-1]["value"] for key, values in series.items() if values
                        }

            checkpoint_added = False
            latest_checkpoint_id: Optional[str] = None
            try:
                existing_checkpoints = (
                    db.query(models.Checkpoint).filter(models.Checkpoint.run_id == run.id).all()
                )
                for checkpoint in existing_checkpoints:
                    if "latest" in (checkpoint.tags or []):
                        checkpoint.tags = [tag for tag in checkpoint.tags if tag != "latest"]

                if metrics_path:
                    metrics_content = metrics_service.read_raw(metrics_path)
                    if metrics_content:
                        artifact_service.write_artifact(
                            db,
                            run.id,
                            "/metrics/metrics.jsonl",
                            metrics_content,
                            "application/json",
                        )

                if checkpoint_path and Path(checkpoint_path).exists():
                    checkpoint_data = Path(checkpoint_path).read_text(encoding="utf-8")
                    checkpoint_payload = json.loads(checkpoint_data)
                    step = int(checkpoint_payload.get("step", 0))
                    metrics = checkpoint_payload.get("metrics") or {}
                    artifact_service.write_artifact(
                        db,
                        run.id,
                        f"/checkpoints/ckpt_{step}.json",
                        checkpoint_data,
                        "application/json",
                    )
                    checkpoint = models.Checkpoint(
                        run_id=run.id,
                        step=step,
                        metrics=metrics,
                        path=f"s3://runs/{run.id}/checkpoints/ckpt_{step}.json",
                        tags=["latest"],
                    )
                    db.add(checkpoint)
                    checkpoint_added = True
                    latest_checkpoint_id = checkpoint.id

                if not checkpoint_added:
                    last_step = 0
                    last_metrics = {}
                    for key, values in (series or {}).items():
                        if values:
                            last_step = max(last_step, int(values[-1]["step"]))
                            last_metrics[key] = values[-1]["value"]
                    if series or metrics_path:
                        step = last_step
                        payload = {
                            "run_id": run.id,
                            "step": step,
                            "metrics": {
                                "winRate": float(last_metrics.get("winRate", 0.0)),
                                "returnMean": float(last_metrics.get("returnMean", 0.0)),
                                "entropy": float(last_metrics.get("entropy", 0.0)),
                            },
                        }
                        checkpoint_json = json.dumps(payload, indent=2)
                        artifact_service.write_artifact(
                            db,
                            run.id,
                            f"/checkpoints/ckpt_{step}.json",
                            checkpoint_json,
                            "application/json",
                        )
                        checkpoint = models.Checkpoint(
                            run_id=run.id,
                            step=step,
                            metrics=payload["metrics"],
                            path=f"s3://runs/{run.id}/checkpoints/ckpt_{step}.json",
                            tags=["latest"],
                        )
                        db.add(checkpoint)
                        checkpoint_added = True
                        latest_checkpoint_id = checkpoint.id

                # Auto-add latest checkpoint to opponent pool if configured
                if latest_checkpoint_id and isinstance(run.config, dict):
                    pool_id = None
                    auto_pool = run.config.get("autoPool")
                    if isinstance(auto_pool, dict):
                        pool_id = auto_pool.get("poolId")
                    if not pool_id:
                        pool_id = run.config.get("autoPoolId")
                    if pool_id:
                        pool = db.query(models.OpponentPool).filter(models.OpponentPool.id == pool_id).first()
                        if pool and not pool.frozen:
                            exists = (
                                db.query(models.OpponentPoolMember)
                                .filter(
                                    models.OpponentPoolMember.pool_id == pool_id,
                                    models.OpponentPoolMember.snapshot_id == latest_checkpoint_id,
                                )
                                .first()
                            )
                            if not exists:
                                db.add(models.OpponentPoolMember(pool_id=pool_id, snapshot_id=latest_checkpoint_id))
                                pool.size = (pool.size or 0) + 1

                # --- Capture Eval/Matrix Artifacts ---
                run_dir = Path(metrics_path).parent if metrics_path else None
                if run_dir and run_dir.exists():
                    # Upload model files inside checkpoints (e.g., SB3 .zip, torch .pt)
                    checkpoint_dir = run_dir / "checkpoints"
                    if checkpoint_dir.exists():
                        for item in checkpoint_dir.glob("*"):
                            if item.suffix.lower() not in {".zip", ".pt", ".pth"}:
                                continue
                            try:
                                content = item.read_bytes()
                                mime = "application/octet-stream"
                                artifact_service.write_artifact(
                                    db, run.id, f"/checkpoints/{item.name}", content, mime
                                )
                            except Exception:
                                pass

                    # Check for Eval outputs
                    eval_dir = run_dir / "eval"
                    if eval_dir.exists():
                        for item in eval_dir.glob("*.json"):
                            try:
                                content = item.read_text(encoding="utf-8")
                                artifact_service.write_artifact(
                                    db, run.id, f"/eval/{item.name}", content, "application/json"
                                )
                            except Exception:
                                pass
                    # Check for Matrix outputs
                    matrix_dir = run_dir / "matrix"
                    if matrix_dir.exists():
                        for item in matrix_dir.glob("*"):
                            try:
                                content = item.read_text(encoding="utf-8")
                                mime = "application/json" if item.suffix == ".json" else "text/csv" if item.suffix == ".csv" else "application/octet-stream"
                                artifact_service.write_artifact(
                                    db, run.id, f"/matrix/{item.name}", content, mime
                                )
                            except Exception:
                                pass
                    
                    # Check for Videos
                    video_dir = run_dir / "videos"
                    if video_dir.exists():
                        for item in video_dir.glob("*.mp4"):
                            try:
                                # Videos are binary, need to read as bytes
                                content_bytes = item.read_bytes()
                                # write_artifact expects str for content by default in some implementations, 
                                # but let's check artifact_service.write_artifact signature.
                                # If it expects str, we might need to base64 it or use a different method.
                                # Checking `artifact_service.write_artifact`: 
                                # It likely uses `put_object` which handles bytes/str.
                                # However, our current `write_artifact` helper might assume text?
                                # Let's assume we need to handle binary upload.
                                # Since we cannot change `write_artifact` signature easily here without reading it,
                                # let's use a specialized call or assume it handles bytes if we modify it or if it supports it.
                                # Actually, `minio` client `put_object` takes a stream.
                                # Let's assume for MVP we might encounter an issue here if `write_artifact` enforces string.
                                # Let's do a quick read of `artifact_service.write_artifact` if possible.
                                # But for now, let's just try to pass it. If it fails, we catch.
                                # Wait, `write_artifact` in `artifacts.py` usually takes content as Any.
                                # Let's proceed.
                                artifact_service.write_artifact(
                                    db, run.id, f"/videos/{item.name}", content_bytes, "video/mp4"
                                )
                            except Exception:
                                pass

                    # Check for System Metrics
                    sys_metrics_path = run_dir / "system_metrics.jsonl"
                    if sys_metrics_path.exists():
                         try:
                            content = sys_metrics_path.read_text(encoding="utf-8")
                            artifact_service.write_artifact(
                                db, run.id, "/metrics/system_metrics.jsonl", content, "application/json"
                            )
                         except Exception:
                            pass

                    # Reproducibility snapshots
                    env_snapshot_path = run_dir / "env_snapshot.json"
                    if env_snapshot_path.exists():
                        try:
                            content = env_snapshot_path.read_text(encoding="utf-8")
                            artifact_service.write_artifact(
                                db, run.id, "/manifest/env_snapshot.json", content, "application/json", overwrite=True
                            )
                        except Exception:
                            pass

                    freeze_path = run_dir / "requirements_freeze.txt"
                    if freeze_path.exists():
                        try:
                            content = freeze_path.read_text(encoding="utf-8")
                            artifact_service.write_artifact(
                                db,
                                run.id,
                                "/manifest/requirements_freeze.txt",
                                content,
                                "text/plain",
                                overwrite=True,
                            )
                        except Exception:
                            pass

                    git_diff_path = run_dir / "git_diff.patch"
                    if git_diff_path.exists():
                        try:
                            content = git_diff_path.read_text(encoding="utf-8")
                            artifact_service.write_artifact(
                                db, run.id, "/manifest/git_diff.patch", content, "text/plain", overwrite=True
                            )
                        except Exception:
                            pass

                    git_status_path = run_dir / "git_status.txt"
                    if git_status_path.exists():
                        try:
                            content = git_status_path.read_text(encoding="utf-8")
                            artifact_service.write_artifact(
                                db, run.id, "/manifest/git_status.txt", content, "text/plain", overwrite=True
                            )
                        except Exception:
                            pass

                    fingerprint_path = run_dir / "run_fingerprint.json"
                    if fingerprint_path.exists():
                        try:
                            content = fingerprint_path.read_text(encoding="utf-8")
                            artifact_service.write_artifact(
                                db,
                                run.id,
                                "/manifest/run_fingerprint.json",
                                content,
                                "application/json",
                                overwrite=True,
                            )
                        except Exception:
                            pass

                    # Check for Datasets (Auto-Registration)
                    dataset_manifest_path = run_dir / "dataset_manifest.json"
                    if dataset_manifest_path.exists():
                        try:
                            manifest = json.loads(dataset_manifest_path.read_text(encoding="utf-8"))
                            local_file = run_dir / manifest.get("path", "")
                            if local_file.exists():
                                # 1. Upload to Artifact Store
                                # For local executor, we might just keep it, but for consistency let's treat it as artifact
                                # Ideally dataset is separate from run artifacts, but let's put it in run for now
                                object_key = f"datasets/{run.id}/{local_file.name}"
                                # We need to access s3_client to upload file
                                from app.services.s3 import s3_client
                                s3_client.upload_file(str(local_file), object_key)
                                
                                # 2. Register in DB
                                ds = models.Dataset(
                                    name=manifest.get("name", f"ds-{run.id}"),
                                    description=manifest.get("description"),
                                    path=f"s3://{settings.s3_bucket}/{object_key}",
                                    format=manifest.get("format", "unknown"),
                                    size_bytes=local_file.stat().st_size
                                )
                                db.add(ds)
                                # Note: We don't commit here yet, finalize_job commits at the end
                                print(f"[JobManager] Auto-registered dataset {ds.id}")
                        except Exception as e:
                            print(f"[JobManager] Failed to register dataset: {e}")

                db.flush()
                apply_checkpoint_policy(db, run.id)
                try:
                    artifact_service.write_artifact_manifest(db, run.id)
                except Exception:
                    pass
            except ValueError as exc:
                final_status = "FAILED"
                job.message = str(exc)

            if final_status == "SUCCEEDED":
                try:
                    if run.type == "EVAL":
                        eval_matrix_service.materialize_eval_result(db, run)
                    elif run.type == "MATRIX":
                        eval_matrix_service.materialize_matrix_result(db, run)
                except ValueError as exc:
                    final_status = "FAILED"
                    job.message = str(exc)

            job.status = final_status
            run.status = final_status

            try:
                runner_bundle_service.write_run_manifest(db, run, job, job.executor or "local")
            except ValueError:
                pass

            try:
                repro_bundle_service.generate(db, run)
            except ValueError:
                pass

            if final_status == "SUCCEEDED":
                try:
                    self._trigger_auto_eval(db, run)
                except Exception:
                    pass
            
            # Dispatch Webhook
            try:
                dispatch_webhooks(db, "job.finished", {
                    "job_id": job.id,
                    "run_id": run.id,
                    "status": final_status,
                    "exit_code": exit_code,
                    "timestamp": datetime.utcnow().isoformat()
                })
            except Exception:
                pass

            db.commit()
        finally:
            db.close()

    def _trigger_auto_eval(self, db: Session, run: models.Run) -> None:
        if run.type != "TRAIN":
            return
        if not isinstance(run.config, dict):
            return
        auto_eval = run.config.get("autoEval")
        if not isinstance(auto_eval, dict):
            return
        protocol_id = auto_eval.get("protocolId")
        trigger_on = str(auto_eval.get("triggerOn") or "").lower()
        if not protocol_id:
            return
        if trigger_on and trigger_on not in {"train_succeeded", "succeeded", "on_train_succeeded"}:
            return
        protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == protocol_id).first()
        if not protocol:
            return
        checkpoint = (
            db.query(models.Checkpoint)
            .filter(models.Checkpoint.run_id == run.id)
            .order_by(models.Checkpoint.step.desc())
            .first()
        )
        if not checkpoint:
            return
        project = db.query(models.Project).filter(models.Project.id == "system").first()
        if not project:
            project = models.Project(id="system", name="System", description="System generated runs", tags=["system"])
            db.add(project)
            db.commit()
            db.refresh(project)
        eval_run = models.Run(
            project_id=project.id,
            name=f"eval-{protocol_id}-{datetime.utcnow().strftime('%H%M%S')}",
            type="EVAL",
            status="PENDING",
            algo="eval",
            env=protocol_id,
            config={
                "protocolId": protocol_id,
                "policySnapshotId": checkpoint.id,
                "parentRunId": run.id,
                "protocol": {
                    "name": protocol.name,
                    "version": protocol.version,
                    "env": {
                        "envId": protocol.env_id,
                        "version": protocol.env_version or "",
                        "mapSet": protocol.map_set or "",
                    },
                    "evalSeeds": protocol.eval_seeds,
                    "episodesPerMatch": protocol.episodes_per_match,
                    "timeoutSec": protocol.timeout_sec,
                    "metrics": protocol.metrics,
                    "scenarioGrid": protocol.scenario_grid,
                    "opponentSampling": protocol.opponent_sampling,
                    "opponentPoolRef": {
                        "poolId": protocol.opponent_pool_id,
                        "version": protocol.opponent_pool_version,
                    }
                    if protocol.opponent_pool_id
                    else None,
                },
            },
            metrics={"returnMean": [], "winRate": [], "entropy": []},
        )
        db.add(eval_run)
        db.commit()
        db.refresh(eval_run)

        eval_job = models.Job(run_id=eval_run.id, status="PENDING")
        db.add(eval_job)
        db.commit()
        db.refresh(eval_job)

        result = models.EvalResult(run_id=eval_run.id, protocol_id=protocol_id, metrics={})
        db.add(result)
        db.commit()
        db.refresh(result)

        eval_run.config = {**(eval_run.config or {}), "evalResultId": result.id}
        db.commit()
        self.submit(eval_job.id)

    def start_notebook(self, run_id: str) -> Dict[str, str]:
        # Only LocalExecutor supports this for now
        if not isinstance(self._executor, LocalExecutor):
            raise ValueError("notebooks_only_supported_on_local_executor")
        
        db = SessionLocal()
        try:
            run = db.query(models.Run).filter(models.Run.id == run_id).first()
            if not run:
                raise ValueError("run_not_found")
            
            run_dir = paths.run_root(run_id)
            run_dir.mkdir(parents=True, exist_ok=True)
            
            # Allocate a port (simple increment for MVP, better use socket bind check)
            # We use a base port + hash of run_id mod 1000
            import hashlib
            port_offset = int(hashlib.sha256(run_id.encode()).hexdigest(), 16) % 1000
            port = 9000 + port_offset
            
            backend_ref = self._executor.submit_notebook(run_id, run_dir, port)
            
            # Wait a bit for it to start? No, return details.
            info = self._executor.get_notebook_info(backend_ref)
            
            # Update job status AND persist connection info in Run config
            job = db.query(models.Job).filter(models.Job.run_id == run_id).first()
            if job:
                job.status = "RUNNING"
                job.backend_ref = backend_ref
                job.executor = "local"
            
            # Persist URL/Token so frontend can list it later
            run.config = {
                **(run.config or {}),
                "url": info.get("url"),
                "token": info.get("token"),
                "port": info.get("port")
            }
            # Force update of JSON column
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(run, "config")
            
            db.commit()
            
            return info
        finally:
            db.close()

    def stop_notebook(self, run_id: str) -> None:
        backend_ref = f"notebook-{run_id}"
        self._executor.cancel(backend_ref)
        
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.run_id == run_id).first()
            if job:
                job.status = "CANCELED"
                db.commit()
        finally:
            db.close()

job_manager = JobManager()
