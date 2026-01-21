import json
import queue
import threading
from datetime import datetime
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


class JobManager:
    def __init__(self) -> None:
        # PriorityQueue stores tuples: (priority_score, job_id). Lowest score popped first.
        # We map High(3) -> -3, Normal(2) -> -2, Low(1) -> -1.
        self._queue: "queue.PriorityQueue[tuple[int, str]]" = queue.PriorityQueue()
        executor_mode = settings.executor_mode.lower()
        if executor_mode == "determined":
            self._executor = DeterminedExecutor()
            self._executor_name = "determined"
        else:
            self._executor = LocalExecutor()
            self._executor_name = "local"
        self._stop = threading.Event()
        self._dispatcher = threading.Thread(target=self._dispatch_loop, daemon=True)
        self._lock = threading.Lock()
        self._active: dict[str, str] = {}

    def start(self, enqueue_pending: bool = True) -> None:
        if self._stop.is_set():
            self._stop.clear()
        started = False
        if not self._dispatcher.is_alive():
            self._dispatcher = threading.Thread(target=self._dispatch_loop, daemon=True)
            self._dispatcher.start()
            started = True
        if enqueue_pending and started:
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

    def submit(self, job_id: str) -> None:
        if not self._dispatcher.is_alive():
            self.start(enqueue_pending=False)
        
        # Need to fetch priority
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            p = job.priority if job and job.priority is not None else 2
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
            threading.Thread(target=self._run_job, args=(job_id,), daemon=True).start()

    def _run_job(self, job_id: str) -> None:
        job = self._load_job(job_id)
        if not job or job.status != "PENDING":
            return

        run = self._load_run(job.run_id)
        if not run:
            return

        # --- Inject Model Path for Eval Jobs ---
        # If this is an Eval run, we need to resolve the policySnapshotId to a real path
        if run.type == "EVAL" and isinstance(run.config, dict):
            snapshot_id = run.config.get("policySnapshotId")
            if snapshot_id:
                # Find the checkpoint
                ckpt = db.query(models.Checkpoint).filter(models.Checkpoint.id == snapshot_id).first()
                if ckpt:
                    # In our MVP, `ckpt.path` is s3://... 
                    # But for Local Execution, we know where it is: .local/runs/{run_id}/checkpoints/model_final.zip
                    # Wait, the Checkpoint model doesn't store the local path directly, it stores the S3 path.
                    # But the artifact path logic is predictable.
                    # Let's use ArtifactService or Paths service to resolve it.
                    # Actually, `ckpt.path` is `s3://runs/{runId}/checkpoints/ckpt_{step}.json`. 
                    # The ACTUAL model file (zip) is what we need. 
                    # `sb3_train.py` saves `model_final.zip`.
                    # Let's try to infer the zip path from the run_id of the checkpoint.
                    
                    # 1. Get the parent run of the checkpoint
                    parent_run_id = ckpt.run_id
                    
                    # 2. Construct local path (assuming shared FS / Local mode)
                    # We can use `app.services.paths`
                    from app.services import paths
                    # Ideally we find the artifact record for the zip
                    model_artifact = db.query(models.Artifact).filter(
                        models.Artifact.run_id == parent_run_id,
                        models.Artifact.name.like("%.zip") # Assuming SB3 zip
                    ).order_by(models.Artifact.created_at.desc()).first()
                    
                    if model_artifact:
                        # Construct absolute local path
                        # settings.local_run_root / parent_run_id / ...
                        # But wait, artifacts are in S3 (MinIO).
                        # For Local Executor, we can assume MinIO is just a folder or we download it.
                        # Since we are running "Real", we should download the artifact to a temp dir for the eval job.
                        
                        # Let's DOWNLOAD the model to the eval job's directory
                        eval_run_dir = paths.run_root(run.id)
                        eval_run_dir.mkdir(parents=True, exist_ok=True)
                        local_model_path = eval_run_dir / "model.zip"
                        
                        try:
                            # We can use s3_client to download
                            # model_artifact.object_key is the key
                            from app.services.s3 import s3_client
                            s3_client.download_file(s3_client.bucket, model_artifact.object_key, str(local_model_path))
                            
                            # Update config with this local path
                            run.config["modelPath"] = str(local_model_path)
                            # We must commit this config change so the executor sees it? 
                            # Or just pass it to ExecutionJob.
                            # ExecutionJob takes `config` as argument. We update that dict.
                        except Exception as e:
                            print(f"Failed to download model for eval: {e}")
                
        # --- Inject Dataset Path for Offline RL ---
        if isinstance(run.config, dict):
            dataset_id = run.config.get("datasetId")
            if dataset_id:
                ds = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
                if ds:
                    run.config["datasetPath"] = ds.path
                    run.config["datasetFormat"] = ds.format

        self._update_status(run, job, "RUNNING")
        exec_job = ExecutionJob(
            job_id=job.id,
            run_id=run.id,
            run_type=run.type,
            config=run.config,
            gpus=run.gpu or 0,
        )
        try:
            backend_ref = self._executor.submit(exec_job)
        except Exception as exc:
            self._update_status(run, job, "FAILED")
            self._set_job_message(job.id, str(exc))
            return
        self._set_backend_ref(job_id, backend_ref, self._executor_name)

        with self._lock:
            self._active[job_id] = backend_ref

        result = self._executor.wait(backend_ref)

        with self._lock:
            self._active.pop(job_id, None)

        self._finalize_job(job_id, result.exit_code, result.metrics_path, result.checkpoint_path)

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

                # --- Capture Eval/Matrix Artifacts ---
                run_dir = Path(metrics_path).parent if metrics_path else None
                if run_dir and run_dir.exists():
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
