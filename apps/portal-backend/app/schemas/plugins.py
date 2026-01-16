from typing import Optional, Dict, Any

from app.schemas.base import APIModel


class Plugin(APIModel):
    id: str
    name: str
    version: str
    type: str
    description: Optional[str] = None
    author: Optional[str] = None
    installed: Optional[bool] = None
    archived: Optional[bool] = None


class PluginVersion(APIModel):
    plugin_id: str
    version: str
    wheel_uri: str
    sha256: str
    manifest: Optional[Dict[str, Any]] = None
    frozen: Optional[bool] = None


class PluginUpdate(APIModel):
    name: Optional[str] = None
    description: Optional[str] = None
    author: Optional[str] = None
    type: Optional[str] = None
    installed: Optional[bool] = None
    archived: Optional[bool] = None


class PluginVersionCreate(PluginVersion):
    pass
