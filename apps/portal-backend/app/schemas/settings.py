from typing import Optional

from app.schemas.base import APIModel


class ExecutorSettings(APIModel):
    mode: str
    local_gpu_count: int
    local_executor_mode: str
    determined_master_url: Optional[str] = None
    determined_connected: Optional[bool] = None
    determined_mock: Optional[bool] = None
    scheduler: Optional[str] = None


class StorageUsage(APIModel):
    artifact_bytes: int
    db_bytes: Optional[int] = None


class RetentionPolicy(APIModel):
    checkpoint_policy: str


class SettingsResponse(APIModel):
    api_token: str
    executor: ExecutorSettings
    storage: StorageUsage
    retention: RetentionPolicy


class SettingsUpdate(APIModel):
    checkpoint_policy: Optional[str] = None


class TokenRotateResponse(APIModel):
    api_token: str


class RetentionApplyResponse(APIModel):
    runs_processed: int
    checkpoints_removed: int
    artifacts_removed: int
