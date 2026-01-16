from sqlalchemy import text
from app.db.session import engine

def patch_db_v2():
    with engine.connect() as conn:
        print("Patching DB Schema V2 (Priority & Datasets)...")
        
        # 1. Jobs: priority
        try:
            conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 2"))
            print("- Patched jobs table")
        except Exception as e:
            print(f"Error patching jobs: {e}")

        # 2. Datasets Table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS datasets (
                    id VARCHAR PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    description TEXT,
                    path VARCHAR NOT NULL,
                    format VARCHAR NOT NULL,
                    size_bytes INTEGER DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """))
            print("- Created datasets table")
        except Exception as e:
            print(f"Error creating datasets table: {e}")
            
        conn.commit()
        print("Done.")

if __name__ == "__main__":
    patch_db_v2()
