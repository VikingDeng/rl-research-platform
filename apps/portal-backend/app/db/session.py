import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


def _default_sqlite_url() -> str:
    backend_root = Path(__file__).resolve().parents[2]
    sqlite_path = backend_root / "rl_platform.db"
    return f"sqlite:///{sqlite_path}"


def _build_engine(url: str):
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, pool_pre_ping=True, connect_args=connect_args)


def _resolve_database_url(configured_url: str) -> str:
    url = configured_url
    fallback_url = os.getenv("DATABASE_FALLBACK_URL", _default_sqlite_url())
    strict_mode = os.getenv("DATABASE_STRICT", "0") == "1"

    if url.startswith("postgresql"):
        try:
            import psycopg2  # noqa: F401
        except Exception as exc:
            if strict_mode:
                raise
            print(
                f"[DB] PostgreSQL driver unavailable ({type(exc).__name__}: {exc}). "
                f"Falling back to {fallback_url}.",
                file=sys.stderr,
            )
            return fallback_url

        if not strict_mode:
            probe_engine = _build_engine(url)
            try:
                with probe_engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
            except Exception as exc:
                print(
                    f"[DB] PostgreSQL unavailable ({type(exc).__name__}: {exc}). "
                    f"Falling back to {fallback_url}.",
                    file=sys.stderr,
                )
                url = fallback_url
            finally:
                probe_engine.dispose()

    return url


database_url = _resolve_database_url(settings.database_url)
engine = _build_engine(database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
