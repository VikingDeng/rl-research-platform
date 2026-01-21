import sys
from pathlib import Path

# Add app to path
sys.path.append(str(Path(__file__).parents[2]))

from sqlalchemy.orm import Session
from sqlalchemy import text
from app.db.session import SessionLocal
from app.db import models

def cleanup_all():
    db = SessionLocal()
    try:
        print("🧹 Starting Full System Cleanup...")
        
        # 1. Delete all Jobs
        print("  - Deleting Jobs...")
        db.query(models.Job).delete()
        
        # 2. Delete all Checkpoints
        print("  - Deleting Checkpoints...")
        db.query(models.Checkpoint).delete()
        
        # 3. Delete all Artifacts
        print("  - Deleting Artifacts...")
        db.query(models.Artifact).delete()
        
        # 4. Delete all Eval/Matrix Results
        print("  - Deleting Results...")
        db.query(models.EvalResult).delete()
        db.query(models.MatrixResult).delete()
        
        # 5. Delete all Runs
        print("  - Deleting Runs...")
        db.query(models.Run).delete()
        
        # 6. Delete all Templates
        print("  - Deleting Templates...")
        db.query(models.TemplateVersion).delete()
        db.query(models.Template).delete()
        
        # 7. Delete all User Algorithms (Keep none?)
        # Let's keep algorithms if they are marked system? No such mark.
        # Just delete all for a clean slate as requested.
        print("  - Deleting Algorithms...")
        db.query(models.AlgoVersion).delete()
        db.query(models.Algo).delete()
        
        # 8. Delete all Datasets
        print("  - Deleting Datasets...")
        db.query(models.Dataset).delete()
        
        # 9. Delete all Projects EXCEPT 'system'
        print("  - Deleting User Projects...")
        db.query(models.Project).filter(models.Project.id != 'system').delete()
        
        # 10. Delete Opponent Pools
        print("  - Deleting Opponent Pools...")
        db.query(models.OpponentPoolMember).delete()
        db.query(models.OpponentPoolVersion).delete()
        db.query(models.OpponentPool).delete()

        # 11. Delete all Eval Protocols
        print("  - Deleting Eval Protocols...")
        db.query(models.EvalProtocol).delete()

        db.commit()
        print("✨ Cleanup Complete. Database is fresh (Envs preserved).")
        
    except Exception as e:
        print(f"❌ Cleanup Failed: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    cleanup_all()
