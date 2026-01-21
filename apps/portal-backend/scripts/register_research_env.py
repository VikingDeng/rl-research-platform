import sys
from pathlib import Path

# Add app to path
sys.path.append(str(Path(__file__).parents[2]))

from app.db.session import SessionLocal
from app.db import models
from app.db.types import RobustArray

def register_research_env():
    db = SessionLocal()
    try:
        env_id = "MPE-Signal"
        version = "1.0.0"
        
        print(f"🔬 Registering Research Environment: {env_id}...")

        # 1. EnvSpec
        env_spec = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_id).first()
        if not env_spec:
            env_spec = models.EnvSpec(id=env_id, versions=[version], maps=["default"])
            db.add(env_spec)
        
        # 2. EnvVersion
        # We use 'map_sets' to pre-define the 'b' values for easy selection in UI
        map_sets = [
            {"id": "b=0 (Baseline)", "maps": ["b0"]},
            {"id": "b=1 (2 signals)", "maps": ["b1"]},
            {"id": "b=2 (4 signals)", "maps": ["b2"]},
            {"id": "b=3 (8 signals)", "maps": ["b3"]},
            {"id": "b=4 (16 signals)", "maps": ["b4"]},
        ]
        
        # The schema tells the UI what parameters are tunable
        scenario_schema = {
            "description": "MPE Simple Spread with Common Signal z_t.",
            "parameters": {
                "signal_bits": {
                    "type": "int",
                    "default": 0,
                    "description": "Bits of common signal (b). If 0, standard env."
                }
            }
        }

        ver = db.query(models.EnvVersion).filter(models.EnvVersion.env_id == env_id, models.EnvVersion.version == version).first()
        if not ver:
            ver = models.EnvVersion(
                env_id=env_id,
                version=version,
                api_mode="pettingzoo", # It is a PZ env
                entrypoint="runner.custom_envs.mpe_signal:make_env",
                package=None, # Local code
                map_sets=map_sets,
                scenario_schema=scenario_schema,
                active=True
            )
            db.add(ver)
        else:
            ver.map_sets = map_sets
            ver.scenario_schema = scenario_schema
            ver.entrypoint = "runner.custom_envs.mpe_signal:make_env"
        
        db.commit()
        print("✅ MPE-Signal registered successfully.")
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    register_research_env()
