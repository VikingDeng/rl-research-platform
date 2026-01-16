import importlib
import os
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Optional

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer
from testcontainers.minio import MinioContainer

BACKEND_ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(BACKEND_ROOT))


def _docker_available() -> bool:
    try:
        import docker

        client = docker.from_env()
        client.ping()
        return True
    except Exception:
        return False


def _check_postgres(database_url: str) -> bool:
    try:
        import psycopg2

        dsn = database_url.replace("postgresql+psycopg2://", "postgresql://")
        conn = psycopg2.connect(dsn)
        conn.close()
        return True
    except Exception:
        return False


def _check_minio(endpoint_url: str) -> bool:
    try:
        url = endpoint_url.rstrip("/") + "/minio/health/live"
        with urllib.request.urlopen(url, timeout=1) as resp:
            return resp.status < 500
    except Exception:
        return False


@pytest.fixture(scope="session")
def containers():
    use_flag = os.environ.get("USE_TESTCONTAINERS", "auto").lower()
    use_testcontainers = _docker_available()
    if use_flag == "true":
        use_testcontainers = True
    if use_flag == "false":
        use_testcontainers = False

    run_root = Path(tempfile.mkdtemp(prefix="rl_runs_"))
    os.environ["LOCAL_RUN_ROOT"] = str(run_root)

    if use_testcontainers:
        postgres = PostgresContainer("postgres:16")
        postgres.with_env("POSTGRES_USER", "rl")
        postgres.with_env("POSTGRES_PASSWORD", "rl")
        postgres.with_env("POSTGRES_DB", "rl_platform")

        minio = MinioContainer(image="minio/minio:RELEASE.2024-12-18T00-00-00Z")
        minio.with_env("MINIO_ROOT_USER", "minioadmin")
        minio.with_env("MINIO_ROOT_PASSWORD", "minioadmin")

        postgres.start()
        minio.start()

        os.environ["DATABASE_URL"] = postgres.get_connection_url().replace("postgresql://", "postgresql+psycopg2://")
        os.environ["S3_ENDPOINT_URL"] = minio.get_url()
        os.environ["S3_ACCESS_KEY"] = "minioadmin"
        os.environ["S3_SECRET_KEY"] = "minioadmin"
        os.environ["S3_BUCKET"] = "rl-artifacts"
        os.environ["ALLOW_ANON"] = "true"

        yield

        shutil.rmtree(run_root, ignore_errors=True)
        minio.stop()
        postgres.stop()
        return

    os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://rl:rl@localhost:5432/rl_platform")
    os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost:9000")
    os.environ.setdefault("S3_ACCESS_KEY", "minioadmin")
    os.environ.setdefault("S3_SECRET_KEY", "minioadmin")
    os.environ.setdefault("S3_BUCKET", "rl-artifacts")
    os.environ.setdefault("ALLOW_ANON", "true")

    if not _check_postgres(os.environ["DATABASE_URL"]):
        shutil.rmtree(run_root, ignore_errors=True)
        pytest.skip("Postgres not reachable and Docker unavailable. Start local services or enable Docker.")

    if not _check_minio(os.environ["S3_ENDPOINT_URL"]):
        shutil.rmtree(run_root, ignore_errors=True)
        pytest.skip("MinIO not reachable and Docker unavailable. Start local services or enable Docker.")

    yield

    shutil.rmtree(run_root, ignore_errors=True)


@pytest.fixture(scope="session")
def app(containers):
    import app.core.config as config
    importlib.reload(config)

    import app.db.session as session
    importlib.reload(session)

    import app.services.s3 as s3
    importlib.reload(s3)

    import app.services.artifacts as artifacts
    importlib.reload(artifacts)

    import app.services.repro_bundle as repro
    importlib.reload(repro)

    import app.api.routes as routes
    importlib.reload(routes)

    import app.main as main
    importlib.reload(main)

    alembic_cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")

    return main.app


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def db_session():
    import app.db.session as session

    db = session.SessionLocal()
    try:
        yield db
    finally:
        db.close()
