from datetime import datetime
from typing import List, Optional

from app.schemas.base import APIModel


class WebhookCreate(APIModel):
    url: str
    events: List[str]
    secret: Optional[str] = None


class Webhook(APIModel):
    id: str
    url: str
    events: List[str]
    active: Optional[bool] = None
    created_at: Optional[datetime] = None
