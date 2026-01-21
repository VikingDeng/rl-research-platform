from typing import Dict, Any
from app.schemas.base import APIModel

class TuningRequest(APIModel):
    project_id: str
    study_name: str
    algo_spec: Dict[str, Any]
    env_spec: Dict[str, Any]
    search_space: Dict[str, Any]
    n_trials: int = 10
    metric: str = "winRate"
    direction: str = "maximize"

class TuningResponse(APIModel):
    group_id: str
    message: str
