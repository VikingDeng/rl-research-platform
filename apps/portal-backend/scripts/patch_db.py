from sqlalchemy import text
from app.db.session import engine

def patch_db():
    with engine.connect() as conn:
        print("Patching DB Schema...")
        
        # 1. Projects: git_repo, git_branch
        try:
            conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_repo VARCHAR"))
            conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_branch VARCHAR DEFAULT 'main'"))
            print("- Patched projects table")
        except Exception as e:
            print(f"Error patching projects: {e}")

        # 2. Runs: git_branch, git_commit, group_id
        try:
            conn.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS git_branch VARCHAR"))
            conn.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS git_commit VARCHAR"))
            conn.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS group_id VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_runs_group_id ON runs (group_id)"))
            print("- Patched runs table")
        except Exception as e:
            print(f"Error patching runs: {e}")
            
        conn.commit()
        print("Done.")

if __name__ == "__main__":
    patch_db()
