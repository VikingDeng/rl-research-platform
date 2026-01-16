from typing import List, Optional
from sqlalchemy.orm import Session
from app.db import models
from app.schemas.datasets import DatasetCreate

class DatasetService:
    def list_datasets(self, db: Session) -> List[models.Dataset]:
        return db.query(models.Dataset).order_by(models.Dataset.created_at.desc()).all()

    def create_dataset(self, db: Session, payload: DatasetCreate) -> models.Dataset:
        # In a real system, we might validate path or trigger an upload.
        # For MVP, we just register the record.
        ds = models.Dataset(
            name=payload.name,
            description=payload.description,
            path=payload.path,
            format=payload.format,
            size_bytes=0 # We don't check size for now
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)
        return ds

    def get_dataset(self, db: Session, dataset_id: str) -> Optional[models.Dataset]:
        return db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()

dataset_service = DatasetService()
