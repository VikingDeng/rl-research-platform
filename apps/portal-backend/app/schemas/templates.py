from datetime import datetime
from typing import List, Optional, Dict, Any

from pydantic import Field

from app.schemas.base import APIModel


class Algo(APIModel):
    id: str
    name: str
    description: Optional[str] = None
    archived: Optional[bool] = None


class AlgoUpdate(APIModel):
    name: Optional[str] = None
    description: Optional[str] = None
    archived: Optional[bool] = None


class AlgoVersion(APIModel):
    id: str
    algo_id: str
    version: str
    entrypoint: str
    package: Optional[str] = None
    artifact_uri: Optional[str] = None
    config_schema: Optional[Dict[str, Any]] = None
    default_config: Optional[Dict[str, Any]] = None
    resource_profile: Optional[Dict[str, Any]] = None
    env_constraints: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    active: bool
    frozen: Optional[bool] = None
    created_at: Optional[datetime] = None


class AlgoVersionCreate(APIModel):
    version: str
    entrypoint: str
    package: Optional[str] = None
    artifact_uri: Optional[str] = None
    config_schema: Optional[Dict[str, Any]] = None
    default_config: Optional[Dict[str, Any]] = None
    resource_profile: Optional[Dict[str, Any]] = None
    env_constraints: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    active: Optional[bool] = None
    frozen: Optional[bool] = None
    code: Optional[str] = None


class AlgoVersionUpdate(APIModel):
    entrypoint: Optional[str] = None
    package: Optional[str] = None
    artifact_uri: Optional[str] = None
    config_schema: Optional[Dict[str, Any]] = None
    default_config: Optional[Dict[str, Any]] = None
    resource_profile: Optional[Dict[str, Any]] = None
    env_constraints: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    active: Optional[bool] = None
    frozen: Optional[bool] = None
    code: Optional[str] = None


class Template(APIModel):
    id: str
    project_id: str
    name: str
    description: Optional[str] = None
    type: str
    default_config: Dict[str, Any]
    archived: Optional[bool] = None


class TemplateCreate(APIModel):
    name: str
    description: Optional[str] = None
    type: str
    default_config: Optional[Dict[str, Any]] = None


class TemplateUpdate(APIModel):
    name: Optional[str] = None
    description: Optional[str] = None
    default_config: Optional[Dict[str, Any]] = None
    archived: Optional[bool] = None


class TemplateVersion(APIModel):
    id: str
    template_id: str
    algo_version_id: Optional[str] = None
    version: str
    default_config: Optional[Dict[str, Any]] = None
    network_template: Optional[Dict[str, Any]] = None
    env_constraints: Optional[Dict[str, Any]] = None
    wrappers: Optional[List[str]] = None
    created_at: Optional[datetime] = None
    frozen: Optional[bool] = None


class TemplateVersionCreate(APIModel):
    version: str
    algo_version_id: str
    default_config: Optional[Dict[str, Any]] = None
    network_template: Optional[Dict[str, Any]] = None
    env_constraints: Optional[Dict[str, Any]] = None
    wrappers: Optional[List[str]] = None


class TemplateDetail(Template):
    versions: Optional[List[TemplateVersion]] = None
