import sys
import os
import logging

# Ensure the app is in python path
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, BASE_DIR)

from pathlib import Path
from app.db.base import Base
from app.db.session import engine
from app.db import models  # Must import models to register them with Base
from alembic.config import Config
from alembic import command

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def init_db():
    logger.info("Creating tables directly from models...")
    # 1. Create all tables directly (Bypasses migration detection issues)
    Base.metadata.create_all(bind=engine)
    logger.info("Tables created successfully.")

    # 2. Stamp the database as 'head' so Alembic knows it's up to date
    # Adjust path: scripts/init_db_direct.py -> portal-backend/alembic.ini
    current_dir = Path(__file__).resolve().parent
    alembic_ini_path = current_dir.parent / "alembic.ini"
    
    if alembic_ini_path.exists():
        alembic_cfg = Config(str(alembic_ini_path))
        try:
            command.stamp(alembic_cfg, "head")
            logger.info("Alembic stamped to head.")
        except Exception as e:
            logger.warning(f"Could not stamp alembic head (non-critical): {e}")
    else:
        logger.warning(f"alembic.ini not found at {alembic_ini_path}, skipping stamp.")

if __name__ == "__main__":
    init_db()
