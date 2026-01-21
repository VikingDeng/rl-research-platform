import sys
import os
from pathlib import Path

# Add app to path
sys.path.append(str(Path(__file__).parents[2]))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.db import models
from app.core.config import settings

def seed_env(db: Session, env_id: str, version: str, entrypoint: str, pkg: str, api_mode: str, map_sets: list, desc: str, tags: list = []):
    print(f"🔹 Seeding [{env_id}] v{version}...")
    
    # 1. Create/Get EnvSpec
    env_spec = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_id).first()
    all_maps = []
    for ms in map_sets:
        all_maps.extend(ms["maps"])
    all_maps = sorted(list(set(all_maps)))

    if not env_spec:
        env_spec = models.EnvSpec(id=env_id, versions=[version], maps=all_maps)
        db.add(env_spec)
    else:
        if version not in env_spec.versions:
            env_spec.versions = list(set(env_spec.versions + [version]))
        env_spec.maps = sorted(list(set(env_spec.maps + all_maps)))
    
    # 2. Create/Get EnvVersion
    env_ver = db.query(models.EnvVersion).filter(
        models.EnvVersion.env_id == env_id, 
        models.EnvVersion.version == version
    ).first()

    # Construct rich metadata
    scenario_schema = {
        "description": desc,
        "tags": tags,
        "is_simulated": "Isaac" in env_id or "MuJoCo" in env_id,
        "requires_gpu": "Isaac" in env_id
    }

    if not env_ver:
        env_ver = models.EnvVersion(
            env_id=env_id,
            version=version,
            api_mode=api_mode,
            entrypoint=entrypoint,
            package=pkg,
            active=True,
            frozen=True, # System environments are locked
            map_sets=map_sets,
            scenario_schema=scenario_schema
        )
        db.add(env_ver)
    else:
        # Update existing system envs to ensure latest metadata
        env_ver.map_sets = map_sets
        env_ver.scenario_schema = scenario_schema
        env_ver.package = pkg
        env_ver.entrypoint = entrypoint
        print(f"  - Updated existing definition")

    db.commit()

