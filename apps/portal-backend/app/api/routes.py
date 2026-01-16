import asyncio
import importlib
import io
import json
import uuid
import zipfile
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db import models
from app.db.session import SessionLocal
from app.schemas.auth import LoginRequest, LoginResponse, User
from app.schemas.projects import Project, ProjectCreate, ProjectUpdate
from app.schemas.envs import (
    EnvSpec,
    EnvSpecUpdate,
    EnvVersion,
    EnvVersionCreate,
    EnvVersionUpdate,
    EnvVersionUpsert,
    EnvMapSet,
)
from app.schemas.templates import (
    Algo,
    AlgoUpdate,
    AlgoVersion,
    AlgoVersionCreate,
    AlgoVersionUpdate,
    Template,
    TemplateCreate,
    TemplateDetail,
    TemplateUpdate,
    TemplateVersion,
    TemplateVersionCreate,
)
from app.schemas.plugins import Plugin, PluginUpdate, PluginVersion, PluginVersionCreate
from app.schemas.runs import (
    Run,
    Checkpoint,
    CheckpointTagRequest,
    Job,
    JobControlRequest,
    TrainJobRequest,
    TrainJobResponse,
    RunMetricsResponse,
    LogPage,
)
from app.schemas.eval import (
    EnvRef,
    EvalProtocol,
    EvalProtocolCreate,
    EvalProtocolSummary,
    EvalProtocolVersionCreate,
    OpponentPool,
    OpponentPoolCreate,
    OpponentPoolMembersUpdate,
    OpponentPoolSummary,
    OpponentPoolVersionCreate,
    EvalJobRequest,
    EvalJobResponse,
    MatrixJobRequest,
    MatrixJobResponse,
    EvalResult,
    MatrixResult,
)
from app.core.config import settings
from app.schemas.artifacts import ArtifactFile, ArtifactDownloadResponse, ReproBundleResponse
from app.schemas.settings import (
    ExecutorSettings,
    SettingsResponse,
    SettingsUpdate,
    StorageUsage,
    RetentionPolicy,
    TokenRotateResponse,
    RetentionApplyResponse,
)
from app.schemas.webhooks import Webhook, WebhookCreate
from app.schemas.datasets import Dataset, DatasetCreate
from app.services.artifacts import artifact_service
from app.services.job_manager import job_manager
from app.services.metrics import metrics_service
from app.services.paths import metrics_path
from app.services.repro_bundle import repro_bundle_service
from app.services.retention import apply_checkpoint_policy
from app.services.schema_validation import validate_env_constraints, validate_json_schema
from app.services.s3 import s3_client
from app.services.datasets import dataset_service

router = APIRouter()


def _next_version(existing: List[str]) -> str:
    if not existing:
        return "1.0.0"
    return f"{len(existing) + 1}.0.0"


def _algo_version_response(model: models.AlgoVersion) -> AlgoVersion:
    return AlgoVersion.model_validate(
        {
            "id": model.id,
            "algo_id": model.algo_id,
            "version": model.version,
            "entrypoint": model.entrypoint,
            "package": model.package,
            "artifact_uri": model.artifact_uri,
            "config_schema": model.config_schema,
            "default_config": model.default_config,
            "resource_profile": model.resource_profile,
            "env_constraints": model.env_constraints,
            "metadata_": model.metadata_,
            "active": model.active,
            "frozen": model.frozen,
            "created_at": model.created_at,
        }
    )


def get_or_create_system_project(db: Session) -> models.Project:
    project = db.query(models.Project).filter(models.Project.id == "system").first()
    if project:
        return project
    project = models.Project(id="system", name="System", description="System generated runs", tags=["system"])
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def _generate_api_token() -> str:
    return f"sk-{uuid.uuid4().hex}"


def _ensure_setting(db: Session, key: str, default_value: dict) -> models.SystemSetting:
    setting = db.query(models.SystemSetting).filter(models.SystemSetting.key == key).first()
    if setting:
        return setting
    setting = models.SystemSetting(key=key, value=default_value)
    db.add(setting)
    db.commit()
    db.refresh(setting)
    return setting


def _get_api_token(db: Session) -> str:
    setting = _ensure_setting(db, "api_token", {"token": _generate_api_token()})
    token = setting.value.get("token") if isinstance(setting.value, dict) else None
    if not token:
        token = _generate_api_token()
        setting.value = {"token": token}
        db.commit()
    return token


def _build_settings_response(db: Session) -> SettingsResponse:
    token = _get_api_token(db)
    retention_setting = _ensure_setting(db, "retention", {"checkpointPolicy": "best_latest_5"})
    checkpoint_policy = (
        retention_setting.value.get("checkpointPolicy")
        if isinstance(retention_setting.value, dict)
        else "best_latest_5"
    )
    artifacts = db.query(models.Artifact).all()
    artifact_bytes = 0
    for artifact in artifacts:
        try:
            artifact_bytes += int(artifact.size)
        except (TypeError, ValueError):
            continue

    db_bytes = None
    try:
        db_bytes = db.execute(text("select pg_database_size(current_database())")).scalar()
    except Exception:
        db_bytes = None

    executor_mode = settings.executor_mode.lower()
    determined_url = settings.determined_master_url if executor_mode == "determined" else None
    determined_connected = False
    executor = ExecutorSettings(
        mode=executor_mode,
        local_gpu_count=settings.local_executor_gpu_count,
        determined_master_url=determined_url,
        determined_connected=determined_connected,
        scheduler="local" if executor_mode == "local" else "determined",
    )
    storage = StorageUsage(artifact_bytes=artifact_bytes, db_bytes=db_bytes)
    retention = RetentionPolicy(checkpoint_policy=checkpoint_policy or "best_latest_5")
    return SettingsResponse(api_token=token, executor=executor, storage=storage, retention=retention)


@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    return LoginResponse(token="dev-token")


@router.get("/auth/me", response_model=User)
def me() -> User:
    return User(id="user_dev", email="dev@example.com", name="Dev User", roles=["admin"])


@router.get("/settings", response_model=SettingsResponse)
def get_settings(db: Session = Depends(get_db)) -> SettingsResponse:
    return _build_settings_response(db)


@router.patch("/settings", response_model=SettingsResponse)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)) -> SettingsResponse:
    if payload.checkpoint_policy:
        setting = _ensure_setting(db, "retention", {"checkpointPolicy": "best_latest_5"})
        current = setting.value if isinstance(setting.value, dict) else {}
        current["checkpointPolicy"] = payload.checkpoint_policy
        setting.value = current
        db.commit()
    return _build_settings_response(db)


@router.post("/settings/token/rotate", response_model=TokenRotateResponse)
def rotate_token(db: Session = Depends(get_db)) -> TokenRotateResponse:
    token = _generate_api_token()
    setting = _ensure_setting(db, "api_token", {"token": token})
    setting.value = {"token": token}
    db.commit()
    return TokenRotateResponse(api_token=token)


@router.post("/settings/retention/apply", response_model=RetentionApplyResponse)
def apply_retention_policy(db: Session = Depends(get_db)) -> RetentionApplyResponse:
    runs = db.query(models.Run).all()
    checkpoints_removed = 0
    artifacts_removed = 0
    for run in runs:
        before_ckpt = db.query(models.Checkpoint).filter(models.Checkpoint.run_id == run.id).count()
        before_art = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == run.id, models.Artifact.path.like("/checkpoints/%"))
            .count()
        )
        apply_checkpoint_policy(db, run.id)
        db.commit()
        after_ckpt = db.query(models.Checkpoint).filter(models.Checkpoint.run_id == run.id).count()
        after_art = (
            db.query(models.Artifact)
            .filter(models.Artifact.run_id == run.id, models.Artifact.path.like("/checkpoints/%"))
            .count()
        )
        checkpoints_removed += max(0, before_ckpt - after_ckpt)
        artifacts_removed += max(0, before_art - after_art)

    return RetentionApplyResponse(
        runs_processed=len(runs),
        checkpoints_removed=checkpoints_removed,
        artifacts_removed=artifacts_removed,
    )


@router.get("/projects", response_model=List[Project])
def list_projects(db: Session = Depends(get_db)) -> List[Project]:
    projects = db.query(models.Project).all()
    results: List[Project] = []
    for project in projects:
        total_runs = db.query(models.Run).filter(models.Run.project_id == project.id).count()
        active_runs = (
            db.query(models.Run)
            .filter(models.Run.project_id == project.id, models.Run.status.in_(["PENDING", "RUNNING"]))
            .count()
        )
        results.append(
            Project.model_validate(
                {
                    "id": project.id,
                    "name": project.name,
                    "description": project.description,
                    "tags": project.tags,
                    "git_repo": project.git_repo,
                    "git_branch": project.git_branch,
                    "created_at": project.created_at,
                    "updated_at": project.updated_at,
                    "active_runs": active_runs,
                    "total_runs": total_runs,
                }
            )
        )
    return results


