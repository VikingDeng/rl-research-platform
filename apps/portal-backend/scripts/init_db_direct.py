import sys
import os
import logging

# Ensure the app is in python path
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, BASE_DIR)

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
    # We need to find alembic.ini
    alembic_ini_path = os.path.join(BASE_DIR, "alembic.ini")
    alembic_cfg = Config(alembic_ini_path)
    
    # We assume we are at the initial state, so we mark it as having the initial revision if exists, 
    # or just make sure it doesn't complain later. 
    # Actually, for SQLite user-mode, just creating tables is enough to run.
    # Stamping is good practice but optional if we don't plan to migrate complexly later.
    try:
        command.stamp(alembic_cfg, "head")
        logger.info("Alembic stamped to head.")
    except Exception as e:
        logger.warning(f"Could not stamp alembic head (non-critical): {e}")

if __name__ == "__main__":
    init_db()
