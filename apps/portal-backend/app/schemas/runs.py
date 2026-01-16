from datetime import datetime
from typing import Dict, Any, List, Optional

from app.schemas.base import APIModel


class MetricPoint(APIModel):
    step: int
    value: float


class RunMetrics(APIModel):
    return_mean: List[MetricPoint]
    win_rate: List[MetricPoint]
    entropy: List[MetricPoint]


class GitInfo(APIModel):
    branch: str
    commit: str
    url: str
    is_dirty: bool
    diff: Optional[str] = None


class Run(APIModel):
    id: str
    project_id: str
    name: str
    type: str
    status: str
    algo: str
    env: str
    group_id: Optional[str] = None
    duration: Optional[str] = None
    gpu: Optional[int] = None
    created: datetime
    config: Dict[str, Any]
    git: Optional[GitInfo] = None
    metrics: Dict[str, Any]


class CheckpointMetrics(APIModel):
    win_rate: float
    return_mean: float


class Checkpoint(APIModel):
    id: str
    run_id: str
    step: int
    metrics: Dict[str, Any]
    path: str
    tags: List[str]
    created_at: datetime


class CheckpointTagRequest(APIModel):
    tag: str


class Job(APIModel):
    id: str
    run_id: str
    status: str
    priority: int = 2
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    message: Optional[str] = None


class JobControlRequest(APIModel):
    reason: Optional[str] = None


class TrainJobEnv(APIModel):
    env_id: str
    version: str
    map_set: str
    wrappers: Optional[List[str]] = None


class TrainJobAlgo(APIModel):
    algo_id: str
    algo_version_id: str
    preset: Optional[str] = None


class TrainJobAgent(APIModel):
    policy_sharing: Optional[str] = None
    arch: Optional[str] = None
    recurrent: Optional[bool] = None


class TrainJobTrain(APIModel):
    total_env_steps: int
    rollout_len: int
    batch_size: int
    lr: float
    entropy_coef: Optional[float] = None
    gamma: Optional[float] = None
    gae_lambda: Optional[float] = None


class ResourceSpec(APIModel):
    gpus: int
    cpus: Optional[int] = None
    mem_gb: Optional[int] = None
    priority: Optional[int] = 2  # 1=Low, 2=Normal, 3=High


class PluginRef(APIModel):
    plugin_id: str
    version: str


class AutoEvalConfig(APIModel):
    protocol_id: str
    trigger_on: str


class GitConfig(APIModel):
    repo: Optional[str] = None
    branch: Optional[str] = None
    commit: Optional[str] = None


class TrainJobRequest(APIModel):
    project_id: str
    template_version_id: str
    env: TrainJobEnv
    algo: TrainJobAlgo
    agent: Optional[TrainJobAgent] = None
    train: TrainJobTrain
    resources: ResourceSpec
    seed_set: Optional[List[int]] = None
    plugin: Optional[PluginRef] = None
    auto_eval: Optional[AutoEvalConfig] = None
    git: Optional[GitConfig] = None
    group_id: Optional[str] = None
    dataset_id: Optional[str] = None


class TrainJobResponse(APIModel):
    run_id: str
    job_id: str


class RunMetricsResponse(APIModel):
    run_id: str
    series: Dict[str, List[MetricPoint]]


class LogPage(APIModel):
    lines: List[str]
    page: int
    page_size: int
    has_more: bool
