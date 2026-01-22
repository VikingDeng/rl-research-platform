from typing import List, Optional
import os
import shutil
import uuid
import hashlib
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlparse

from fastapi import UploadFile
from sqlalchemy.orm import Session
from app.db import models
from app.schemas.datasets import DatasetCreate
from app.services.s3 import s3_client
from app.core.config import settings

class DatasetService:
    def list_datasets(self, db: Session) -> List[models.Dataset]:
        return db.query(models.Dataset).order_by(models.Dataset.created_at.desc()).all()

    def create_dataset(self, db: Session, payload: DatasetCreate) -> models.Dataset:
        size_bytes = 0
        resolved_path = payload.path
        if payload.path and not payload.path.startswith(("s3://", "http://", "https://")):
            path_obj = Path(payload.path).expanduser().resolve()
            resolved_path = str(path_obj)
            if path_obj.exists() and path_obj.is_file():
                size_bytes = path_obj.stat().st_size

        ds = models.Dataset(
            id=uuid.uuid4().hex,
            name=payload.name,
            description=payload.description,
            path=resolved_path,
            format=payload.format,
            size_bytes=size_bytes
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)
        return ds

    def get_dataset(self, db: Session, dataset_id: str) -> Optional[models.Dataset]:
        return db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()

    def create_dataset_from_upload(
        self,
        db: Session,
        name: str,
        description: Optional[str],
        fmt: str,
        upload: UploadFile,
    ) -> models.Dataset:
        dataset_id = uuid.uuid4().hex
        filename = Path(upload.filename or "dataset.bin").name
        object_key = f"datasets/{dataset_id}/{filename}"

        tmp_path = None
        try:
            with NamedTemporaryFile(delete=False) as tmp:
                tmp_path = tmp.name
                shutil.copyfileobj(upload.file, tmp)

            size_bytes = os.path.getsize(tmp_path)
            s3_client.ensure_bucket()
            s3_client.upload_file(tmp_path, object_key)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
            try:
                upload.file.close()
            except Exception:
                pass

        ds = models.Dataset(
            id=dataset_id,
            name=name,
            description=description,
            path=f"s3://{settings.s3_bucket}/{object_key}",
            format=fmt,
            size_bytes=size_bytes,
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)
        return ds

    def resolve_download_url(self, dataset: models.Dataset) -> Optional[str]:
        path = dataset.path
        if not path:
            return None
        if path.startswith(("http://", "https://")):
            return path
        if path.startswith("s3://"):
            parsed = urlparse(path)
            bucket = parsed.netloc or settings.s3_bucket
            key = parsed.path.lstrip("/")
            if bucket != settings.s3_bucket and s3_client.mode != "local":
                return path
            return s3_client.presigned_get_url(key)
        return None

    def _resolve_local_path(self, dataset: models.Dataset) -> Optional[Path]:
        path = dataset.path
        if not path:
            return None
        if path.startswith(("http://", "https://")):
            return None
        if path.startswith("s3://"):
            parsed = urlparse(path)
            bucket = parsed.netloc or settings.s3_bucket
            key = parsed.path.lstrip("/")
            if s3_client.mode == "local":
                return (s3_client.local_root / bucket / key).resolve()
            return None
        return Path(path).expanduser().resolve()

    def _sha256_for_path(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _preview_jsonl(self, path: Path, limit: int = 5) -> dict:
        samples = []
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for _ in range(limit):
                line = handle.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    samples.append(json.loads(line))
                except Exception:
                    samples.append(line)
        fields = []
        if samples and isinstance(samples[0], dict):
            fields = sorted(samples[0].keys())
        return {
            "summary": {"sampleCount": len(samples), "fields": fields},
            "sample": samples,
        }

    def _preview_npz(self, path: Path, limit: int = 3) -> dict:
        try:
            import numpy as np
        except Exception as exc:
            return {"error": f"numpy_missing:{exc}"}
        with np.load(path, allow_pickle=True) as data:
            keys = list(data.keys())
            summary = {
                key: {"shape": list(data[key].shape), "dtype": str(data[key].dtype)}
                for key in keys
            }
            sample = None
            if keys:
                arr = data[keys[0]]
                flat = arr.ravel()
                sample = {keys[0]: flat[:limit].tolist()}
            return {"summary": {"arrays": summary}, "sample": sample}

    def _preview_hdf5(self, path: Path, limit: int = 3) -> dict:
        try:
            import h5py
        except Exception as exc:
            return {"error": f"h5py_missing:{exc}"}
        summary_items = []
        sample = None

        def visit(name, obj):
            if isinstance(obj, h5py.Dataset):
                summary_items.append(
                    {"name": name, "shape": list(obj.shape), "dtype": str(obj.dtype)}
                )

        with h5py.File(path, "r") as handle:
            handle.visititems(visit)
            if summary_items:
                first_name = summary_items[0]["name"]
                data = handle[first_name]
                flat = data[...].ravel()
                sample = {first_name: flat[:limit].tolist()}

        return {"summary": {"datasets": summary_items}, "sample": sample}

    def _preview_pickle(self, path: Path, limit: int = 3) -> dict:
        import pickle
        try:
            import numpy as np
        except Exception:
            np = None
        with path.open("rb") as handle:
            obj = pickle.load(handle)
        summary = {}
        sample = None
        if isinstance(obj, dict):
            for key, value in obj.items():
                if np is not None and hasattr(value, "shape"):
                    summary[key] = {"shape": list(value.shape), "dtype": str(value.dtype)}
                else:
                    summary[key] = {"type": type(value).__name__}
            if summary:
                first_key = next(iter(summary.keys()))
                value = obj[first_key]
                if np is not None and hasattr(value, "ravel"):
                    sample = {first_key: value.ravel()[:limit].tolist()}
                else:
                    sample = {first_key: value}
        else:
            summary["type"] = type(obj).__name__
            sample = obj
        return {"summary": summary, "sample": sample}

    def build_preview(self, dataset: models.Dataset) -> dict:
        local_path = self._resolve_local_path(dataset)
        if not local_path or not local_path.exists():
            return {
                "id": dataset.id,
                "available": False,
                "format": dataset.format,
                "size_bytes": dataset.size_bytes,
                "error": "dataset_path_unavailable",
            }

        result = {
            "id": dataset.id,
            "available": True,
            "format": dataset.format,
            "size_bytes": int(dataset.size_bytes or local_path.stat().st_size),
        }

        try:
            result["sha256"] = self._sha256_for_path(local_path)
        except Exception as exc:
            result["sha256"] = None
            result["error"] = f"sha256_failed:{exc}"

        fmt = (dataset.format or "").lower()
        preview = {}
        try:
            if fmt in ("jsonl", "json"):
                preview = self._preview_jsonl(local_path)
            elif fmt in ("npz", "npy"):
                preview = self._preview_npz(local_path)
            elif fmt in ("hdf5", "h5", "d4rl"):
                preview = self._preview_hdf5(local_path)
            elif fmt in ("pkl", "pickle"):
                preview = self._preview_pickle(local_path)
        except Exception as exc:
            preview = {"error": f"preview_failed:{exc}"}

        if "summary" in preview:
            result["summary"] = preview.get("summary")
        if "sample" in preview:
            result["sample"] = preview.get("sample")
        if "error" in preview:
            result["error"] = preview.get("error")

        return result

dataset_service = DatasetService()
