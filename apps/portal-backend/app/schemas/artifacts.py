from datetime import datetime
from typing import Optional, Dict, Any

from app.schemas.base import APIModel


class ArtifactFile(APIModel):
    id: str
    name: str
    path: str
    size: Optional[str] = None
    type: str
    last_modified: str
    created_at: Optional[datetime] = None
    object_key: Optional[str] = None


class ArtifactDownloadResponse(APIModel):
    url: str
    expires_at: Optional[str] = None


class ReproBundleResponse(APIModel):
    url: Optional[str] = None
    manifest: Optional[Dict[str, Any]] = None
