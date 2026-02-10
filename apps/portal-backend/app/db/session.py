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


# 优先使用环境变量 DATABASE_URL，如果没有则使用 settings 中的值
# 注意：环境变量应该在 entrypoint.sh 中设置，确保在模块导入前就可用
final_database_url = os.getenv("DATABASE_URL")
if not final_database_url:
    # 如果环境变量未设置，使用 settings（pydantic_settings 会自动从环境变量读取）
    final_database_url = settings.database_url
    print(f"[DB] DATABASE_URL env var not set, using settings.database_url: {final_database_url}", file=sys.stderr)
else:
    print(f"[DB] Using DATABASE_URL from environment: {final_database_url}", file=sys.stderr)

database_url = _resolve_database_url(final_database_url)
print(f"[DB] Resolved database URL: {database_url}", file=sys.stderr)

# 对于 SQLite，验证数据库文件路径
if database_url.startswith("sqlite"):
    db_path = database_url.replace("sqlite:///", "")
    if os.path.exists(db_path):
        print(f"[DB] Database file exists: {db_path}", file=sys.stderr)
    else:
        print(f"[DB] WARNING: Database file does not exist: {db_path}", file=sys.stderr)
        print(f"[DB] It will be created on first use.", file=sys.stderr)

engine = _build_engine(database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
