from typing import Any, Dict, List, Optional

from pydantic import Field

from app.schemas.base import APIModel


class AlgoManifest(APIModel):
    name: str
    version: str
    entrypoint: str
    python: str
    dependencies: List[str] = Field(default_factory=list)
    default_config: Dict[str, Any] = Field(default_factory=dict)
    config_schema: Dict[str, Any] = Field(default_factory=dict)
    resource_profile: Optional[Dict[str, Any]] = None
    env_constraints: Optional[Dict[str, Any]] = None
    algo_id: Optional[str] = None