@router.post("/projects", response_model=Project, status_code=201)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> Project:
    project = models.Project(
        name=payload.name,
        description=payload.description,
        tags=payload.tags or [],
        git_repo=payload.git_repo,
        git_branch=payload.git_branch,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return Project.model_validate(project)


@router.get("/projects/{project_id}", response_model=Project)
def get_project(project_id: str, db: Session = Depends(get_db)) -> Project:
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    total_runs = db.query(models.Run).filter(models.Run.project_id == project.id).count()
    active_runs = (
        db.query(models.Run)
        .filter(models.Run.project_id == project.id, models.Run.status.in_(["PENDING", "RUNNING"]))
        .count()
    )
    return Project.model_validate(
        {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "tags": project.tags,
            "git_repo": project.git_repo,
            "git_branch": project.git_branch,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
            "active_runs": active_runs,
            "total_runs": total_runs,
        }
    )


@router.patch("/projects/{project_id}", response_model=Project)
def update_project(project_id: str, payload: ProjectUpdate, db: Session = Depends(get_db)) -> Project:
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if payload.name is not None:
        project.name = payload.name
    if payload.description is not None:
        project.description = payload.description
    if payload.tags is not None:
        project.tags = payload.tags
    if payload.git_repo is not None:
        project.git_repo = payload.git_repo
    if payload.git_branch is not None:
        project.git_branch = payload.git_branch
    db.commit()
    db.refresh(project)
    return Project.model_validate(project)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)) -> Response:
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    db.delete(project)
    db.commit()
    return Response(status_code=204)


@router.get("/envs", response_model=List[EnvSpec])
def list_envs(include_archived: bool = False, db: Session = Depends(get_db)) -> List[EnvSpec]:
    query = db.query(models.EnvSpec)
    if not include_archived:
        query = query.filter(models.EnvSpec.archived.is_(False))
    envs = query.all()
    return [EnvSpec.model_validate(env) for env in envs]


@router.get("/envs/{env_id}/versions", response_model=List[EnvVersion])
def list_env_versions(env_id: str, db: Session = Depends(get_db)) -> List[EnvVersion]:
    versions = db.query(models.EnvVersion).filter(models.EnvVersion.env_id == env_id).all()
    return [EnvVersion.model_validate(v) for v in versions]


@router.patch("/admin/envs/{env_id}", response_model=EnvSpec)
def update_env_spec(env_id: str, payload: EnvSpecUpdate, db: Session = Depends(get_db)) -> EnvSpec:
    env = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_id).first()
    if not env:
        raise HTTPException(status_code=404, detail="env_not_found")
    if payload.archived is not None:
        env.archived = payload.archived
    db.commit()
    db.refresh(env)
    return EnvSpec.model_validate(env)


@router.delete("/admin/envs/{env_id}", status_code=204)
def delete_env_spec(env_id: str, db: Session = Depends(get_db)) -> Response:
    env = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_id).first()
    if not env:
        raise HTTPException(status_code=404, detail="env_not_found")
    env.archived = True
    db.commit()
    return Response(status_code=204)


def _validate_entrypoint(entrypoint: str, import_check: bool = False) -> None:
    if not entrypoint or ":" not in entrypoint:
        raise HTTPException(status_code=400, detail="invalid_entrypoint")
    module, target = entrypoint.split(":", 1)
    if not module or not target:
        raise HTTPException(status_code=400, detail="invalid_entrypoint")
    if import_check:
        try:
            mod = importlib.import_module(module)
            handler = getattr(mod, target, None)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"entrypoint_import_failed:{exc}") from exc
        if not callable(handler):
            raise HTTPException(status_code=400, detail="entrypoint_not_callable")


def _collect_maps(map_sets: Optional[List[EnvMapSet]]) -> List[str]:
    if not map_sets:
        return []
    maps: List[str] = []
    for mset in map_sets:
        maps.extend(mset.maps)
    return sorted(set(maps))


def _validate_env_ref(db: Session, env_ref: EnvRef) -> models.EnvVersion:
    env_version = (
        db.query(models.EnvVersion)
        .filter(
            models.EnvVersion.env_id == env_ref.env_id,
            models.EnvVersion.version == env_ref.version,
        )
        .first()
    )
    if not env_version:
        raise HTTPException(status_code=404, detail="env_version_not_found")
    env_spec = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_ref.env_id).first()
    if env_spec and env_spec.archived:
        raise HTTPException(status_code=400, detail="env_archived")
    if env_version.active is False:
        raise HTTPException(status_code=400, detail="env_version_inactive")
    if env_ref.map_set:
        map_sets = env_version.map_sets or []
        map_set_ids = {m.get("id") for m in map_sets if isinstance(m, dict)}
        if map_set_ids and env_ref.map_set not in map_set_ids:
            raise HTTPException(status_code=400, detail="map_set_not_found")
    return env_version


