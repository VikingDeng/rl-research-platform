from collections.abc import Generator

from fastapi import Depends, HTTPException, Request, WebSocket
from sqlalchemy.orm import Session

from app.core import config
from app.db.session import SessionLocal
from app.services.auth import get_api_token


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _extract_bearer_token(header_value: str | None) -> str | None:
    if not header_value:
        return None
    parts = header_value.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1]


def require_api_token(request: Request, db: Session = Depends(get_db)) -> None:
    if config.settings.allow_anon:
        return
    if request.method == "OPTIONS":
        return
    path = request.url.path
    if path.endswith("/auth/login"):
        return
    token = _extract_bearer_token(request.headers.get("authorization"))
    if not token:
        raise HTTPException(status_code=401, detail="missing_api_token")
    expected = get_api_token(db)
    if token != expected:
        raise HTTPException(status_code=403, detail="invalid_api_token")


def check_ws_token(websocket: WebSocket, db: Session) -> bool:
    if config.settings.allow_anon:
        return True
    token = _extract_bearer_token(websocket.headers.get("authorization"))
    if not token:
        token = websocket.query_params.get("token")
    if not token:
        return False
    expected = get_api_token(db)
    return token == expected
