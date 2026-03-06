from datetime import datetime
from typing import Dict, Any, List, Optional

from app.schemas.base import APIModel
from app.schemas.runs import ResourceSpec


class EnvRef(APIModel):
    env_id: str
    version: str
    map_set: str


class OpponentPoolRef(APIModel):
    pool_id: str
    version: str


class EvalProtocolSummary(APIModel):
    id: str
    protocol_key: Optional[str] = None
    name: str
    version: str
    env_id: str
    map: str
    eval_seeds: List[int]
    episodes: int
    scenario_grid: Optional[Dict[str, Any]] = None
    opponent_sampling: Optional[Dict[str, Any]] = None
    opponent_pool_ref: Optional[OpponentPoolRef] = None
    frozen: bool
    created: Optional[datetime] = None


class EvalProtocol(APIModel):
    id: str
    protocol_key: Optional[str] = None
    name: str
    version: str
    env: EnvRef
    eval_seeds: List[int]
    episodes_per_match: int
    timeout_sec: Optional[int] = None
    metrics: Optional[List[str]] = None
    scenario_grid: Optional[Dict[str, Any]] = None
    opponent_sampling: Optional[Dict[str, Any]] = None
    opponent_pool_ref: Optional[OpponentPoolRef] = None
    frozen: bool
    created_at: Optional[datetime] = None


class EvalProtocolCreate(APIModel):
    name: str
    version: Optional[str] = None
    env: EnvRef
    eval_seeds: List[int]
    episodes_per_match: int
    timeout_sec: Optional[int] = None
    metrics: Optional[List[str]] = None
    scenario_grid: Optional[Dict[str, Any]] = None
    opponent_sampling: Optional[Dict[str, Any]] = None
    opponent_pool_ref: Optional[OpponentPoolRef] = None


class EvalProtocolVersionCreate(APIModel):
    version: Optional[str] = None
    name: Optional[str] = None
    env: Optional[EnvRef] = None
    eval_seeds: Optional[List[int]] = None
    episodes_per_match: Optional[int] = None
    timeout_sec: Optional[int] = None
    metrics: Optional[List[str]] = None
    scenario_grid: Optional[Dict[str, Any]] = None
    opponent_sampling: Optional[Dict[str, Any]] = None
    opponent_pool_ref: Optional[OpponentPoolRef] = None


class EvalProtocolUpdate(APIModel):
    name: Optional[str] = None
    env: Optional[EnvRef] = None
    eval_seeds: Optional[List[int]] = None
    episodes_per_match: Optional[int] = None
    timeout_sec: Optional[int] = None
    metrics: Optional[List[str]] = None
    scenario_grid: Optional[Dict[str, Any]] = None
    opponent_sampling: Optional[Dict[str, Any]] = None
    opponent_pool_ref: Optional[OpponentPoolRef] = None


class OpponentPoolSummary(APIModel):
    id: str
    pool_key: Optional[str] = None
    name: str
    version: str
    size: int
    env: str
    frozen: bool
    created: Optional[datetime] = None


class OpponentPool(APIModel):
    id: str
    pool_key: Optional[str] = None
    name: str
    version: str
    env: str
    size: Optional[int] = None
    frozen: bool
    created: Optional[datetime] = None
    member_snapshot_ids: Optional[List[str]] = None


class OpponentPoolCreate(APIModel):
    name: str
    env: str
    version: Optional[str] = None
    member_snapshot_ids: Optional[List[str]] = None


class OpponentPoolVersionCreate(APIModel):
    version: Optional[str] = None
    member_snapshot_ids: Optional[List[str]] = None


class OpponentPoolMembersUpdate(APIModel):
    snapshot_ids: List[str]
    mode: str


class EvalJobRequest(APIModel):
    policy_snapshot_id: str
    protocol_id: str
    resources: Optional[ResourceSpec] = None
    webhook_url: Optional[str] = None


class EvalJobResponse(APIModel):
    run_id: str
    job_id: str
    eval_result_id: str


class MatrixJobRequest(APIModel):
    pool_id: Optional[str] = None
    policy_snapshot_ids: List[str]
    protocol_id: str
    games_per_pair: Optional[int] = None
    metric: Optional[str] = None
    resources: Optional[ResourceSpec] = None
    webhook_url: Optional[str] = None


class MatrixJobResponse(APIModel):
    matrix_id: str
    job_id: str


class ConfidenceInterval(APIModel):
    low: float
    high: float
    level: float


class EvalResultSummary(APIModel):
    mean: float
    std: float
    n: int


class EvalResult(APIModel):
    id: str
    run_id: Optional[str] = None
    protocol_id: str
    metrics: Optional[Dict[str, float]] = None
    summary: Optional[EvalResultSummary] = None
    ci: Optional[ConfidenceInterval] = None
    created_at: Optional[datetime] = None
    artifact_url: Optional[str] = None


class MatrixCell(APIModel):
    row: str
    col: str
    value: float


class MatrixMeta(APIModel):
    games_per_pair: Optional[int] = None
    seeds: Optional[List[int]] = None
    metric: Optional[str] = None


class RankingEntry(APIModel):
    id: str
    score: float
    ci: Optional[ConfidenceInterval] = None


class MatrixArtifacts(APIModel):
    csv_uri: Optional[str] = None
    json_uri: Optional[str] = None
    heatmap_uri: Optional[str] = None


class MatrixResult(APIModel):
    id: str
    protocol_id: Optional[str] = None
    pool_id: Optional[str] = None
    created_at: Optional[datetime] = None
    cells: List[MatrixCell]
    labels: Optional[List[str]] = None
    matrix: Optional[List[List[float]]] = None
    meta: Optional[MatrixMeta] = None
    ranking: Optional[List[RankingEntry]] = None
    artifacts: Optional[MatrixArtifacts] = None
    summary: Optional[Dict[str, Any]] = None
    export_url: Optional[str] = None