@router.post("/admin/envs", response_model=EnvVersion, status_code=201)
def upsert_env(payload: EnvVersionUpsert, db: Session = Depends(get_db)) -> EnvVersion:
    if not payload.entrypoint:
        raise HTTPException(status_code=400, detail="env_entrypoint_missing")
    _validate_entrypoint(payload.entrypoint, settings.env_entrypoint_validate)
    env = db.query(models.EnvSpec).filter(models.EnvSpec.id == payload.env_id).first()
    maps = _collect_maps(payload.map_sets)
    if not env:
        env = models.EnvSpec(id=payload.env_id, versions=[payload.version], maps=maps)
        db.add(env)
    elif payload.version not in env.versions:
        env.versions = list(set(env.versions + [payload.version]))
    if maps:
        env.maps = sorted(set(env.maps + maps))
    db.commit()

    version = models.EnvVersion(
        env_id=payload.env_id,
        version=payload.version,
        api_mode=payload.api_mode,
        entrypoint=payload.entrypoint,
        package=payload.package,
        active=payload.active if payload.active is not None else True,
        frozen=payload.frozen if payload.frozen is not None else False,
        default_image_digest=payload.default_image_digest,
        map_sets=[m.model_dump(by_alias=True) for m in payload.map_sets] if payload.map_sets else None,
        scenario_schema=payload.scenario_schema,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return EnvVersion.model_validate(version)


@router.post("/admin/envs/{env_id}/versions", response_model=EnvVersion, status_code=201)
def create_env_version(env_id: str, payload: EnvVersionCreate, db: Session = Depends(get_db)) -> EnvVersion:
    _validate_entrypoint(payload.entrypoint, settings.env_entrypoint_validate)
    env = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_id).first()
    if not env:
        raise HTTPException(status_code=404, detail="env_not_found")
    if payload.version not in env.versions:
        env.versions = list(set(env.versions + [payload.version]))
    maps = _collect_maps(payload.map_sets)
    if maps:
        env.maps = sorted(set(env.maps + maps))
    db.commit()

    version = models.EnvVersion(
        env_id=env_id,
        version=payload.version,
        api_mode=payload.api_mode,
        entrypoint=payload.entrypoint,
        package=payload.package,
        active=payload.active if payload.active is not None else True,
        frozen=payload.frozen if payload.frozen is not None else False,
        default_image_digest=payload.default_image_digest,
        map_sets=[m.model_dump(by_alias=True) for m in payload.map_sets] if payload.map_sets else None,
        scenario_schema=payload.scenario_schema,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return EnvVersion.model_validate(version)


@router.patch("/admin/envs/{env_id}/versions/{version}", response_model=EnvVersion)
def update_env_version(
    env_id: str,
    version: str,
    payload: EnvVersionUpdate,
    db: Session = Depends(get_db),
) -> EnvVersion:
    env_version = (
        db.query(models.EnvVersion)
        .filter(models.EnvVersion.env_id == env_id, models.EnvVersion.version == version)
        .order_by(models.EnvVersion.id.desc())
        .first()
    )
    if not env_version:
        raise HTTPException(status_code=404, detail="env_version_not_found")
    if env_version.frozen:
        raise HTTPException(status_code=400, detail="env_version_frozen")

    if payload.entrypoint is not None:
        _validate_entrypoint(payload.entrypoint, settings.env_entrypoint_validate)
        env_version.entrypoint = payload.entrypoint
    if payload.api_mode is not None:
        env_version.api_mode = payload.api_mode
    if payload.package is not None:
        env_version.package = payload.package
    if payload.active is not None:
        env_version.active = payload.active
    if payload.frozen is not None:
        env_version.frozen = payload.frozen
    if payload.default_image_digest is not None:
        env_version.default_image_digest = payload.default_image_digest
    if payload.map_sets is not None:
        env_version.map_sets = [m.model_dump(by_alias=True) for m in payload.map_sets]
        maps = _collect_maps(payload.map_sets)
        if maps:
            env = db.query(models.EnvSpec).filter(models.EnvSpec.id == env_id).first()
            if env:
                env.maps = sorted(set(env.maps + maps))
    if payload.scenario_schema is not None:
        env_version.scenario_schema = payload.scenario_schema

    db.commit()
    db.refresh(env_version)
    return EnvVersion.model_validate(env_version)


@router.post("/admin/envs/{env_id}/versions/{version}/freeze", response_model=EnvVersion)
def freeze_env_version(env_id: str, version: str, db: Session = Depends(get_db)) -> EnvVersion:
    env_version = (
        db.query(models.EnvVersion)
        .filter(models.EnvVersion.env_id == env_id, models.EnvVersion.version == version)
        .order_by(models.EnvVersion.id.desc())
        .first()
    )
    if not env_version:
        raise HTTPException(status_code=404, detail="env_version_not_found")
    env_version.frozen = True
    db.commit()
    db.refresh(env_version)
    return EnvVersion.model_validate(env_version)


@router.get("/algos", response_model=List[Algo])
def list_algos(include_archived: bool = False, db: Session = Depends(get_db)) -> List[Algo]:
    query = db.query(models.Algo)
    if not include_archived:
        query = query.filter(models.Algo.archived.is_(False))
    algos = query.all()
    return [Algo.model_validate(a) for a in algos]


@router.get("/algos/{algo_id}/versions", response_model=List[AlgoVersion])
def list_algo_versions(algo_id: str, db: Session = Depends(get_db)) -> List[AlgoVersion]:
    versions = db.query(models.AlgoVersion).filter(models.AlgoVersion.algo_id == algo_id).all()
    return [_algo_version_response(v) for v in versions]


@router.post("/admin/algos", response_model=Algo, status_code=201)
def upsert_algo(payload: Algo, db: Session = Depends(get_db)) -> Algo:
    algo = db.query(models.Algo).filter(models.Algo.id == payload.id).first()
    if algo:
        algo.name = payload.name
        algo.description = payload.description
    else:
        algo = models.Algo(id=payload.id, name=payload.name, description=payload.description)
        db.add(algo)
    db.commit()
    db.refresh(algo)
    return Algo.model_validate(algo)


@router.patch("/admin/algos/{algo_id}", response_model=Algo)
def update_algo(algo_id: str, payload: AlgoUpdate, db: Session = Depends(get_db)) -> Algo:
    algo = db.query(models.Algo).filter(models.Algo.id == algo_id).first()
    if not algo:
        raise HTTPException(status_code=404, detail="algo_not_found")
    if payload.name is not None:
        algo.name = payload.name
    if payload.description is not None:
        algo.description = payload.description
    if payload.archived is not None:
        algo.archived = payload.archived
    db.commit()
    db.refresh(algo)
    return Algo.model_validate(algo)


@router.delete("/admin/algos/{algo_id}", status_code=204)
def delete_algo(algo_id: str, db: Session = Depends(get_db)) -> Response:
    algo = db.query(models.Algo).filter(models.Algo.id == algo_id).first()
    if not algo:
        raise HTTPException(status_code=404, detail="algo_not_found")
    algo.archived = True
    db.commit()
    return Response(status_code=204)


@router.post("/admin/algos/{algo_id}/versions", response_model=AlgoVersion, status_code=201)
def create_algo_version(algo_id: str, payload: AlgoVersionCreate, db: Session = Depends(get_db)) -> AlgoVersion:
    algo = db.query(models.Algo).filter(models.Algo.id == algo_id).first()
    if not algo:
        raise HTTPException(status_code=404, detail="algo_not_found")
    if not payload.entrypoint:
        raise HTTPException(status_code=400, detail="algo_entrypoint_missing")
    _validate_entrypoint(payload.entrypoint, settings.algo_entrypoint_validate)
    existing = (
        db.query(models.AlgoVersion)
        .filter(models.AlgoVersion.algo_id == algo_id, models.AlgoVersion.version == payload.version)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="algo_version_exists")

    version = models.AlgoVersion(
        algo_id=algo_id,
        version=payload.version,
        entrypoint=payload.entrypoint,
        package=payload.package,
        artifact_uri=payload.artifact_uri,
        config_schema=payload.config_schema,
        default_config=payload.default_config,
        resource_profile=payload.resource_profile,
        env_constraints=payload.env_constraints,
        metadata_=payload.metadata_,
        active=payload.active if payload.active is not None else True,
        frozen=payload.frozen if payload.frozen is not None else False,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return _algo_version_response(version)


@router.patch("/admin/algos/{algo_id}/versions/{version}", response_model=AlgoVersion)
def update_algo_version(
    algo_id: str,
    version: str,
    payload: AlgoVersionUpdate,
    db: Session = Depends(get_db),
) -> AlgoVersion:
    algo_version = (
        db.query(models.AlgoVersion)
        .filter(models.AlgoVersion.algo_id == algo_id, models.AlgoVersion.version == version)
        .order_by(models.AlgoVersion.id.desc())
        .first()
    )
    if not algo_version:
        raise HTTPException(status_code=404, detail="algo_version_not_found")
    if algo_version.frozen:
        raise HTTPException(status_code=400, detail="algo_version_frozen")

    if payload.entrypoint is not None:
        _validate_entrypoint(payload.entrypoint, settings.algo_entrypoint_validate)
        algo_version.entrypoint = payload.entrypoint
    if payload.package is not None:
        algo_version.package = payload.package
    if payload.artifact_uri is not None:
        algo_version.artifact_uri = payload.artifact_uri
    if payload.config_schema is not None:
        algo_version.config_schema = payload.config_schema
    if payload.default_config is not None:
        algo_version.default_config = payload.default_config
    if payload.resource_profile is not None:
        algo_version.resource_profile = payload.resource_profile
    if payload.env_constraints is not None:
        algo_version.env_constraints = payload.env_constraints
    if payload.metadata_ is not None:
        algo_version.metadata_ = payload.metadata_
    if payload.active is not None:
        algo_version.active = payload.active
    if payload.frozen is not None:
        algo_version.frozen = payload.frozen

    db.commit()
    db.refresh(algo_version)
    return _algo_version_response(algo_version)


@router.post("/admin/algos/{algo_id}/versions/{version}/freeze", response_model=AlgoVersion)
def freeze_algo_version(algo_id: str, version: str, db: Session = Depends(get_db)) -> AlgoVersion:
    algo_version = (
        db.query(models.AlgoVersion)
        .filter(models.AlgoVersion.algo_id == algo_id, models.AlgoVersion.version == version)
        .order_by(models.AlgoVersion.id.desc())
        .first()
    )
    if not algo_version:
        raise HTTPException(status_code=404, detail="algo_version_not_found")
    algo_version.frozen = True
    db.commit()
    db.refresh(algo_version)
    return _algo_version_response(algo_version)


@router.get("/templates", response_model=List[Template])
def list_templates(
    project_id: Optional[str] = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
) -> List[Template]:
    query = db.query(models.Template)
    if project_id:
        query = query.filter(models.Template.project_id == project_id)
    if not include_archived:
        query = query.filter(models.Template.archived.is_(False))
    templates = query.all()
    return [Template.model_validate(t) for t in templates]


@router.post("/projects/{project_id}/templates", response_model=Template, status_code=201)
def create_template(project_id: str, payload: TemplateCreate, db: Session = Depends(get_db)) -> Template:
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    template = models.Template(
        project_id=project_id,
        name=payload.name,
        description=payload.description,
        type=payload.type,
        default_config=payload.default_config or {},
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return Template.model_validate(template)


@router.patch("/templates/{template_id}", response_model=Template)
def update_template(template_id: str, payload: TemplateUpdate, db: Session = Depends(get_db)) -> Template:
    template = db.query(models.Template).filter(models.Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="template_not_found")
    if template.archived:
        raise HTTPException(status_code=400, detail="template_archived")
    if payload.name is not None:
        template.name = payload.name
    if payload.description is not None:
        template.description = payload.description
    if payload.default_config is not None:
        template.default_config = payload.default_config
    if payload.archived is not None:
        template.archived = payload.archived
    db.commit()
    db.refresh(template)
    return Template.model_validate(template)


@router.delete("/templates/{template_id}", status_code=204)
def delete_template(template_id: str, db: Session = Depends(get_db)) -> Response:
    template = db.query(models.Template).filter(models.Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="template_not_found")
    template.archived = True
    db.commit()
    return Response(status_code=204)


@router.get("/templates/{template_id}", response_model=TemplateDetail)
def get_template(template_id: str, db: Session = Depends(get_db)) -> TemplateDetail:
    template = db.query(models.Template).filter(models.Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="template_not_found")
    versions = db.query(models.TemplateVersion).filter(models.TemplateVersion.template_id == template_id).all()
    return TemplateDetail.model_validate(
        {
            "id": template.id,
            "project_id": template.project_id,
            "name": template.name,
            "description": template.description,
            "type": template.type,
            "default_config": template.default_config,
            "archived": template.archived,
            "versions": [TemplateVersion.model_validate(v) for v in versions],
        }
    )


@router.post("/templates/{template_id}/versions", response_model=TemplateVersion, status_code=201)
def create_template_version(template_id: str, payload: TemplateVersionCreate, db: Session = Depends(get_db)) -> TemplateVersion:
    template = db.query(models.Template).filter(models.Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="template_not_found")
    algo_version_id = payload.algo_version_id
    algo_version = db.query(models.AlgoVersion).filter(models.AlgoVersion.id == algo_version_id).first()
    if not algo_version:
        raise HTTPException(status_code=404, detail="algo_version_not_found")
    if algo_version.active is False:
        raise HTTPException(status_code=400, detail="algo_version_inactive")
    version = models.TemplateVersion(
        template_id=template_id,
        algo_version_id=algo_version_id,
        version=payload.version,
        default_config=payload.default_config,
        network_template=payload.network_template,
        env_constraints=payload.env_constraints,
        wrappers=payload.wrappers,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return TemplateVersion.model_validate(version)


@router.post("/templates/{template_id}/versions/{version_id}/freeze", response_model=TemplateVersion)
def freeze_template_version(template_id: str, version_id: str, db: Session = Depends(get_db)) -> TemplateVersion:
    version = (
        db.query(models.TemplateVersion)
        .filter(models.TemplateVersion.id == version_id, models.TemplateVersion.template_id == template_id)
        .first()
    )
    if not version:
        raise HTTPException(status_code=404, detail="template_version_not_found")
    version.frozen = True
    db.commit()
    db.refresh(version)
    return TemplateVersion.model_validate(version)


@router.get("/plugins", response_model=List[Plugin])
def list_plugins(include_archived: bool = False, db: Session = Depends(get_db)) -> List[Plugin]:
    query = db.query(models.Plugin)
    if not include_archived:
        query = query.filter(models.Plugin.archived.is_(False))
    plugins = query.all()
    return [Plugin.model_validate(p) for p in plugins]


@router.post("/admin/plugins", response_model=PluginVersion, status_code=201)
def create_plugin_version(payload: PluginVersionCreate, db: Session = Depends(get_db)) -> PluginVersion:
    plugin = db.query(models.Plugin).filter(models.Plugin.id == payload.plugin_id).first()
    if not plugin:
        plugin = models.Plugin(
            id=payload.plugin_id,
            name=payload.plugin_id,
            version=payload.version,
            type="Model",
            installed=True,
        )
        db.add(plugin)
    else:
        plugin.version = payload.version
    version = models.PluginVersion(
        plugin_id=payload.plugin_id,
        version=payload.version,
        wheel_uri=payload.wheel_uri,
        sha256=payload.sha256,
        manifest=payload.manifest,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return PluginVersion.model_validate(version)


@router.patch("/admin/plugins/{plugin_id}", response_model=Plugin)
def update_plugin(plugin_id: str, payload: PluginUpdate, db: Session = Depends(get_db)) -> Plugin:
    plugin = db.query(models.Plugin).filter(models.Plugin.id == plugin_id).first()
    if not plugin:
        raise HTTPException(status_code=404, detail="plugin_not_found")
    if payload.type is not None:
        plugin.type = payload.type
    if payload.name is not None:
        plugin.name = payload.name
    if payload.description is not None:
        plugin.description = payload.description
    if payload.author is not None:
        plugin.author = payload.author
    if payload.installed is not None:
        plugin.installed = payload.installed
    if payload.archived is not None:
        plugin.archived = payload.archived
    db.commit()
    db.refresh(plugin)
    return Plugin.model_validate(plugin)


@router.delete("/admin/plugins/{plugin_id}", status_code=204)
def delete_plugin(plugin_id: str, db: Session = Depends(get_db)) -> Response:
    plugin = db.query(models.Plugin).filter(models.Plugin.id == plugin_id).first()
    if not plugin:
        raise HTTPException(status_code=404, detail="plugin_not_found")
    plugin.archived = True
    db.commit()
    return Response(status_code=204)


@router.get("/plugins/{plugin_id}/versions", response_model=List[PluginVersion])
def list_plugin_versions(plugin_id: str, db: Session = Depends(get_db)) -> List[PluginVersion]:
    versions = db.query(models.PluginVersion).filter(models.PluginVersion.plugin_id == plugin_id).all()
    return [PluginVersion.model_validate(v) for v in versions]


@router.post("/admin/plugins/{plugin_id}/versions/{version}/freeze", response_model=PluginVersion)
def freeze_plugin_version(plugin_id: str, version: str, db: Session = Depends(get_db)) -> PluginVersion:
    plugin_version = (
        db.query(models.PluginVersion)
        .filter(models.PluginVersion.plugin_id == plugin_id, models.PluginVersion.version == version)
        .order_by(models.PluginVersion.id.desc())
        .first()
    )
    if not plugin_version:
        raise HTTPException(status_code=404, detail="plugin_version_not_found")
    plugin_version.frozen = True
    db.commit()
    db.refresh(plugin_version)
    return PluginVersion.model_validate(plugin_version)


@router.post("/train-jobs", response_model=TrainJobResponse, status_code=201)
def submit_train_job(payload: TrainJobRequest, db: Session = Depends(get_db)) -> TrainJobResponse:
    env_version = (
        db.query(models.EnvVersion)
        .filter(
            models.EnvVersion.env_id == payload.env.env_id,
            models.EnvVersion.version == payload.env.version,
        )
        .first()
    )
    if not env_version:
        raise HTTPException(status_code=404, detail="env_version_not_found")
    if not env_version.entrypoint:
        raise HTTPException(status_code=400, detail="env_entrypoint_missing")
    if env_version.active is False:
        raise HTTPException(status_code=400, detail="env_version_inactive")

    template_version = (
        db.query(models.TemplateVersion)
        .filter(models.TemplateVersion.id == payload.template_version_id)
        .first()
    )
    if not template_version:
        raise HTTPException(status_code=404, detail="template_version_not_found")
    if not template_version.algo_version_id:
        raise HTTPException(status_code=400, detail="template_version_missing_algo_version")
    template = db.query(models.Template).filter(models.Template.id == template_version.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="template_not_found")
    if template.archived:
        raise HTTPException(status_code=400, detail="template_archived")

    algo_version = None
    algo_version_id = payload.algo.algo_version_id or template_version.algo_version_id
    if algo_version_id != template_version.algo_version_id:
        raise HTTPException(status_code=400, detail="algo_version_mismatch")
    if algo_version_id:
        algo_version = db.query(models.AlgoVersion).filter(models.AlgoVersion.id == algo_version_id).first()
        if not algo_version:
            raise HTTPException(status_code=404, detail="algo_version_not_found")
        if algo_version.active is False:
            raise HTTPException(status_code=400, detail="algo_version_inactive")
        if payload.algo.algo_id and payload.algo.algo_id != algo_version.algo_id:
            raise HTTPException(status_code=400, detail="algo_id_mismatch")

    if template_version.env_constraints:
        reason = validate_env_constraints(
            template_version.env_constraints,
            payload.env.env_id,
            payload.env.version,
            env_version.api_mode,
            payload.env.map_set,
        )
        if reason:
            raise HTTPException(status_code=400, detail=f"template_env_constraint_violation:{reason}")

    if algo_version and algo_version.env_constraints:
        reason = validate_env_constraints(
            algo_version.env_constraints,
            payload.env.env_id,
            payload.env.version,
            env_version.api_mode,
            payload.env.map_set,
        )
        if reason:
            raise HTTPException(status_code=400, detail=f"algo_env_constraint_violation:{reason}")

    algo_id = algo_version.algo_id if algo_version else payload.algo.algo_id
    algo_payload = payload.algo.model_dump(by_alias=True)
    algo_payload["algoId"] = algo_id
    if algo_version:
        algo_payload.update(
            {
                "algoVersionId": algo_version.id,
                "version": algo_version.version,
                "entrypoint": algo_version.entrypoint,
                "package": algo_version.package,
                "artifactUri": algo_version.artifact_uri,
                "configSchema": algo_version.config_schema,
                "defaultConfig": algo_version.default_config,
                "resourceProfile": algo_version.resource_profile,
                "envConstraints": algo_version.env_constraints,
                "metadata": algo_version.metadata_,
            }
        )

    plugin_payload = payload.plugin.model_dump(by_alias=True) if payload.plugin else None
    if payload.plugin:
        plugin = db.query(models.Plugin).filter(models.Plugin.id == payload.plugin.plugin_id).first()
        if not plugin:
            raise HTTPException(status_code=404, detail="plugin_not_found")
        if plugin.archived:
            raise HTTPException(status_code=400, detail="plugin_archived")
        plugin_version = (
            db.query(models.PluginVersion)
            .filter(
                models.PluginVersion.plugin_id == payload.plugin.plugin_id,
                models.PluginVersion.version == payload.plugin.version,
            )
            .first()
        )
        if not plugin_version:
            raise HTTPException(status_code=404, detail="plugin_version_not_found")
        plugin_payload = {
            "pluginId": plugin.id,
            "version": plugin_version.version,
            "wheelUri": plugin_version.wheel_uri,
            "sha256": plugin_version.sha256,
            "manifest": plugin_version.manifest,
            "name": plugin.name,
            "type": plugin.type,
        }

    run = models.Run(
        project_id=payload.project_id,
        template_version_id=payload.template_version_id,
        name=f"train-{payload.project_id}-{datetime.utcnow().strftime('%H%M%S')}",
        type="TRAIN",
        status="PENDING",
        algo=algo_id,
        env=f"{payload.env.env_id}:{payload.env.version}",
        gpu=payload.resources.gpus,
        group_id=payload.group_id,
        config={
            "env": {
                **payload.env.model_dump(by_alias=True),
                "apiMode": env_version.api_mode,
                "entrypoint": env_version.entrypoint,
                "package": env_version.package,
                "mapSets": env_version.map_sets,
                "scenarioSchema": env_version.scenario_schema,
            },
            "algo": algo_payload,
            "agent": payload.agent.model_dump(by_alias=True) if payload.agent else None,
            "train": payload.train.model_dump(by_alias=True),
            "resources": payload.resources.model_dump(by_alias=True),
            "seedSet": payload.seed_set,
            "plugin": plugin_payload,
            "autoEval": payload.auto_eval.model_dump(by_alias=True) if payload.auto_eval else None,
            "git": payload.git.model_dump(by_alias=True) if payload.git else None,
            "datasetId": payload.dataset_id,
        },
        metrics={"returnMean": [], "winRate": [], "entropy": []},
    )
    if payload.git:
        run.git_branch = payload.git.branch
        run.git_commit = payload.git.commit

    if algo_version and algo_version.config_schema:
        config_error = validate_json_schema(algo_version.config_schema, run.config)
        if config_error:
            raise HTTPException(status_code=400, detail=f"algo_config_invalid:{config_error}")
    db.add(run)
    db.commit()
    db.refresh(run)

    job = models.Job(
        run_id=run.id, 
        status="PENDING",
        priority=payload.resources.priority if payload.resources.priority is not None else 2
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    job_manager.submit(job.id)
    return TrainJobResponse(run_id=run.id, job_id=job.id)


@router.get("/runs", response_model=List[Run])
def list_runs(
    project_id: Optional[str] = None,
    type: Optional[str] = None,
    status: Optional[str] = None,
    group_id: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[Run]:
    query = db.query(models.Run)
    if project_id:
        query = query.filter(models.Run.project_id == project_id)
    if type:
        query = query.filter(models.Run.type == type)
    if status:
        query = query.filter(models.Run.status == status)
    if group_id:
        query = query.filter(models.Run.group_id == group_id)
    runs = query.order_by(models.Run.created.desc()).all()
    return [Run.model_validate(r) for r in runs]


@router.get("/runs/{run_id}", response_model=Run)
def get_run(run_id: str, db: Session = Depends(get_db)) -> Run:
    run = db.query(models.Run).filter(models.Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    metrics_service.sync_run_metrics(db, run)
    return Run.model_validate(run)


@router.get("/runs/{run_id}/job", response_model=Job)
def get_run_job(run_id: str, db: Session = Depends(get_db)) -> Job:
    job = (
        db.query(models.Job)
        .filter(models.Job.run_id == run_id)
        .order_by(models.Job.created_at.desc())
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    return Job.model_validate(job)


@router.get("/runs/{run_id}/checkpoints", response_model=List[Checkpoint])
def list_checkpoints(run_id: str, db: Session = Depends(get_db)) -> List[Checkpoint]:
    checkpoints = db.query(models.Checkpoint).filter(models.Checkpoint.run_id == run_id).all()
    return [Checkpoint.model_validate(c) for c in checkpoints]


@router.post("/runs/{run_id}/checkpoints/{ckpt_id}/tag", response_model=Checkpoint)
def tag_checkpoint(run_id: str, ckpt_id: str, payload: CheckpointTagRequest, db: Session = Depends(get_db)) -> Checkpoint:
    checkpoint = (
        db.query(models.Checkpoint)
        .filter(models.Checkpoint.run_id == run_id, models.Checkpoint.id == ckpt_id)
        .first()
    )
    if not checkpoint:
        raise HTTPException(status_code=404, detail="checkpoint_not_found")
    if payload.tag == "best":
        others = (
            db.query(models.Checkpoint)
            .filter(models.Checkpoint.run_id == run_id, models.Checkpoint.id != ckpt_id)
            .all()
        )
        for other in others:
            if "best" in (other.tags or []):
                other.tags = [tag for tag in other.tags if tag != "best"]
    if payload.tag not in checkpoint.tags:
        checkpoint.tags = checkpoint.tags + [payload.tag]
    db.commit()
    db.refresh(checkpoint)
    return Checkpoint.model_validate(checkpoint)


@router.get("/jobs/{job_id}", response_model=Job)
def get_job(job_id: str, db: Session = Depends(get_db)) -> Job:
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    return Job.model_validate(job)


@router.post("/jobs/{job_id}/cancel", response_model=Job)
def cancel_job(job_id: str, payload: Optional[JobControlRequest] = None, db: Session = Depends(get_db)) -> Job:
    try:
        job = job_manager.cancel(job_id, payload.reason if payload else None)
    except ValueError as exc:
        detail = str(exc)
        if detail == "job_not_found":
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=400, detail=detail)
    return Job.model_validate(job)


@router.post("/jobs/{job_id}/pause", response_model=Job)
def pause_job(job_id: str, payload: Optional[JobControlRequest] = None, db: Session = Depends(get_db)) -> Job:
    try:
        job = job_manager.pause(job_id, payload.reason if payload else None)
    except ValueError as exc:
        detail = str(exc)
        if detail == "job_not_found":
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=400, detail=detail)
    return Job.model_validate(job)


@router.post("/jobs/{job_id}/resume", response_model=Job)
def resume_job(job_id: str, payload: Optional[JobControlRequest] = None, db: Session = Depends(get_db)) -> Job:
    try:
        job = job_manager.resume(job_id, payload.reason if payload else None)
    except ValueError as exc:
        detail = str(exc)
        if detail == "job_not_found":
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=400, detail=detail)
    return Job.model_validate(job)


@router.get("/eval-protocols", response_model=List[EvalProtocolSummary])
def list_eval_protocols(db: Session = Depends(get_db)) -> List[EvalProtocolSummary]:
    protocols = db.query(models.EvalProtocol).order_by(models.EvalProtocol.created_at.desc()).all()
    results = []
    seen = set()
    for protocol in protocols:
        if protocol.protocol_key in seen:
            continue
        seen.add(protocol.protocol_key)
        results.append(
            EvalProtocolSummary.model_validate(
                {
                    "id": protocol.id,
                    "protocol_key": protocol.protocol_key,
                    "name": protocol.name,
                    "version": protocol.version,
                    "env_id": protocol.env_id,
                    "map": protocol.map_set or "",
                    "eval_seeds": protocol.eval_seeds,
                    "episodes": protocol.episodes_per_match,
                    "frozen": protocol.frozen,
                    "created": protocol.created_at,
                }
            )
        )
    return results


@router.post("/eval-protocols", response_model=EvalProtocol, status_code=201)
def create_eval_protocol(payload: EvalProtocolCreate, db: Session = Depends(get_db)) -> EvalProtocol:
    _validate_env_ref(db, payload.env)
    protocol_key = models.generate_id()
    protocol = models.EvalProtocol(
        protocol_key=protocol_key,
        version=payload.version or "1.0.0",
        name=payload.name,
        env_id=payload.env.env_id,
        env_version=payload.env.version,
        map_set=payload.env.map_set,
        eval_seeds=payload.eval_seeds,
        episodes_per_match=payload.episodes_per_match,
        timeout_sec=payload.timeout_sec,
        metrics=payload.metrics,
        opponent_pool_id=payload.opponent_pool_ref.pool_id if payload.opponent_pool_ref else None,
        opponent_pool_version=payload.opponent_pool_ref.version if payload.opponent_pool_ref else None,
        frozen=False,
    )
    db.add(protocol)
    db.commit()
    db.refresh(protocol)
    return EvalProtocol.model_validate(
        {
            "id": protocol.id,
            "protocol_key": protocol.protocol_key,
            "name": protocol.name,
            "version": protocol.version,
            "env": {
                "env_id": protocol.env_id,
                "version": protocol.env_version or "",
                "map_set": protocol.map_set or "",
            },
            "eval_seeds": protocol.eval_seeds,
            "episodes_per_match": protocol.episodes_per_match,
            "timeout_sec": protocol.timeout_sec,
            "metrics": protocol.metrics,
            "opponent_pool_ref": {
                "pool_id": protocol.opponent_pool_id,
                "version": protocol.opponent_pool_version,
            }
            if protocol.opponent_pool_id
            else None,
            "frozen": protocol.frozen,
            "created_at": protocol.created_at,
        }
    )


@router.get("/eval-protocols/{protocol_id}", response_model=EvalProtocol)
def get_eval_protocol(protocol_id: str, db: Session = Depends(get_db)) -> EvalProtocol:
    protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == protocol_id).first()
    if not protocol:
        raise HTTPException(status_code=404, detail="protocol_not_found")
    return EvalProtocol.model_validate(
        {
            "id": protocol.id,
            "protocol_key": protocol.protocol_key,
            "name": protocol.name,
            "version": protocol.version,
            "env": {
                "env_id": protocol.env_id,
                "version": protocol.env_version or "",
                "map_set": protocol.map_set or "",
            },
            "eval_seeds": protocol.eval_seeds,
            "episodes_per_match": protocol.episodes_per_match,
            "timeout_sec": protocol.timeout_sec,
            "metrics": protocol.metrics,
            "opponent_pool_ref": {
                "pool_id": protocol.opponent_pool_id,
                "version": protocol.opponent_pool_version,
            }
            if protocol.opponent_pool_id
            else None,
            "frozen": protocol.frozen,
            "created_at": protocol.created_at,
        }
    )


@router.get("/eval-protocols/{protocol_id}/versions", response_model=List[EvalProtocolSummary])
def list_eval_protocol_versions(protocol_id: str, db: Session = Depends(get_db)) -> List[EvalProtocolSummary]:
    base = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == protocol_id).first()
    if not base:
        raise HTTPException(status_code=404, detail="protocol_not_found")
    protocols = (
        db.query(models.EvalProtocol)
        .filter(models.EvalProtocol.protocol_key == base.protocol_key)
        .order_by(models.EvalProtocol.created_at.desc())
        .all()
    )
    results = []
    for protocol in protocols:
        results.append(
            EvalProtocolSummary.model_validate(
                {
                    "id": protocol.id,
                    "protocol_key": protocol.protocol_key,
                    "name": protocol.name,
                    "version": protocol.version,
                    "env_id": protocol.env_id,
                    "map": protocol.map_set or "",
                    "eval_seeds": protocol.eval_seeds,
                    "episodes": protocol.episodes_per_match,
                    "frozen": protocol.frozen,
                    "created": protocol.created_at,
                }
            )
        )
    return results


@router.post("/eval-protocols/{protocol_id}/versions", response_model=EvalProtocol, status_code=201)
def create_eval_protocol_version(
    protocol_id: str,
    payload: Optional[EvalProtocolVersionCreate] = None,
    db: Session = Depends(get_db),
) -> EvalProtocol:
    base = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == protocol_id).first()
    if not base:
        raise HTTPException(status_code=404, detail="protocol_not_found")

    payload = payload or EvalProtocolVersionCreate()
    existing_versions = (
        db.query(models.EvalProtocol.version)
        .filter(models.EvalProtocol.protocol_key == base.protocol_key)
        .all()
    )
    version_values = [v[0] for v in existing_versions]
    version = payload.version or _next_version(version_values)
    if version in version_values:
        raise HTTPException(status_code=400, detail="protocol_version_exists")

    env = payload.env or EnvRef(env_id=base.env_id, version=base.env_version or "", map_set=base.map_set or "")
    _validate_env_ref(db, env)
    protocol = models.EvalProtocol(
        protocol_key=base.protocol_key,
        version=version,
        name=payload.name or base.name,
        env_id=env.env_id,
        env_version=env.version,
        map_set=env.map_set,
        eval_seeds=payload.eval_seeds or base.eval_seeds,
        episodes_per_match=payload.episodes_per_match or base.episodes_per_match,
        timeout_sec=payload.timeout_sec if payload.timeout_sec is not None else base.timeout_sec,
        metrics=payload.metrics if payload.metrics is not None else base.metrics,
        opponent_pool_id=payload.opponent_pool_ref.pool_id if payload.opponent_pool_ref else base.opponent_pool_id,
        opponent_pool_version=payload.opponent_pool_ref.version if payload.opponent_pool_ref else base.opponent_pool_version,
        frozen=False,
    )
    db.add(protocol)
    db.commit()
    db.refresh(protocol)
    return get_eval_protocol(protocol.id, db)


@router.post("/eval-protocols/{protocol_id}/freeze", response_model=EvalProtocol)
def freeze_eval_protocol(protocol_id: str, db: Session = Depends(get_db)) -> EvalProtocol:
    protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == protocol_id).first()
    if not protocol:
        raise HTTPException(status_code=404, detail="protocol_not_found")
    protocol.frozen = True
    db.commit()
    db.refresh(protocol)
    return get_eval_protocol(protocol_id, db)


@router.delete("/eval-protocols/{protocol_id}", status_code=204)
def delete_eval_protocol(protocol_id: str, db: Session = Depends(get_db)) -> Response:
    protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == protocol_id).first()
    if not protocol:
        raise HTTPException(status_code=404, detail="protocol_not_found")
    protocol_ids = [
        pid
        for (pid,) in db.query(models.EvalProtocol.id)
        .filter(models.EvalProtocol.protocol_key == protocol.protocol_key)
        .all()
    ]
    if protocol_ids:
        db.query(models.EvalResult).filter(models.EvalResult.protocol_id.in_(protocol_ids)).delete(
            synchronize_session=False
        )
        db.query(models.MatrixResult).filter(models.MatrixResult.protocol_id.in_(protocol_ids)).delete(
            synchronize_session=False
        )
    db.query(models.EvalProtocol).filter(models.EvalProtocol.protocol_key == protocol.protocol_key).delete(
        synchronize_session=False
    )
    db.commit()
    return Response(status_code=204)


@router.get("/opponent-pools", response_model=List[OpponentPoolSummary])
def list_opponent_pools(db: Session = Depends(get_db)) -> List[OpponentPoolSummary]:
    pools = db.query(models.OpponentPool).order_by(models.OpponentPool.created_at.desc()).all()
    results = []
    seen = set()
    for pool in pools:
        if pool.pool_key in seen:
            continue
        seen.add(pool.pool_key)
        results.append(
            OpponentPoolSummary.model_validate(
                {
                    "id": pool.id,
                    "pool_key": pool.pool_key,
                    "name": pool.name,
                    "version": pool.version,
                    "size": pool.size,
                    "env": pool.env,
                    "frozen": pool.frozen,
                    "created": pool.created_at,
                }
            )
        )
    return results


@router.get("/opponent-pools/{pool_id}", response_model=OpponentPool)
def get_opponent_pool(pool_id: str, db: Session = Depends(get_db)) -> OpponentPool:
    pool = db.query(models.OpponentPool).filter(models.OpponentPool.id == pool_id).first()
    if not pool:
        raise HTTPException(status_code=404, detail="pool_not_found")
    members = db.query(models.OpponentPoolMember).filter(models.OpponentPoolMember.pool_id == pool_id).all()
    return OpponentPool.model_validate(
        {
            "id": pool.id,
            "pool_key": pool.pool_key,
            "name": pool.name,
            "version": pool.version,
            "env": pool.env,
            "size": pool.size,
            "frozen": pool.frozen,
            "created": pool.created_at,
            "member_snapshot_ids": [m.snapshot_id for m in members],
        }
    )


@router.post("/opponent-pools", response_model=OpponentPool, status_code=201)
def create_opponent_pool(payload: OpponentPoolCreate, db: Session = Depends(get_db)) -> OpponentPool:
    version = payload.version or "1.0.0"
    pool_key = models.generate_id()
    pool = models.OpponentPool(
        pool_key=pool_key,
        name=payload.name,
        version=version,
        env=payload.env,
        size=0,
        frozen=False,
    )
    db.add(pool)
    db.commit()
    db.refresh(pool)

    db.add(models.OpponentPoolVersion(pool_id=pool.id, version=version))

    member_ids = payload.member_snapshot_ids or []
    for snapshot_id in member_ids:
        db.add(models.OpponentPoolMember(pool_id=pool.id, snapshot_id=snapshot_id))
    pool.size = len(member_ids)
    db.commit()
    db.refresh(pool)

    return OpponentPool.model_validate(
        {
            "id": pool.id,
            "pool_key": pool.pool_key,
            "name": pool.name,
            "version": pool.version,
            "env": pool.env,
            "size": pool.size,
            "frozen": pool.frozen,
            "created": pool.created_at,
            "member_snapshot_ids": member_ids,
        }
    )


@router.post("/opponent-pools/{pool_id}/members", response_model=OpponentPool)
def update_opponent_pool_members(pool_id: str, payload: OpponentPoolMembersUpdate, db: Session = Depends(get_db)) -> OpponentPool:
    pool = db.query(models.OpponentPool).filter(models.OpponentPool.id == pool_id).first()
    if not pool:
        raise HTTPException(status_code=404, detail="pool_not_found")
    if pool.frozen:
        raise HTTPException(status_code=400, detail="pool_frozen")

    existing_members = db.query(models.OpponentPoolMember).filter(models.OpponentPoolMember.pool_id == pool_id).all()
    existing_ids = {m.snapshot_id for m in existing_members}

    if payload.mode == "append":
        for snapshot_id in payload.snapshot_ids:
            if snapshot_id not in existing_ids:
                db.add(models.OpponentPoolMember(pool_id=pool_id, snapshot_id=snapshot_id))
                existing_ids.add(snapshot_id)
    elif payload.mode == "remove":
        for snapshot_id in payload.snapshot_ids:
            db.query(models.OpponentPoolMember).filter(
                models.OpponentPoolMember.pool_id == pool_id,
                models.OpponentPoolMember.snapshot_id == snapshot_id,
            ).delete()
            existing_ids.discard(snapshot_id)
    else:
        raise HTTPException(status_code=400, detail="invalid_mode")

    pool.size = len(existing_ids)
    db.commit()
    db.refresh(pool)

    return OpponentPool.model_validate(
        {
            "id": pool.id,
            "pool_key": pool.pool_key,
            "name": pool.name,
            "version": pool.version,
            "env": pool.env,
            "size": pool.size,
            "frozen": pool.frozen,
            "created": pool.created_at,
            "member_snapshot_ids": sorted(list(existing_ids)),
        }
    )


@router.get("/opponent-pools/{pool_id}/versions", response_model=List[OpponentPoolSummary])
def list_opponent_pool_versions(pool_id: str, db: Session = Depends(get_db)) -> List[OpponentPoolSummary]:
    base = db.query(models.OpponentPool).filter(models.OpponentPool.id == pool_id).first()
    if not base:
        raise HTTPException(status_code=404, detail="pool_not_found")
    pools = (
        db.query(models.OpponentPool)
        .filter(models.OpponentPool.pool_key == base.pool_key)
        .order_by(models.OpponentPool.created_at.desc())
        .all()
    )
    results = []
    for pool in pools:
        results.append(
            OpponentPoolSummary.model_validate(
                {
                    "id": pool.id,
                    "pool_key": pool.pool_key,
                    "name": pool.name,
                    "version": pool.version,
                    "size": pool.size,
                    "env": pool.env,
                    "frozen": pool.frozen,
                    "created": pool.created_at,
                }
            )
        )
    return results


@router.post("/opponent-pools/{pool_id}/versions", response_model=OpponentPool, status_code=201)
def create_opponent_pool_version(
    pool_id: str,
    payload: Optional[OpponentPoolVersionCreate] = None,
    db: Session = Depends(get_db),
) -> OpponentPool:
    base = db.query(models.OpponentPool).filter(models.OpponentPool.id == pool_id).first()
    if not base:
        raise HTTPException(status_code=404, detail="pool_not_found")

    payload = payload or OpponentPoolVersionCreate()
    existing_versions = (
        db.query(models.OpponentPool.version)
        .filter(models.OpponentPool.pool_key == base.pool_key)
        .all()
    )
    version_values = [v[0] for v in existing_versions]
    version = payload.version or _next_version(version_values)
    if version in version_values:
        raise HTTPException(status_code=400, detail="pool_version_exists")

    pool = models.OpponentPool(
        pool_key=base.pool_key,
        name=base.name,
        version=version,
        env=base.env,
        size=0,
        frozen=False,
    )
    db.add(pool)
    db.commit()
    db.refresh(pool)

    db.add(models.OpponentPoolVersion(pool_id=pool.id, version=version))

    if payload.member_snapshot_ids is not None:
        member_ids = payload.member_snapshot_ids
    else:
        base_members = (
            db.query(models.OpponentPoolMember).filter(models.OpponentPoolMember.pool_id == base.id).all()
        )
        member_ids = [m.snapshot_id for m in base_members]

    for snapshot_id in member_ids:
        db.add(models.OpponentPoolMember(pool_id=pool.id, snapshot_id=snapshot_id))
    pool.size = len(member_ids)
    db.commit()
    db.refresh(pool)

    return OpponentPool.model_validate(
        {
            "id": pool.id,
            "pool_key": pool.pool_key,
            "name": pool.name,
            "version": pool.version,
            "env": pool.env,
            "size": pool.size,
            "frozen": pool.frozen,
            "created": pool.created_at,
            "member_snapshot_ids": member_ids,
        }
    )


@router.post("/opponent-pools/{pool_id}/freeze", response_model=OpponentPool)
def freeze_opponent_pool(pool_id: str, db: Session = Depends(get_db)) -> OpponentPool:
    pool = db.query(models.OpponentPool).filter(models.OpponentPool.id == pool_id).first()
    if not pool:
        raise HTTPException(status_code=404, detail="pool_not_found")
    pool.frozen = True
    db.commit()
    db.refresh(pool)
    members = db.query(models.OpponentPoolMember).filter(models.OpponentPoolMember.pool_id == pool_id).all()
    return OpponentPool.model_validate(
        {
            "id": pool.id,
            "pool_key": pool.pool_key,
            "name": pool.name,
            "version": pool.version,
            "env": pool.env,
            "size": pool.size,
            "frozen": pool.frozen,
            "created": pool.created_at,
            "member_snapshot_ids": [m.snapshot_id for m in members],
        }
    )


@router.delete("/opponent-pools/{pool_id}", status_code=204)
def delete_opponent_pool(pool_id: str, db: Session = Depends(get_db)) -> Response:
    pool = db.query(models.OpponentPool).filter(models.OpponentPool.id == pool_id).first()
    if not pool:
        raise HTTPException(status_code=404, detail="pool_not_found")
    pool_ids = [
        pid
        for (pid,) in db.query(models.OpponentPool.id)
        .filter(models.OpponentPool.pool_key == pool.pool_key)
        .all()
    ]
    if pool_ids:
        db.query(models.OpponentPoolMember).filter(models.OpponentPoolMember.pool_id.in_(pool_ids)).delete(
            synchronize_session=False
        )
        db.query(models.OpponentPoolVersion).filter(models.OpponentPoolVersion.pool_id.in_(pool_ids)).delete(
            synchronize_session=False
        )
        db.query(models.MatrixResult).filter(models.MatrixResult.pool_id.in_(pool_ids)).delete(
            synchronize_session=False
        )
        db.query(models.EvalProtocol).filter(models.EvalProtocol.opponent_pool_id.in_(pool_ids)).update(
            {
                models.EvalProtocol.opponent_pool_id: None,
                models.EvalProtocol.opponent_pool_version: None,
            },
            synchronize_session=False,
        )
    db.query(models.OpponentPool).filter(models.OpponentPool.pool_key == pool.pool_key).delete(
        synchronize_session=False
    )
    db.commit()
    return Response(status_code=204)


@router.post("/eval-jobs", response_model=EvalJobResponse, status_code=201)
def submit_eval_job(payload: EvalJobRequest, db: Session = Depends(get_db)) -> EvalJobResponse:
    protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == payload.protocol_id).first()
    if not protocol:
        raise HTTPException(status_code=404, detail="protocol_not_found")
    project = get_or_create_system_project(db)
    run = models.Run(
        project_id=project.id,
        name=f"eval-{payload.protocol_id}-{datetime.utcnow().strftime('%H%M%S')}",
        type="EVAL",
        status="PENDING",
        algo="sb3-eval", # Use the real evaluator
        env=payload.protocol_id,
        config={
            "protocolId": payload.protocol_id, 
            "policySnapshotId": payload.policy_snapshot_id,
            # We also need to inject the algo entrypoint info so the Runner knows what to load
            # The runner looks at `config.algo.entrypoint`.
            "algo": {
                "entrypoint": "algorithms.sb3_eval:evaluate",
                "name": "SB3 Evaluator"
            }
        },
        metrics={"returnMean": [], "winRate": [], "entropy": []},
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    job = models.Job(run_id=run.id, status="PENDING")
    db.add(job)
    db.commit()
    db.refresh(job)

    result = models.EvalResult(run_id=run.id, protocol_id=payload.protocol_id, metrics={})
    db.add(result)
    db.commit()
    db.refresh(result)

    run.config = {**(run.config or {}), "evalResultId": result.id}
    db.commit()

    job_manager.submit(job.id)
    return EvalJobResponse(run_id=run.id, job_id=job.id, eval_result_id=result.id)


@router.post("/matrix-jobs", response_model=MatrixJobResponse, status_code=201)
def submit_matrix_job(payload: MatrixJobRequest, db: Session = Depends(get_db)) -> MatrixJobResponse:
    protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == payload.protocol_id).first()
    if not protocol:
        raise HTTPException(status_code=404, detail="protocol_not_found")
    member_ids = payload.policy_snapshot_ids
    pool_id = payload.pool_id
    if pool_id:
        pool = db.query(models.OpponentPool).filter(models.OpponentPool.id == pool_id).first()
        if not pool:
            raise HTTPException(status_code=404, detail="pool_not_found")
        if not member_ids:
            members = (
                db.query(models.OpponentPoolMember).filter(models.OpponentPoolMember.pool_id == pool_id).all()
            )
            member_ids = [m.snapshot_id for m in members]
    project = get_or_create_system_project(db)
    run = models.Run(
        project_id=project.id,
        name=f"matrix-{payload.protocol_id}-{datetime.utcnow().strftime('%H%M%S')}",
        type="MATRIX",
        status="PENDING",
        algo="matrix",
        env=payload.protocol_id,
        config={
            "protocolId": payload.protocol_id,
            "policySnapshotIds": member_ids,
            "gamesPerPair": payload.games_per_pair,
            "poolId": pool_id,
            "metric": payload.metric,
        },
        metrics={"returnMean": [], "winRate": [], "entropy": []},
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    job = models.Job(run_id=run.id, status="PENDING")
    db.add(job)
    db.commit()
    db.refresh(job)

    matrix_result = models.MatrixResult(
        protocol_id=payload.protocol_id,
        pool_id=pool_id,
        cells=[],
    )
    db.add(matrix_result)
    db.commit()
    db.refresh(matrix_result)

    run.config = {**(run.config or {}), "matrixId": matrix_result.id}
    db.commit()

    job_manager.submit(job.id)
    return MatrixJobResponse(matrix_id=matrix_result.id, job_id=job.id)


@router.get("/eval-results/{eval_result_id}", response_model=EvalResult)
def get_eval_result(eval_result_id: str, db: Session = Depends(get_db)) -> EvalResult:
    result = db.query(models.EvalResult).filter(models.EvalResult.id == eval_result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="eval_result_not_found")
    return EvalResult.model_validate(result)


@router.get("/matrix-results", response_model=List[MatrixResult])
def list_matrix_results(
    run_id: Optional[str] = None,
    protocol_id: Optional[str] = None,
    pool_id: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[MatrixResult]:
    query = db.query(models.MatrixResult)
    if run_id:
        run = db.query(models.Run).filter(models.Run.id == run_id).first()
        matrix_id = None
        if run and isinstance(run.config, dict):
            matrix_id = run.config.get("matrixId")
        if matrix_id:
            query = query.filter(models.MatrixResult.id == matrix_id)
        else:
            return []
    if protocol_id:
        query = query.filter(models.MatrixResult.protocol_id == protocol_id)
    if pool_id:
        query = query.filter(models.MatrixResult.pool_id == pool_id)
    results = query.all()
    return [MatrixResult.model_validate(r) for r in results]


@router.get("/matrix-results/{matrix_id}", response_model=MatrixResult)
def get_matrix_result(matrix_id: str, db: Session = Depends(get_db)) -> MatrixResult:
    result = db.query(models.MatrixResult).filter(models.MatrixResult.id == matrix_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="matrix_result_not_found")
    return MatrixResult.model_validate(result)


@router.get("/runs/{run_id}/metrics", response_model=RunMetricsResponse)
def get_run_metrics(run_id: str, db: Session = Depends(get_db)) -> RunMetricsResponse:
    run = db.query(models.Run).filter(models.Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    series = metrics_service.read_series(run.id)
    if not series:
        series = run.metrics or {}
    else:
        run.metrics = series
        db.commit()
    return RunMetricsResponse(run_id=run.id, series=series)


@router.get("/runs/{run_id}/logs", response_model=LogPage)
def get_run_logs(run_id: str, page: int = 1, page_size: int = 50, db: Session = Depends(get_db)) -> LogPage:
    from app.services import paths
    import itertools
    
    log_file = paths.logs_path(run_id)
    lines = []
    has_more = False
    
    if log_file.exists():
        try:
            start = (page - 1) * page_size
            end = start + page_size
            # Use islice to read only the lines we need without loading whole file
            with log_file.open("r", encoding="utf-8", errors="replace") as f:
                # We read 'page_size + 1' to check if there is more
                sliced = list(itertools.islice(f, start, end + 1))
                
                if len(sliced) > page_size:
                    has_more = True
                    lines = [line.rstrip() for line in sliced[:-1]]
                else:
                    has_more = False
                    lines = [line.rstrip() for line in sliced]
        except Exception:
            pass
            
    return LogPage(lines=lines, page=page, page_size=page_size, has_more=has_more)


@router.get("/runs/{run_id}/stream")
def stream_run(run_id: str) -> Response:
    return Response(status_code=200)


@router.websocket("/runs/{run_id}/stream")
async def stream_run_ws(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    last_status: Optional[str] = None
    last_ckpt_id: Optional[str] = None
    last_pos = 0

    db = SessionLocal()
    try:
        run = db.query(models.Run).filter(models.Run.id == run_id).first()
        if not run:
            await websocket.close(code=1008)
            return
    finally:
        db.close()

    try:
        while True:
            metrics_file = metrics_path(run_id)
            if metrics_file.exists():
                with metrics_file.open("r", encoding="utf-8") as handle:
                    handle.seek(last_pos)
                    for line in handle:
                        if not line.strip():
                            continue
                        payload = json.loads(line)
                        await websocket.send_json(
                            {
                                "type": "metric",
                                "step": payload.get("step"),
                                "values": payload.get("values") or {},
                            }
                        )
                    last_pos = handle.tell()

            db = SessionLocal()
            try:
                job = (
                    db.query(models.Job)
                    .filter(models.Job.run_id == run_id)
                    .order_by(models.Job.created_at.desc())
                    .first()
                )
                if job and job.status != last_status:
                    last_status = job.status
                    await websocket.send_json({"type": "status", "job_status": job.status, "gpu_util": []})

                checkpoint = (
                    db.query(models.Checkpoint)
                    .filter(models.Checkpoint.run_id == run_id)
                    .order_by(models.Checkpoint.created_at.desc())
                    .first()
                )
                if checkpoint and checkpoint.id != last_ckpt_id:
                    last_ckpt_id = checkpoint.id
                    await websocket.send_json(
                        {"type": "checkpoint", "ckpt_id": checkpoint.id, "path": checkpoint.path}
                    )
            finally:
                db.close()

            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        return


@router.get("/runs/{run_id}/artifacts", response_model=List[ArtifactFile])
def list_artifacts(run_id: str, db: Session = Depends(get_db)) -> List[ArtifactFile]:
    artifacts = db.query(models.Artifact).filter(models.Artifact.run_id == run_id).all()
    return [ArtifactFile.model_validate(a) for a in artifacts]


@router.get("/runs/{run_id}/artifacts/archive")
def download_artifact_archive(run_id: str, db: Session = Depends(get_db)) -> StreamingResponse:
    artifacts = db.query(models.Artifact).filter(models.Artifact.run_id == run_id).all()
    if not artifacts:
        raise HTTPException(status_code=404, detail="artifacts_not_found")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for artifact in artifacts:
            if artifact.type != "file" or not artifact.object_key:
                continue
            try:
                content = s3_client.get_object_bytes(artifact.object_key)
            except Exception:
                raise HTTPException(status_code=404, detail="artifact_object_missing")
            archive_path = artifact.path.lstrip("/") or artifact.name
            zip_file.writestr(archive_path, content)

    buffer.seek(0)
    filename = f"run_{run_id}_artifacts.zip"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return StreamingResponse(buffer, media_type="application/zip", headers=headers)


@router.get("/artifacts/{artifact_id}/download_url", response_model=ArtifactDownloadResponse)
def get_artifact_download_url(artifact_id: str, db: Session = Depends(get_db)) -> ArtifactDownloadResponse:
    artifact = db.query(models.Artifact).filter(models.Artifact.id == artifact_id).first()
    if not artifact:
        raise HTTPException(status_code=404, detail="artifact_not_found")
    url = s3_client.presigned_get_url(artifact.object_key)
    return ArtifactDownloadResponse(url=url, expires_at=(datetime.utcnow().isoformat()))


@router.get("/runs/{run_id}/repro-bundle", response_model=ReproBundleResponse)
def get_repro_bundle(run_id: str, db: Session = Depends(get_db)) -> ReproBundleResponse:
    run = db.query(models.Run).filter(models.Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")

    manifest_artifact = (
        db.query(models.Artifact)
        .filter(models.Artifact.run_id == run_id, models.Artifact.path == "/manifest/repro_manifest.json")
        .first()
    )
    config_artifact = (
        db.query(models.Artifact)
        .filter(models.Artifact.run_id == run_id, models.Artifact.path == "/manifest/config_resolved.yaml")
        .first()
    )
    if not manifest_artifact or not config_artifact:
        try:
            manifest = repro_bundle_service.generate(db, run)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
    else:
        manifest = repro_bundle_service.build_manifest(run)

    url = repro_bundle_service.get_manifest_url(run_id)
    return ReproBundleResponse(url=url, manifest=manifest)


@router.get("/datasets", response_model=List[Dataset])
def list_datasets(db: Session = Depends(get_db)) -> List[Dataset]:
    datasets = dataset_service.list_datasets(db)
    return [Dataset.model_validate(d) for d in datasets]


@router.post("/datasets", response_model=Dataset, status_code=201)
def create_dataset(payload: DatasetCreate, db: Session = Depends(get_db)) -> Dataset:
    dataset = dataset_service.create_dataset(db, payload)
    return Dataset.model_validate(dataset)


@router.post("/admin/webhooks", response_model=Webhook, status_code=201)
def create_webhook(payload: WebhookCreate, db: Session = Depends(get_db)) -> Webhook:
    webhook = models.Webhook(url=payload.url, events=payload.events, secret=payload.secret, active=True)
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    return Webhook.model_validate(webhook)
