from typing import Optional, Any, Dict
from datetime import datetime
from app.schemas.base import APIModel

class DatasetCreate(APIModel):
    name: str
    description: Optional[str] = None
    path: str
    format: str = "jsonl"

class Dataset(APIModel):
    id: str
    name: str
    description: Optional[str] = None
    path: str
    format: str
    size_bytes: int
    created_at: datetime


class DatasetPreview(APIModel):
    id: str
    available: bool = True
    format: str
    size_bytes: int
    sha256: Optional[str] = None
    summary: Optional[Dict[str, Any]] = None
    sample: Optional[Any] = None
    error: Optional[str] = None
