from datetime import datetime
from typing import Optional, List
from app.schemas.base import APIModel

class RegisteredModel(APIModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class ModelVersion(APIModel):
    id: str
    model_id: str
    checkpoint_id: str
    version: int
    stage: str
    created_at: datetime

class ModelCreate(APIModel):
    name: str
    description: Optional[str] = None

class ModelVersionCreate(APIModel):
    checkpoint_id: str

class ModelVersionUpdate(APIModel):
    stage: str