def main():
    db = SessionLocal()
    try:
        print("🌍 Starting Comprehensive Environment Seeding...\n")

        # ==========================================
        # 1. Robotics & Physics (Isaac Lab / Orbit)
        # ==========================================
        seed_env(
            db,
            env_id="Isaac-Locomotion",
            version="1.0.0",
            entrypoint="omni.isaac.lab_tasks:ManagerBasedRLEnv",
            pkg="isaac-lab",
            api_mode="gym",
            map_sets=[
                {"id": "classic", "maps": ["Isaac-Ant-v0", "Isaac-Humanoid-v0", "Isaac-Anymal-C-v0"]},
                {"id": "manipulation", "maps": ["Isaac-Lift-Cube-Franka-v0", "Isaac-Reach-Franka-v0"]}
            ],
            desc="High-performance GPU-based robotics simulation using NVIDIA Isaac Lab (formerly Orbit). Requires Isaac Sim runtime.",
            tags=["Robotics", "Sim-to-Real", "GPU"]
        )

        seed_env(
            db,
            env_id="MaMuJoCo",
            version="1.2.0",
            entrypoint="multiagent_mujoco:MaMuJoCoEnv",
            pkg="multiagent_mujoco",
            api_mode="gym",
            map_sets=[
                {"id": "2-agents", "maps": ["2AgentAnt", "2AgentHalfCheetah", "2AgentWalker", "2AgentSwimmer"]},
                {"id": "many-agents", "maps": ["4AgentAnt", "6AgentHalfCheetah", "3AgentHopper"]}
            ],
            desc="Multi-Agent MuJoCo. Decomposes single-agent continuous control tasks into multi-agent coordination problems.",
            tags=["Continuous Control", "Cooperative"]
        )

        # ==========================================
        # 2. Strategy & RTS (SMAC / GRF)
        # ==========================================
        seed_env(
            db,
            env_id="SMACv2",
            version="2.0.0",
            entrypoint="smacv2.env:StarCraft2Env",
            pkg="smacv2",
            api_mode="custom",
            map_sets=[
                {"id": "terran", "maps": ["10m_vs_11m", "27m_vs_30m", "MMM", "MMM2", "marine_micro"]},
                {"id": "protoss", "maps": ["3s5z", "3s5z_vs_3s6z", "8m", "25m", "corridor"]},
                {"id": "zerg", "maps": ["bane_vs_bane", "2c_vs_64zg"]}
            ],
            desc="StarCraft II Multi-Agent Challenge v2. The gold standard for cooperative MARL benchmarking. Requires SC2 binaries.",
            tags=["RTS", "Cooperative", "Discrete"]
        )

        seed_env(
            db,
            env_id="GoogleFootball",
            version="1.0.0",
            entrypoint="gfootball.env:create_environment",
            pkg="gfootball",
            api_mode="gym",
            map_sets=[
                {"id": "academy", "maps": ["academy_empty_goal_close", "academy_run_to_score", "academy_3_vs_1_with_keeper"]},
                {"id": "standard", "maps": ["11_vs_11_stochastic", "11_vs_11_easy_stochastic", "11_vs_11_hard_stochastic"]}
            ],
            desc="Google Research Football. A realistic 3D soccer simulation engine for RL.",
            tags=["Sports", "Cooperative", "Competitive"]
        )

        # ==========================================
        # 3. Particle & Grid Worlds (PettingZoo)
        # ==========================================
        seed_env(
            db,
            env_id="MPE",
            version="1.0.0",
            entrypoint="pettingzoo.mpe:simple_spread_v3",
            pkg="pettingzoo[mpe]",
            api_mode="pettingzoo",
            map_sets=[
                {"id": "cooperative", "maps": ["simple_spread_v3", "simple_reference_v3", "simple_speaker_listener_v4"]},
                {"id": "competitive", "maps": ["simple_adversary_v3", "simple_tag_v3", "simple_push_v3", "simple_world_comm_v3"]}
            ],
            desc="Multi-Agent Particle Environments. Simple, fast, and essential for validating coordination algorithms.",
            tags=["Classic", "2D"]
        )

        seed_env(
            db,
            env_id="PettingZoo-Butterfly",
            version="1.0.0",
            entrypoint="pettingzoo.butterfly:pistonball_v6",
            pkg="pettingzoo[butterfly]",
            api_mode="pettingzoo",
            map_sets=[
                {"id": "games", "maps": ["pistonball_v6", "knights_archers_zombies_v10", "cooperative_pong_v5"]}
            ],
            desc="Visually complex multi-agent environments requiring pixel-based learning.",
            tags=["Visual", "2D"]
        )

        seed_env(
            db,
            env_id="PettingZoo-SISL",
            version="1.0.0",
            entrypoint="pettingzoo.sisl:pursuit_v4",
            pkg="pettingzoo[sisl]",
            api_mode="pettingzoo",
            map_sets=[
                {"id": "classic", "maps": ["pursuit_v4", "waterworld_v4", "multiwalker_v9"]}
            ],
            desc="Standard benchmarks for cooperative multi-agent control.",
            tags=["Classic", "2D"]
        )

        # ==========================================
        # 4. Autonomous Driving (MetaDrive)
        # ==========================================
        seed_env(
            db,
            env_id="MetaDrive",
            version="0.4.0",
            entrypoint="metadrive.envs:MultiAgentMetaDrive",
            pkg="metadrive-simulator",
            api_mode="gym",
            map_sets=[
                {"id": "scenarios", "maps": ["MultiAgentIntersection", "MultiAgentTollgate", "MultiAgentRoundabout", "MultiAgentParkingLot"]}
            ],
            desc="Compositional Multi-Agent Driving Simulation.",
            tags=["Driving", "Safety", "Continuous"]
        )

        # ==========================================
        # 5. Single Agent Baselines (Gymnasium)
        # ==========================================
        seed_env(
            db,
            env_id="Gym-Classic",
            version="1.0.0",
            entrypoint="gymnasium:make",
            pkg="gymnasium",
            api_mode="gym",
            map_sets=[
                {"id": "control", "maps": ["CartPole-v1", "Pendulum-v1", "MountainCar-v0", "Acrobot-v1"]},
                {"id": "box2d", "maps": ["BipedalWalker-v3", "LunarLander-v2"]}
            ],
            desc="Standard Single-Agent baselines for sanity checking algorithms.",
            tags=["Baseline", "Single-Agent"]
        )

        seed_env(
            db,
            env_id="Gym-Atari",
            version="1.0.0",
            entrypoint="gymnasium:make",
            pkg="gymnasium[atari]",
            api_mode="gym",
            map_sets=[
                {"id": "standard", "maps": ["PongNoFrameskip-v4", "BreakoutNoFrameskip-v4", "SpaceInvadersNoFrameskip-v4", "QbertNoFrameskip-v4"]}
            ],
            desc="Atari 2600 games. High-dimensional visual input benchmarks.",
            tags=["Visual", "Single-Agent", "Retro"]
        )

        print("\n✅ Seeding complete. The following categories are now available:")
        print("   - Robotics (Isaac Lab, MaMuJoCo)")
        print("   - Strategy (SMACv2, Google Football)")
        print("   - Particle/Grid (MPE, PettingZoo)")
        print("   - Driving (MetaDrive)")
        print("   - Baselines (Classic Control, Atari)")
    
    except Exception as e:
        print(f"❌ Error seeding envs: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()