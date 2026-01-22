import uuid
from sqlalchemy.orm import Session

from app.db import models


def generate_api_token() -> str:
    return f"sk-{uuid.uuid4().hex}"


def ensure_setting(db: Session, key: str, default_value: dict) -> models.SystemSetting:
    setting = db.query(models.SystemSetting).filter(models.SystemSetting.key == key).first()
    if setting:
        return setting
    setting = models.SystemSetting(key=key, value=default_value)
    db.add(setting)
    db.commit()
    db.refresh(setting)
    return setting


def get_api_token(db: Session) -> str:
    setting = ensure_setting(db, "api_token", {"token": generate_api_token()})
    token = setting.value.get("token") if isinstance(setting.value, dict) else None
    if not token:
        token = generate_api_token()
        setting.value = {"token": token}
        db.commit()
    return token
