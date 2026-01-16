import os
import subprocess
import sys
import threading
import uuid
import json
import signal
from pathlib import Path
from typing import Dict, List

from app.core.config import settings
from app.executors.base import ExecutionJob, ExecutionResult
from app.executors.gpu import GPUSlotAllocator, GPULock
from app.services import paths
from app.services import plugin_runtime
from app.services import runtime_packages


class LocalExecutor:
    def __init__(self) -> None:
        self._processes: Dict[str, subprocess.Popen] = {}
        self._metadata: Dict[str, Dict[str, str]] = {}
        self._locks: Dict[str, List[GPULock]] = {}
        self._lock = threading.Lock()
        self._gpu_allocator = GPUSlotAllocator(
            Path(settings.local_run_root),
            settings.local_executor_gpu_count,
        )

    def submit(self, job: ExecutionJob) -> str:
        run_dir = paths.run_root(job.run_id)
        metrics_path = paths.metrics_path(job.run_id)
        config_path = run_dir / "config.json"
        steps = settings.local_executor_steps
        step_size = 1000

        train_cfg = job.config.get("train") if isinstance(job.config, dict) else None
        if isinstance(train_cfg, dict) and train_cfg.get("totalEnvSteps"):
            total_steps = int(train_cfg["totalEnvSteps"])
            steps = max(1, min(settings.local_executor_steps, total_steps))
            step_size = max(1, int(total_steps / steps))

        ckpt_path = paths.checkpoint_path(job.run_id, steps * step_size)
        checkpoint_dir = paths.checkpoints_dir(job.run_id)
        log_path = paths.logs_path(job.run_id)

        config_payload = dict(job.config) if isinstance(job.config, dict) else {}
        config_payload["runId"] = job.run_id
        config_payload["jobId"] = job.job_id
        config_payload["runType"] = job.run_type
        config_path.write_text(json.dumps(config_payload, indent=2), encoding="utf-8")

        packages: List[str] = []
        if isinstance(job.config, dict):
            env_cfg = job.config.get("env")
            if isinstance(env_cfg, dict) and env_cfg.get("package"):
                packages.append(str(env_cfg["package"]))
            algo_cfg = job.config.get("algo")
            if isinstance(algo_cfg, dict) and algo_cfg.get("package"):
                packages.append(str(algo_cfg["package"]))
        runtime_spec = runtime_packages.prepare_runtime(packages)

        locks = self._gpu_allocator.acquire(job.gpus)
        gpu_ids = ",".join(str(lock.gpu_id) for lock in locks)

        runner_mode = settings.local_executor_mode.lower()
        # Resolve runner script from the 'runner' directory
        backend_root = Path(__file__).resolve().parents[2]
        runner_dir = backend_root / "runner"
        runner_script_path = runner_dir / "runner_main.py"
        
        # Fallback if using fake runner (which might still be in executors for now, or we move it?)
        # For this refactor, we assume real mode primarily or we point to the one in runner
        # If runner_mode is NOT real, we might want to keep using the fake runner in executors? 
        # Let's keep fake_runner.py in executors for now as it is a testing stub.
        if runner_mode == "real":
            script_to_run = str(runner_script_path)
            cmd = [
                sys.executable,
                script_to_run,
                "--run-id",
                job.run_id,
                "--metrics-path",
                str(metrics_path),
                "--config-path",
                str(config_path),
                "--checkpoint-dir",
                str(checkpoint_dir),
            ]
        else:
            # Keep using the fake runner located in this directory
            script_to_run = str(Path(__file__).resolve().with_name("fake_runner.py"))
            cmd = [
                sys.executable,
                script_to_run,
                "--run-id",
                job.run_id,
                "--metrics-path",
                str(metrics_path),
                "--checkpoint-path",
                str(ckpt_path),
                "--steps",
                str(steps),
                "--step-size",
                str(step_size),
                "--interval",
                str(settings.local_executor_step_interval),
            ]

        seed = None
        if isinstance(job.config, dict):
            seed_set = job.config.get("seedSet")
            if isinstance(seed_set, list) and seed_set:
                seed = seed_set[0]
            elif job.config.get("seed") is not None:
                seed = job.config.get("seed")

        if seed is not None and runner_mode != "real":
            cmd.extend(["--seed", str(seed)])

        env = os.environ.copy()
        if gpu_ids:
            env["CUDA_VISIBLE_DEVICES"] = gpu_ids
        env["RUN_ID"] = job.run_id
        env["OUTPUT_DIR"] = str(run_dir)
        env["METRICS_PATH"] = str(metrics_path)
        env["CHECKPOINT_DIR"] = str(checkpoint_dir)
        env["CONFIG_PATH"] = str(config_path)
        if seed is not None:
            env["RUN_SEED"] = str(seed)

        python_paths = []
        # Add backend root
        python_paths.append(str(backend_root))
        # Add runner dir so 'import algorithms' works
        python_paths.append(str(runner_dir))

        if runtime_spec:
            python_paths.insert(0, str(runtime_spec.python_path))
            env["RUNTIME_PACKAGES"] = ",".join(runtime_spec.packages)
            env["RUNTIME_CACHE_KEY"] = runtime_spec.cache_key

        plugin_cfg = job.config.get("plugin") if isinstance(job.config, dict) else None
        if isinstance(plugin_cfg, dict):
            runtime = plugin_runtime.prepare_runtime(job.run_id, plugin_cfg, config_payload)
            cmd.extend(["--plugin-spec", str(runtime.spec_path)])
            python_paths.insert(0, str(runtime.python_path))
            env["PLUGIN_SPEC_PATH"] = str(runtime.spec_path)

        existing = env.get("PYTHONPATH")
        if existing:
            python_paths.append(existing)
        env["PYTHONPATH"] = os.pathsep.join(p for p in python_paths if p)

        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_handle = open(log_path, "a", encoding="utf-8")

        backend_ref = uuid.uuid4().hex
        try:
            process = subprocess.Popen(
                cmd,
                cwd=str(run_dir),
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
            )
        except Exception:
            log_handle.close()
            for lock in locks:
                lock.release()
            raise
        log_handle.close()

        with self._lock:
            self._processes[backend_ref] = process
            self._metadata[backend_ref] = {
                "metrics_path": str(metrics_path),
                "checkpoint_path": str(ckpt_path),
                "log_path": str(log_path),
            }
            self._locks[backend_ref] = locks

        return backend_ref

    def status(self, backend_ref: str) -> str:
        with self._lock:
            process = self._processes.get(backend_ref)
        if not process:
            return "FAILED"
        if process.poll() is None:
            return "RUNNING"
        return "SUCCEEDED" if process.returncode == 0 else "FAILED"

    def cancel(self, backend_ref: str) -> None:
        with self._lock:
            process = self._processes.get(backend_ref)
        if not process:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        self._release_locks(backend_ref)
        with self._lock:
            self._processes.pop(backend_ref, None)
            self._metadata.pop(backend_ref, None)

    def pause(self, backend_ref: str) -> None:
        with self._lock:
            process = self._processes.get(backend_ref)
        if not process or process.poll() is not None:
            return
        try:
            process.send_signal(signal.SIGSTOP)
        except Exception:
            return

    def resume(self, backend_ref: str) -> None:
        with self._lock:
            process = self._processes.get(backend_ref)
        if not process or process.poll() is not None:
            return
        try:
            process.send_signal(signal.SIGCONT)
        except Exception:
            return

    def wait(self, backend_ref: str) -> ExecutionResult:
        with self._lock:
            process = self._processes.get(backend_ref)
            metadata = self._metadata.get(backend_ref, {})
        if not process:
            return ExecutionResult(backend_ref=backend_ref, exit_code=1, metrics_path="", checkpoint_path=None)

        exit_code = process.wait()
        self._release_locks(backend_ref)
        with self._lock:
            self._processes.pop(backend_ref, None)
            self._metadata.pop(backend_ref, None)
        return ExecutionResult(
            backend_ref=backend_ref,
            exit_code=exit_code,
            metrics_path=metadata.get("metrics_path", ""),
            checkpoint_path=metadata.get("checkpoint_path"),
        )

    def _release_locks(self, backend_ref: str) -> None:
        with self._lock:
            locks = self._locks.pop(backend_ref, [])
        for lock in locks:
            lock.release()
