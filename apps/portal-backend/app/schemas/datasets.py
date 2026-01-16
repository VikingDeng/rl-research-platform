from typing import Optional
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
