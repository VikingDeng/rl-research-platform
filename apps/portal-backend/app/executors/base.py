from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass
class ExecutionJob:
    job_id: str
    run_id: str
    run_type: str
    config: dict
    gpus: int


@dataclass
class ExecutionResult:
    backend_ref: str
    exit_code: int
    metrics_path: str
    checkpoint_path: Optional[str]
    error: Optional[str] = None


class ExecutionBackend(Protocol):
    def submit(self, job: ExecutionJob) -> str:
        ...

    def status(self, backend_ref: str) -> str:
        ...

    def cancel(self, backend_ref: str) -> None:
        ...

    def wait(self, backend_ref: str) -> ExecutionResult:
        ...
