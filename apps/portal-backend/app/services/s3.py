import os
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

import boto3
from botocore.exceptions import EndpointConnectionError, ClientError

from app.core.config import settings


class S3Client:
    def __init__(self) -> None:
        self.mode = "s3"
        self._bucket = settings.s3_bucket
        
        # Check if we should force local mode or try S3
        # For simplicity, we try to connect. If it fails, we fallback.
        try:
            self._client = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint_url,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
                verify=False # Often needed for local minio/testing
            )
            # Quick health check
            self._client.list_buckets()
        except (EndpointConnectionError, ValueError, ClientError) as e:
            print(f"[Storage] S3 connection failed ({e}). Falling back to Local Filesystem.")
            self.mode = "local"
            self.local_root = Path(settings.local_run_root).parent / "artifacts"
            self.local_root.mkdir(parents=True, exist_ok=True)
            self._client = None

    @property
    def bucket(self) -> str:
        return self._bucket

    def ensure_bucket(self) -> None:
        if self.mode == "local":
            (self.local_root / self._bucket).mkdir(parents=True, exist_ok=True)
            return

        try:
            buckets = self._client.list_buckets().get("Buckets", [])
            if not any(b["Name"] == self._bucket for b in buckets):
                self._client.create_bucket(Bucket=self._bucket)
        except Exception:
            pass

    def object_exists(self, key: str) -> bool:
        if self.mode == "local":
            return (self.local_root / self._bucket / key).exists()
        
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except Exception:
            return False

    def put_text(self, key: str, body: str, content_type: str) -> None:
        if self.mode == "local":
            path = self.local_root / self._bucket / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
            return

        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=body.encode("utf-8"),
            ContentType=content_type,
        )

    def put_object(self, key: str, body: bytes, content_type: str) -> None:
        if self.mode == "local":
            path = self.local_root / self._bucket / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            return

        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
        )

    def presigned_get_url(self, key: str, expires_in: int = 3600) -> str:
        if self.mode == "local":
            # Return a URL that the backend serves via StaticFiles
            # We need to ensure the backend mounts this.
            # Assuming mount is at /artifacts
            # Clean key to avoid double slashes?
            clean_key = key.lstrip("/")
            # We assume api base url logic handles the host, or we return relative?
            # If backend is at /api/v1, static is at /artifacts (root level mount).
            # The frontend calls this, so it needs a full URL or absolute path.
            # Let's return a relative path from root.
            return f"/artifacts/{self._bucket}/{clean_key}"

        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def get_object_bytes(self, key: str) -> bytes:
        if self.mode == "local":
            path = self.local_root / self._bucket / key
            if not path.exists():
                raise FileNotFoundError(f"Artifact {key} not found")
            return path.read_bytes()

        response = self._client.get_object(Bucket=self._bucket, Key=key)
        return response["Body"].read()

    def delete_object(self, key: str) -> None:
        if self.mode == "local":
            path = self.local_root / self._bucket / key
            if path.exists():
                path.unlink()
            return

        self._client.delete_object(Bucket=self._bucket, Key=key)

    def download_file(self, bucket: str, key: str, dest: str) -> None:
        if self.mode == "local":
            # If bucket arg is different from self._bucket, we support it?
            # Assuming 'bucket' param matches our structure
            src = self.local_root / bucket / key
            if not src.exists():
                 raise FileNotFoundError(f"Artifact {bucket}/{key} not found")
            shutil.copy(src, dest)
            return

        self._client.download_file(bucket, key, dest)

    def upload_file(self, src: str, key: str) -> None:
        if self.mode == "local":
            dest = self.local_root / self._bucket / key
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(src, dest)
            return

        self._client.upload_file(src, self._bucket, key)


s3_client = S3Client()
