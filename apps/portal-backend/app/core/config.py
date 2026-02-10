import os
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "rl-research-platform-backend"
    database_url: str = "sqlite:///rl_platform.db"
    s3_endpoint_url: str = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "rl-artifacts"
    allow_anon: bool = True
    local_run_root: str = ".local/runs"
    local_executor_gpu_count: int = 4
    local_executor_steps: int = 5
    local_executor_step_interval: float = 0.2
    local_executor_mode: str = "real"
    executor_mode: str = "local"
    job_max_workers: int = 4
    job_queue_max_size: int = 100
    job_default_timeout_sec: int = 0
    determined_master_url: Optional[str] = None
    determined_mock: bool = False
    determined_token: Optional[str] = None
    determined_project_id: int = 1
    determined_image: Optional[str] = None
    determined_entrypoint: str = "python -m app.executors.determined_runner"
    determined_poll_interval: float = 2.0
    determined_shared_fs_root: Optional[str] = None
    cors_allow_origins: str = "*"
    env_entrypoint_validate: bool = False
    algo_entrypoint_validate: bool = False
    runtime_auto_install: bool = False
    runtime_cache_root: str = ".local/runtimes"
    algo_store_dir: str = ".local/algos"
    runtime_pip_index_url: Optional[str] = None
    runtime_pip_extra_args: Optional[str] = None
    runner_python: Optional[str] = None
    eval_entrypoint: str = "algorithms.sb3_eval:evaluate"
    eval_algo_name: str = "SB3 Evaluator"
    matrix_entrypoint: str = "algorithms.matrix_eval:run"
    matrix_algo_name: str = "Matrix Evaluator"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
