from typing import Optional, List

from app.schemas.base import APIModel


class LoginRequest(APIModel):
    email: str
    password: str


class LoginResponse(APIModel):
    token: str
    token_type: Optional[str] = "Bearer"
    expires_at: Optional[str] = None


class User(APIModel):
    id: str
    email: str
    name: Optional[str] = None
    roles: Optional[List[str]] = None
