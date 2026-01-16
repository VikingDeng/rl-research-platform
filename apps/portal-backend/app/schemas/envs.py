from typing import List, Optional, Dict, Any

from app.schemas.base import APIModel


class EnvSpec(APIModel):
    id: str
    versions: List[str]
    maps: List[str]
    archived: bool


class EnvSpecUpdate(APIModel):
    archived: Optional[bool] = None


class EnvMapSet(APIModel):
    id: str
    maps: List[str]


class EnvVersion(APIModel):
    env_id: str
    version: str
    api_mode: str
    entrypoint: Optional[str] = None
    package: Optional[str] = None
    active: Optional[bool] = None
    frozen: Optional[bool] = None
    default_image_digest: Optional[str] = None
    map_sets: Optional[List[EnvMapSet]] = None
    scenario_schema: Optional[Dict[str, Any]] = None


class EnvVersionCreate(APIModel):
    version: str
    api_mode: str
    entrypoint: str
    package: Optional[str] = None
    active: Optional[bool] = None
    frozen: Optional[bool] = None
    default_image_digest: Optional[str] = None
    map_sets: Optional[List[EnvMapSet]] = None
    scenario_schema: Optional[Dict[str, Any]] = None


class EnvVersionUpsert(APIModel):
    env_id: str
    version: str
    api_mode: str
    entrypoint: str
    package: Optional[str] = None
    active: Optional[bool] = None
    frozen: Optional[bool] = None
    default_image_digest: Optional[str] = None
    map_sets: Optional[List[EnvMapSet]] = None
    scenario_schema: Optional[Dict[str, Any]] = None


class EnvVersionUpdate(APIModel):
    api_mode: Optional[str] = None
    entrypoint: Optional[str] = None
    package: Optional[str] = None
    active: Optional[bool] = None
    frozen: Optional[bool] = None
    default_image_digest: Optional[str] = None
    map_sets: Optional[List[EnvMapSet]] = None
    scenario_schema: Optional[Dict[str, Any]] = None
