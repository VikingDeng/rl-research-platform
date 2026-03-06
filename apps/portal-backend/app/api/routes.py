import asyncio
import importlib
import inspect
import io
import json
import shutil
import subprocess
import sys
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import StreamingResponse, FileResponse, RedirectResponse
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session, defer

from app.api.deps import get_db, require_api_token, check_ws_token
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
    RunSummary,
    RunGroupSummary,
    RunGroupItem,
    RunGroupMetricSummary,
    Checkpoint,
    CheckpointTagRequest,
    Job,
    JobControlRequest,
    TrainJobRequest,
    TrainJobResponse,
    RunMetricsResponse,
    LogPage,
    NotebookCreate,
    NotebookResponse,
    RunExportTemplateRequest,
)
from app.schemas.eval import (
    EnvRef,
    EvalProtocol,
    EvalProtocolCreate,
    EvalProtocolUpdate,
    EvalProtocolSummary,
    EvalProtocolVersionCreate,
    OpponentPool,
    OpponentPoolRef,
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
from app.services.algo_manifest import AlgoManifest
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
from app.schemas.bootstrap import BootstrapResponse
from app.services import paths, runtime_packages
from app.services.auth import get_api_token, ensure_setting, generate_api_token
from app.schemas.webhooks import Webhook, WebhookCreate
from app.schemas.datasets import Dataset, DatasetCreate, DatasetPreview
from app.services.artifacts import artifact_service
from app.services.job_manager import job_manager
from app.services.metrics import metrics_service
from app.services.paths import metrics_path
from app.services.repro_bundle import repro_bundle_service
from app.services.retention import apply_checkpoint_policy
from app.services.schema_validation import validate_env_constraints, validate_json_schema
from app.services.s3 import s3_client
from app.services.datasets import dataset_service
from app.services.bootstrap import bootstrap_service
from app.schemas.models import (
    RegisteredModel,
    ModelVersion,
    ModelCreate,
    ModelVersionCreate,
    ModelVersionUpdate,
)
from app.schemas.agentic_os import (
    AgenticApproverListResponse,
    AgenticApproverRecord,
    AgenticApprovalPolicyTemplate,
    AgenticApprovalPolicyTemplateListResponse,
    AgenticActionResponse,
    AgenticApproveRequest,
    AgenticAuditReplayResponse,
    AgenticBranchRequest,
    AgenticExecuteRequest,
    AgenticIdeaInput,
    AgenticListResponse,
    AgenticMatrixRequest,
    AgenticMatrixResponse,
    AgenticReproResponse,
    AgenticRunCreateRequest,
    AgenticRunCreateResponse,
    AgenticRunDetail,
    AgenticRunReportResponse,
    AgenticSubAgentListResponse,
    AgenticSpecValidationResponse,
)
from app.services.agentic_os import agentic_os_service

router = APIRouter(dependencies=[Depends(require_api_token)])

# ... (other code)

@router.get("/models", response_model=List[RegisteredModel])
def list_models(db: Session = Depends(get_db)) -> List[RegisteredModel]:
    models_list = db.query(models.RegisteredModel).all()
    return [RegisteredModel.model_validate(m) for m in models_list]

@router.post("/models", response_model=RegisteredModel, status_code=201)
def create_model(payload: ModelCreate, db: Session = Depends(get_db)) -> RegisteredModel:
    existing = db.query(models.RegisteredModel).filter(models.RegisteredModel.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="model_name_exists")
    
    model = models.RegisteredModel(
        name=payload.name,
        description=payload.description
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return RegisteredModel.model_validate(model)

@router.get("/models/{model_id}/versions", response_model=List[ModelVersion])
def list_model_versions(model_id: str, db: Session = Depends(get_db)) -> List[ModelVersion]:
    versions = (
        db.query(models.ModelVersion)
        .filter(models.ModelVersion.model_id == model_id)
        .order_by(models.ModelVersion.version.desc())
        .all()
    )
    return [ModelVersion.model_validate(v) for v in versions]

@router.post("/models/{model_id}/versions", response_model=ModelVersion, status_code=201)
def create_model_version(model_id: str, payload: ModelVersionCreate, db: Session = Depends(get_db)) -> ModelVersion:
    model = db.query(models.RegisteredModel).filter(models.RegisteredModel.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="model_not_found")
    
    ckpt = db.query(models.Checkpoint).filter(models.Checkpoint.id == payload.checkpoint_id).first()
    if not ckpt:
        raise HTTPException(status_code=404, detail="checkpoint_not_found")

    # Get next version number
    last_version = (
        db.query(models.ModelVersion)
        .filter(models.ModelVersion.model_id == model_id)
        .order_by(models.ModelVersion.version.desc())
        .first()
    )
    next_ver = (last_version.version + 1) if last_version else 1
    
    version = models.ModelVersion(
        model_id=model_id,
        checkpoint_id=payload.checkpoint_id,
        version=next_ver,
        stage="None"
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return ModelVersion.model_validate(version)

@router.patch("/models/versions/{version_id}", response_model=ModelVersion)
def update_model_version_stage(version_id: str, payload: ModelVersionUpdate, db: Session = Depends(get_db)) -> ModelVersion:
    version = db.query(models.ModelVersion).filter(models.ModelVersion.id == version_id).first()
    if not version:
        raise HTTPException(status_code=404, detail="model_version_not_found")
    
    if payload.stage not in ["None", "Staging", "Production", "Archived"]:
        raise HTTPException(status_code=400, detail="invalid_stage")
        
    version.stage = payload.stage
    db.commit()
    db.refresh(version)
    return ModelVersion.model_validate(version)


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
            "metadata": model.metadata_,
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


def _build_settings_response(db: Session) -> SettingsResponse:
    token = get_api_token(db)
    retention_setting = ensure_setting(db, "retention", {"checkpointPolicy": "best_latest_5"})
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
        local_executor_mode=settings.local_executor_mode.lower(),
        determined_master_url=determined_url,
        determined_connected=determined_connected,
        determined_mock=settings.determined_mock,
        scheduler="local" if executor_mode == "local" else "determined",
    )
    storage = StorageUsage(artifact_bytes=artifact_bytes, db_bytes=db_bytes)
    retention = RetentionPolicy(checkpoint_policy=checkpoint_policy or "best_latest_5")
    return SettingsResponse(api_token=token, executor=executor, storage=storage, retention=retention)


from app.services.system_monitor import get_system_resources, SystemResources

# ... (inside router)

@router.get("/system/resources", response_model=SystemResources)
def get_resources() -> SystemResources:
    return get_system_resources()

@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    token = get_api_token(db)
    if settings.allow_anon:
        return LoginResponse(token=token)
    if payload.password != token and payload.email != token:
        raise HTTPException(status_code=401, detail="invalid_api_token")
    return LoginResponse(token=token)


@router.get("/auth/me", response_model=User)
def me() -> User:
    return User(id="user_dev", email="dev@example.com", name="Dev User", roles=["admin"])


@router.get("/settings", response_model=SettingsResponse)
def get_settings(db: Session = Depends(get_db)) -> SettingsResponse:
    return _build_settings_response(db)


@router.patch("/settings", response_model=SettingsResponse)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)) -> SettingsResponse:
    if payload.checkpoint_policy:
        setting = ensure_setting(db, "retention", {"checkpointPolicy": "best_latest_5"})
        current = setting.value if isinstance(setting.value, dict) else {}
        current["checkpointPolicy"] = payload.checkpoint_policy
        setting.value = current
        db.commit()
    return _build_settings_response(db)


@router.post("/settings/token/rotate", response_model=TokenRotateResponse)
def rotate_token(db: Session = Depends(get_db)) -> TokenRotateResponse:
    token = generate_api_token()
    setting = ensure_setting(db, "api_token", {"token": token})
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


@router.post("/admin/bootstrap", response_model=BootstrapResponse)
def bootstrap_defaults(db: Session = Depends(get_db)) -> BootstrapResponse:
    payload = bootstrap_service.ensure_defaults(db)
    return BootstrapResponse.model_validate(payload)


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


def _apply_algo_manifest(
    algo_id: str,
    version: Optional[str],
    entrypoint: Optional[str],
    metadata: Optional[dict],
    *,
    require_manifest: bool = True,
) -> tuple[AlgoManifest, dict]:
    meta = dict(metadata) if isinstance(metadata, dict) else {}
    raw = meta.get("manifest")
    if not raw:
        if require_manifest:
            raise HTTPException(status_code=400, detail="algo_manifest_required")
        raise HTTPException(status_code=400, detail="algo_manifest_missing")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"algo_manifest_invalid:{exc}") from exc
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="algo_manifest_invalid")

    deps = raw.get("dependencies")
    if deps is None:
        deps = raw.get("runtimePackages")
    if isinstance(deps, str):
        raw["dependencies"] = [deps]
    elif deps is None:
        raw["dependencies"] = []

    try:
        manifest = AlgoManifest.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=f"algo_manifest_invalid:{exc}") from exc

    if manifest.algo_id and manifest.algo_id != algo_id:
        raise HTTPException(status_code=400, detail="algo_manifest_algo_id_mismatch")
    if version and manifest.version != version:
        raise HTTPException(status_code=400, detail="algo_manifest_version_mismatch")
    if entrypoint and manifest.entrypoint != entrypoint:
        raise HTTPException(status_code=400, detail="algo_manifest_entrypoint_mismatch")
    if not manifest.config_schema:
        raise HTTPException(status_code=400, detail="algo_manifest_config_schema_missing")

    meta["manifest"] = manifest.model_dump(by_alias=True)
    if manifest.dependencies:
        meta["runtimePackages"] = manifest.dependencies
    return manifest, meta


def _preflight_algo_entrypoint(entrypoint: str, metadata: Optional[dict], package: Optional[str]) -> None:
    packages: List[str] = []
    if package:
        packages.append(str(package))
    meta = metadata if isinstance(metadata, dict) else {}
    runtime_pkgs = meta.get("runtimePackages")
    if isinstance(runtime_pkgs, list):
        packages.extend(str(pkg) for pkg in runtime_pkgs if pkg)

    runtime_spec = None
    if packages:
        try:
            runtime_spec = runtime_packages.prepare_runtime(packages)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"runtime_packages_failed:{exc}") from exc

    python_paths: List[str] = []
    if runtime_spec:
        python_paths.append(str(runtime_spec.python_path))
    python_path = meta.get("pythonPath")
    if python_path:
        python_paths.insert(0, str(python_path))
    python_paths.append(str(paths.algo_store_dir()))

    backend_root = Path(__file__).resolve().parents[2]
    runner_dir = backend_root / "runner"
    python_paths.append(str(backend_root))
    python_paths.append(str(runner_dir))

    original_path = list(sys.path)
    try:
        sys.path = python_paths + original_path
        module_name, func_name = entrypoint.split(":", 1)
        module = importlib.import_module(module_name)
        func = getattr(module, func_name, None)
        if not callable(func):
            raise HTTPException(status_code=400, detail="entrypoint_not_callable")
        sig = inspect.signature(func)
        params = sig.parameters
        has_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values())
        if "config" not in params and not has_kwargs:
            raise HTTPException(status_code=400, detail="entrypoint_signature_invalid")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"entrypoint_preflight_failed:{exc}") from exc
    finally:
        sys.path = original_path


def _materialize_algo_source(
    algo_id: str,
    version: str,
    entrypoint: str,
    code: Optional[str],
    metadata: Optional[dict],
) -> tuple[str, dict]:
    meta = dict(metadata) if isinstance(metadata, dict) else {}
    source_path = meta.get("sourcePath") or meta.get("path")
    git_cfg = meta.get("git") if isinstance(meta.get("git"), dict) else None
    sources = [bool(code), bool(source_path), bool(git_cfg)]
    if sum(1 for s in sources if s) > 1:
        raise HTTPException(status_code=400, detail="algo_source_conflict")

    store_dir = paths.algo_store_dir()
    entrypoint_out = entrypoint.strip()
    python_path: Optional[str] = None

    if git_cfg and ":" not in entrypoint_out:
        raise HTTPException(status_code=400, detail="algo_entrypoint_module_required")
    if ":" not in entrypoint_out:
        entrypoint_out = f"custom_{algo_id}_{version}:{entrypoint_out}"

    if code:
        module_part, func_part = entrypoint_out.split(":", 1)
        module_part = module_part.strip()
        if not module_part or "/" in module_part or "." in module_part:
            filename = f"custom_{algo_id}_{version}.py"
            entrypoint_out = f"{Path(filename).stem}:{func_part}"
        else:
            filename = f"{module_part}.py"
        (store_dir / filename).write_text(code, encoding="utf-8")
        python_path = str(store_dir)
        meta["materializedPath"] = str(store_dir / filename)

    if source_path:
        src = Path(source_path).expanduser()
        if not src.is_file():
            raise HTTPException(status_code=400, detail="algo_source_path_invalid")
        dest = store_dir / src.name
        shutil.copyfile(src, dest)
        module_name = dest.stem
        mod_part, func_part = entrypoint_out.split(":", 1)
        if mod_part != module_name:
            entrypoint_out = f"{module_name}:{func_part}"
        python_path = str(store_dir)
        meta["materializedPath"] = str(dest)

    if git_cfg:
        repo = git_cfg.get("repo")
        if not repo:
            raise HTTPException(status_code=400, detail="algo_git_repo_missing")
        clone_dir = store_dir / "git" / algo_id / version
        if clone_dir.exists():
            shutil.rmtree(clone_dir)
        clone_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", repo, str(clone_dir)], check=True)
        checkout_ref = git_cfg.get("commit") or git_cfg.get("branch")
        if checkout_ref:
            subprocess.run(["git", "checkout", checkout_ref], cwd=str(clone_dir), check=True)
        subdir = git_cfg.get("subdir")
        python_path = str(clone_dir / subdir) if subdir else str(clone_dir)
        meta["materializedPath"] = str(clone_dir)

    if python_path:
        meta["pythonPath"] = python_path

    return entrypoint_out, meta


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
        .order_by(models.EnvVersion.active.desc(), models.EnvVersion.id.desc())
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


def _validate_scenario_grid(value: Optional[Dict[str, Any]]) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail="scenario_grid_must_be_object")
    has_axes = "axes" in value
    has_scenarios = "scenarios" in value
    if not has_axes and not has_scenarios:
        raise HTTPException(status_code=400, detail="scenario_grid_missing_axes_or_scenarios")
    if has_axes:
        axes = value.get("axes")
        if not isinstance(axes, dict) or not axes:
            raise HTTPException(status_code=400, detail="scenario_grid_axes_invalid")
        for axis_name, axis_values in axes.items():
            if not isinstance(axis_values, list) or len(axis_values) == 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"scenario_grid_axis_invalid:{axis_name}",
                )
    if has_scenarios:
        scenarios = value.get("scenarios")
        if not isinstance(scenarios, list) or len(scenarios) == 0:
            raise HTTPException(status_code=400, detail="scenario_grid_scenarios_invalid")
        for idx, scenario in enumerate(scenarios):
            if not isinstance(scenario, dict):
                raise HTTPException(
                    status_code=400,
                    detail=f"scenario_grid_scenario_invalid:{idx}",
                )


def _validate_opponent_sampling(value: Optional[Dict[str, Any]]) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail="opponent_sampling_must_be_object")
    pool_id = value.get("pool_id", value.get("poolId"))
    if pool_id is not None and not isinstance(pool_id, str):
        raise HTTPException(status_code=400, detail="opponent_sampling_pool_id_invalid")
    weights = value.get("weights")
    if weights is not None:
        if not isinstance(weights, dict):
            raise HTTPException(status_code=400, detail="opponent_sampling_weights_invalid")
        for key, weight in weights.items():
            if not isinstance(weight, (int, float)):
                raise HTTPException(
                    status_code=400,
                    detail=f"opponent_sampling_weight_invalid:{key}",
                )


def _validate_opponent_pool_ref(db: Session, ref: OpponentPoolRef) -> None:
    if not ref.pool_id:
        raise HTTPException(status_code=400, detail="opponent_pool_id_missing")
    pool = db.query(models.OpponentPool).filter(models.OpponentPool.id == ref.pool_id).first()
    if not pool:
        raise HTTPException(status_code=404, detail="opponent_pool_not_found")
    if not ref.version:
        raise HTTPException(status_code=400, detail="opponent_pool_version_missing")
    version = (
        db.query(models.OpponentPoolVersion)
        .filter(
            models.OpponentPoolVersion.pool_id == ref.pool_id,
            models.OpponentPoolVersion.version == ref.version,
        )
        .first()
    )
    if not version:
        raise HTTPException(status_code=404, detail="opponent_pool_version_not_found")


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
    
    manifest, manifest_meta = _apply_algo_manifest(
        algo_id=algo_id,
        version=payload.version,
        entrypoint=payload.entrypoint,
        metadata=payload.metadata,
        require_manifest=True,
    )
    payload.entrypoint = manifest.entrypoint
    payload.config_schema = manifest.config_schema
    payload.default_config = manifest.default_config
    payload.resource_profile = manifest.resource_profile
    payload.env_constraints = manifest.env_constraints
    payload.metadata = manifest_meta
    if manifest.dependencies:
        payload.package = manifest.dependencies[0]

    entrypoint, metadata = _materialize_algo_source(
        algo_id=algo_id,
        version=payload.version,
        entrypoint=payload.entrypoint,
        code=payload.code,
        metadata=payload.metadata,
    )
    if isinstance(metadata.get("manifest"), dict):
        metadata["manifest"]["entrypoint"] = entrypoint
    payload.entrypoint = entrypoint
    payload.metadata = metadata

    _validate_entrypoint(payload.entrypoint, settings.algo_entrypoint_validate)
    _preflight_algo_entrypoint(payload.entrypoint, payload.metadata, payload.package)
    
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
        metadata_=payload.metadata,
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

    incoming_meta = payload.metadata if payload.metadata is not None else {}
    base_meta = algo_version.metadata_ or {}
    merged_meta = {**base_meta, **incoming_meta}

    manifest_required = any(
        value is not None
        for value in (
            payload.entrypoint,
            payload.code,
            payload.metadata,
            payload.config_schema,
            payload.default_config,
            payload.resource_profile,
            payload.env_constraints,
        )
    )
    if "manifest" in merged_meta:
        manifest, merged_meta = _apply_algo_manifest(
            algo_id=algo_id,
            version=version,
            entrypoint=payload.entrypoint or algo_version.entrypoint,
            metadata=merged_meta,
            require_manifest=manifest_required,
        )
        payload.entrypoint = manifest.entrypoint
        payload.config_schema = manifest.config_schema
        payload.default_config = manifest.default_config
        payload.resource_profile = manifest.resource_profile
        payload.env_constraints = manifest.env_constraints
        if manifest.dependencies:
            payload.package = manifest.dependencies[0]
    elif manifest_required:
        raise HTTPException(status_code=400, detail="algo_manifest_required")

    if payload.code or incoming_meta or payload.entrypoint:
        entrypoint = payload.entrypoint or algo_version.entrypoint
        if not entrypoint:
            raise HTTPException(status_code=400, detail="algo_entrypoint_missing")
        entrypoint, merged_meta = _materialize_algo_source(
            algo_id=algo_id,
            version=version,
            entrypoint=entrypoint,
            code=payload.code,
            metadata=merged_meta,
        )
        if isinstance(merged_meta.get("manifest"), dict):
            merged_meta["manifest"]["entrypoint"] = entrypoint
        payload.entrypoint = entrypoint
        payload.metadata = merged_meta

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
    if payload.metadata is not None:
        algo_version.metadata_ = payload.metadata
    if payload.active is not None:
        algo_version.active = payload.active
    if payload.frozen is not None:
        algo_version.frozen = payload.frozen

    if manifest_required:
        _preflight_algo_entrypoint(
            payload.entrypoint or algo_version.entrypoint,
            payload.metadata or algo_version.metadata_,
            payload.package or algo_version.package,
        )

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


from app.schemas.tuning import TuningRequest, TuningResponse
from app.services.tuning import tuning_service

# ... (inside router)

@router.post("/tuning-jobs", response_model=TuningResponse, status_code=201)
def create_tuning_job(payload: TuningRequest) -> TuningResponse:
    try:
        group_id = tuning_service.start_tuning(
            project_id=payload.project_id,
            study_name=payload.study_name,
            algo_spec=payload.algo_spec,
            env_spec=payload.env_spec,
            search_space=payload.search_space,
            n_trials=payload.n_trials,
            metric=payload.metric,
            direction=payload.direction
        )
    except ValueError as exc:
        if str(exc) == "optuna_not_installed":
            raise HTTPException(status_code=503, detail="optuna_not_installed")
        raise
    return TuningResponse(group_id=group_id, message="Tuning started in background")

@router.get("/tuning/{study_name}")
def get_tuning_study(study_name: str):
    """
    Returns trials and importance for a study.
    """
    try:
        import optuna
    except Exception:
        raise HTTPException(status_code=503, detail="optuna_not_installed")
    from app.services.tuning import tuning_service
    
    try:
        study = optuna.load_study(study_name=study_name, storage=tuning_service.storage_url)
        trials = []
        for t in study.trials:
            if t.state.name == "COMPLETE":
                trials.append({
                    "number": t.number,
                    "value": t.value,
                    "params": t.params,
                    "state": t.state.name,
                    "datetime_start": t.datetime_start,
                    "datetime_complete": t.datetime_complete
                })
        
        # Calculate importance if possible
        importance = {}
        try:
            if len(trials) > 3:
                importance = optuna.importance.get_param_importances(study)
        except Exception:
            pass
            
        return {
            "study_name": study_name,
            "best_value": study.best_value if len(trials) > 0 else None,
            "best_params": study.best_params if len(trials) > 0 else None,
            "trials": trials,
            "importance": importance
        }
    except Exception as e:
        # If study doesn't exist yet, return empty
        return {"error": "study_not_found", "details": str(e)}

@router.post("/notebooks", response_model=NotebookResponse, status_code=201)
def create_notebook(payload: NotebookCreate, db: Session = Depends(get_db)) -> NotebookResponse:
    project = db.query(models.Project).filter(models.Project.id == payload.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    
    run = models.Run(
        project_id=project.id,
        name=payload.name or f"notebook-{datetime.now(timezone.utc).strftime('%H%M%S')}",
        type="NOTEBOOK",
        status="PENDING",
        algo="notebook",
        env="system",
        config={},
        metrics={}
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    
    job = models.Job(run_id=run.id, status="PENDING")
    db.add(job)
    db.commit()
    
    try:
        info = job_manager.start_notebook(run.id)
        return NotebookResponse(
            run_id=run.id,
            url=info.get("url", ""),
            token=info.get("token", "")
        )
    except Exception as e:
        db.delete(job)
        db.delete(run)
        db.commit()
        raise HTTPException(status_code=500, detail=f"notebook_start_failed:{str(e)}")


@router.delete("/notebooks/{run_id}", status_code=204)
def delete_notebook(run_id: str, db: Session = Depends(get_db)) -> Response:
    run = db.query(models.Run).filter(models.Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="notebook_not_found")
    
    job_manager.stop_notebook(run_id)
    # Cleanup DB record
    db.query(models.Job).filter(models.Job.run_id == run_id).delete()
    db.delete(run)
    db.commit()
    return Response(status_code=204)


@router.post("/train-jobs", response_model=TrainJobResponse, status_code=201)
def submit_train_job(payload: TrainJobRequest, db: Session = Depends(get_db)) -> TrainJobResponse:
    env_version = (
        db.query(models.EnvVersion)
        .filter(
            models.EnvVersion.env_id == payload.env.env_id,
            models.EnvVersion.version == payload.env.version,
        )
        .order_by(models.EnvVersion.active.desc(), models.EnvVersion.id.desc())
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
    run_git = payload.git.model_dump(by_alias=True) if payload.git else None
    if not run_git and algo_version and isinstance(algo_version.metadata_, dict):
        git_meta = algo_version.metadata_.get("git")
        if isinstance(git_meta, dict):
            run_git = git_meta
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
        name=f"train-{payload.project_id}-{datetime.now(timezone.utc).strftime('%H%M%S')}",
        type="TRAIN",
        status="PENDING",
        algo=algo_id,
        env=f"{payload.env.env_id}:{payload.env.version}",
        gpu=payload.resources.gpus,
        group_id=payload.group_id,
        config={
            "webhook_url": payload.webhook_url,
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
            "network": payload.network,
            "resources": payload.resources.model_dump(by_alias=True),
            "seedSet": payload.seed_set,
            "plugin": plugin_payload,
            "autoEval": payload.auto_eval.model_dump(by_alias=True) if payload.auto_eval else None,
            "git": run_git,
            "datasetId": payload.dataset_id,
        },
        metrics={"returnMean": [], "winRate": [], "entropy": []},
    )
    if run_git:
        run.git = run_git
        run.git_branch = run_git.get("branch")
        run.git_commit = run_git.get("commit")

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

    try:
        job_manager.submit(job.id)
    except ValueError as exc:
        if str(exc) == "job_queue_full":
            job.status = "CANCELED"
            job.message = "job_queue_full"
            run.status = "CANCELED"
            db.commit()
            raise HTTPException(status_code=429, detail="job_queue_full")
        raise
    return TrainJobResponse(run_id=run.id, job_id=job.id)


@router.get("/runs", response_model=List[RunSummary])
def list_runs(
    project_id: Optional[str] = None,
    type: Optional[str] = None,
    status: Optional[str] = None,
    group_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
) -> List[RunSummary]:
    query = db.query(models.Run).options(
        defer(models.Run.config),
        defer(models.Run.metrics),
        defer(models.Run.git),
    )
    if project_id:
        query = query.filter(models.Run.project_id == project_id)
    if type:
        query = query.filter(models.Run.type == type)
    if status:
        query = query.filter(models.Run.status == status)
    if group_id:
        query = query.filter(models.Run.group_id == group_id)
    
    offset = (page - 1) * page_size
    runs = query.order_by(models.Run.created.desc()).offset(offset).limit(page_size).all()
    # Manual construction to avoid Pydantic accessing deferred fields
    return [
        RunSummary(
            id=r.id,
            project_id=r.project_id,
            name=r.name,
            type=r.type,
            status=r.status,
            algo=r.algo,
            env=r.env,
            group_id=r.group_id,
            duration=r.duration,
            gpu=r.gpu,
            created=r.created,
            # Explicitly None to avoid loading deferred columns
            config=None,
            metrics=None,
            git=None
        )
        for r in runs
    ]


@router.get("/runs/{run_id}", response_model=Run)
def get_run(run_id: str, db: Session = Depends(get_db)) -> Run:
    run = db.query(models.Run).filter(models.Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    metrics_service.sync_run_metrics(db, run)
    return Run.model_validate(run)


@router.post("/runs/{run_id}/export-template", response_model=TemplateVersion, status_code=201)
def export_run_template(
    run_id: str,
    payload: RunExportTemplateRequest,
    db: Session = Depends(get_db),
) -> TemplateVersion:
    run = db.query(models.Run).filter(models.Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")

    algo_version_id = None
    if isinstance(run.config, dict):
        algo_cfg = run.config.get("algo")
        if isinstance(algo_cfg, dict):
            algo_version_id = algo_cfg.get("algoVersionId")
    if not algo_version_id and run.template_version_id:
        template_version = (
            db.query(models.TemplateVersion)
            .filter(models.TemplateVersion.id == run.template_version_id)
            .first()
        )
        if template_version:
            algo_version_id = template_version.algo_version_id
    if not algo_version_id:
        raise HTTPException(status_code=400, detail="algo_version_missing_in_run")

    def sanitize_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = dict(cfg)
        for key in [
            "resources",
            "autoEval",
            "seedSet",
            "resume",
            "resumeFrom",
            "resumePath",
            "datasetPath",
            "datasetFormat",
            "modelPath",
            "policySnapshots",
            "policySnapshotId",
            "protocolId",
            "policyMeta",
        ]:
            cleaned.pop(key, None)
        return cleaned

    default_config = sanitize_config(run.config or {}) if isinstance(run.config, dict) else {}

    template = None
    if payload.template_id:
        template = db.query(models.Template).filter(models.Template.id == payload.template_id).first()
        if not template:
            raise HTTPException(status_code=404, detail="template_not_found")
        if template.archived:
            raise HTTPException(status_code=400, detail="template_archived")
        if template.project_id != run.project_id:
            raise HTTPException(status_code=400, detail="template_project_mismatch")
    else:
        env_cfg = default_config.get("env") if isinstance(default_config.get("env"), dict) else {}
        api_mode = env_cfg.get("apiMode") or env_cfg.get("api_mode")
        algo_id = run.algo or ""
        is_multi = str(api_mode).lower() == "pettingzoo" or algo_id in {
            "mappo-marl",
            "qmix-marl",
            "vdn-marl",
            "mappo-rnn-marl",
            "qmix-rnn-marl",
        }
        template_name = payload.name or f"Exported {run.name}"
        template = models.Template(
            project_id=run.project_id,
            name=template_name,
            description=payload.description or f"Exported from run {run.id}",
            type="Multi-Agent" if is_multi else "Single-Agent",
            default_config=default_config,
        )
        db.add(template)
        db.commit()
        db.refresh(template)

    version_label = payload.version or f"export-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    version = models.TemplateVersion(
        template_id=template.id,
        algo_version_id=algo_version_id,
        version=version_label,
        default_config=default_config,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return TemplateVersion.model_validate(version)


@router.get("/runs/groups/{group_id}", response_model=RunGroupSummary)
def get_run_group_summary(group_id: str, db: Session = Depends(get_db)) -> RunGroupSummary:
    runs = (
        db.query(models.Run)
        .filter(models.Run.group_id == group_id)
        .order_by(models.Run.created.asc())
        .all()
    )
    if not runs:
        raise HTTPException(status_code=404, detail="group_not_found")

    status_counts: Dict[str, int] = {}
    metrics_bucket: Dict[str, List[float]] = {}
    best_run_for_metric: Dict[str, str] = {}
    best_value_for_metric: Dict[str, float] = {}
    items: List[RunGroupItem] = []

    def last_metric_value(values: Any) -> Optional[float]:
        if not isinstance(values, list) or not values:
            return None
        last = values[-1]
        if isinstance(last, dict):
            return last.get("value")
        return None

    for run in runs:
        metrics_service.sync_run_metrics(db, run)
        status_counts[run.status] = status_counts.get(run.status, 0) + 1

        seed_value: Optional[int] = None
        if isinstance(run.config, dict):
            seed_set = run.config.get("seedSet")
            if isinstance(seed_set, list) and seed_set:
                seed_value = seed_set[0]
            elif run.config.get("seed") is not None:
                try:
                    seed_value = int(run.config.get("seed"))
                except Exception:
                    seed_value = None

        final_metrics: Dict[str, float] = {}
        if isinstance(run.metrics, dict):
            for key, values in run.metrics.items():
                value = last_metric_value(values)
                if value is None:
                    continue
                final_metrics[key] = float(value)
                metrics_bucket.setdefault(key, []).append(float(value))
                # Track best run by max value
                current_best_value = best_value_for_metric.get(key)
                if current_best_value is None or float(value) > current_best_value:
                    best_value_for_metric[key] = float(value)
                    best_run_for_metric[key] = run.id

        items.append(
            RunGroupItem(
                id=run.id,
                name=run.name,
                status=run.status,
                created=run.created,
                algo=run.algo,
                env=run.env,
                seed=seed_value,
                metrics=final_metrics,
            )
        )

    import statistics
    import math

    metric_summaries: Dict[str, RunGroupMetricSummary] = {}
    t_critical_95 = {
        1: 12.706,
        2: 4.303,
        3: 3.182,
        4: 2.776,
        5: 2.571,
        6: 2.447,
        7: 2.365,
        8: 2.306,
        9: 2.262,
        10: 2.228,
        11: 2.201,
        12: 2.179,
        13: 2.160,
        14: 2.145,
        15: 2.131,
        16: 2.120,
        17: 2.110,
        18: 2.101,
        19: 2.093,
        20: 2.086,
        21: 2.080,
        22: 2.074,
        23: 2.069,
        24: 2.064,
        25: 2.060,
        26: 2.056,
        27: 2.052,
        28: 2.048,
        29: 2.045,
        30: 2.042,
    }
    for key, values in metrics_bucket.items():
        n = len(values)
        if n == 0:
            continue
        mean = statistics.mean(values)
        std = statistics.pstdev(values) if n > 1 else 0.0
        df = max(n - 1, 1)
        t_val = t_critical_95.get(df, 1.96)
        margin = t_val * (std / math.sqrt(n)) if n > 1 else 0.0
        ci_low = float(mean - margin)
        ci_high = float(mean + margin)
        metric_summaries[key] = RunGroupMetricSummary(
            mean=float(mean),
            std=float(std),
            min=float(min(values)),
            max=float(max(values)),
            n=n,
            best_run_id=best_run_for_metric.get(key),
            ci_low=ci_low,
            ci_high=ci_high,
        )

    return RunGroupSummary(
        group_id=group_id,
        total_runs=len(runs),
        status_counts=status_counts,
        metrics=metric_summaries,
        runs=items,
    )


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: str, db: Session = Depends(get_db)) -> Response:
    run = db.query(models.Run).filter(models.Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    
    # Delete associated jobs
    db.query(models.Job).filter(models.Job.run_id == run_id).delete()
    # Delete associated checkpoints
    db.query(models.Checkpoint).filter(models.Checkpoint.run_id == run_id).delete()
    # Delete associated artifacts (DB + object storage)
    artifact_service.delete_run_artifacts(db, run_id)
    
    # Delete run
    db.delete(run)
    db.commit()
    return Response(status_code=204)


@router.post("/runs/batch/delete", status_code=200)
def delete_runs_batch(payload: List[str], db: Session = Depends(get_db)) -> dict:
    run_ids = payload
    if not run_ids:
        return {"deleted": 0}
    
    # Delete associated jobs
    db.query(models.Job).filter(models.Job.run_id.in_(run_ids)).delete(synchronize_session=False)
    # Delete associated checkpoints
    db.query(models.Checkpoint).filter(models.Checkpoint.run_id.in_(run_ids)).delete(synchronize_session=False)
    # Delete associated artifacts (DB + object storage)
    for run_id in run_ids:
        artifact_service.delete_run_artifacts(db, run_id)
    # Delete associated eval results
    db.query(models.EvalResult).filter(models.EvalResult.run_id.in_(run_ids)).delete(synchronize_session=False)
    
    # Delete runs
    result = db.query(models.Run).filter(models.Run.id.in_(run_ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": result}


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
                "scenario_grid": protocol.scenario_grid,
                "opponent_sampling": protocol.opponent_sampling,
                "opponent_pool_ref": {
                    "pool_id": protocol.opponent_pool_id,
                    "version": protocol.opponent_pool_version,
                }
                if protocol.opponent_pool_id
                else None,
                "frozen": protocol.frozen,
                "created": protocol.created_at,
            }
        )
        )
    return results


@router.post("/eval-protocols", response_model=EvalProtocol, status_code=201)
def create_eval_protocol(payload: EvalProtocolCreate, db: Session = Depends(get_db)) -> EvalProtocol:
    _validate_env_ref(db, payload.env)
    _validate_scenario_grid(payload.scenario_grid)
    _validate_opponent_sampling(payload.opponent_sampling)
    if payload.opponent_pool_ref:
        _validate_opponent_pool_ref(db, payload.opponent_pool_ref)
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
        scenario_grid=payload.scenario_grid,
        opponent_sampling=payload.opponent_sampling,
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
            "scenario_grid": protocol.scenario_grid,
            "opponent_sampling": protocol.opponent_sampling,
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
            "scenario_grid": protocol.scenario_grid,
            "opponent_sampling": protocol.opponent_sampling,
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


@router.patch("/eval-protocols/{protocol_id}", response_model=EvalProtocol)
def update_eval_protocol(
    protocol_id: str,
    payload: EvalProtocolUpdate,
    db: Session = Depends(get_db),
) -> EvalProtocol:
    protocol = db.query(models.EvalProtocol).filter(models.EvalProtocol.id == protocol_id).first()
    if not protocol:
        raise HTTPException(status_code=404, detail="protocol_not_found")
    if protocol.frozen:
        raise HTTPException(status_code=400, detail="protocol_frozen")

    fields_set = payload.model_fields_set
    if "env" in fields_set:
        if payload.env is None:
            raise HTTPException(status_code=400, detail="env_required")
        _validate_env_ref(db, payload.env)
        protocol.env_id = payload.env.env_id
        protocol.env_version = payload.env.version
        protocol.map_set = payload.env.map_set
    if "name" in fields_set and payload.name is not None:
        protocol.name = payload.name
    if "eval_seeds" in fields_set and payload.eval_seeds is not None:
        protocol.eval_seeds = payload.eval_seeds
    if "episodes_per_match" in fields_set and payload.episodes_per_match is not None:
        protocol.episodes_per_match = payload.episodes_per_match
    if "timeout_sec" in fields_set:
        protocol.timeout_sec = payload.timeout_sec
    if "metrics" in fields_set:
        protocol.metrics = payload.metrics
    if "scenario_grid" in fields_set:
        _validate_scenario_grid(payload.scenario_grid)
        protocol.scenario_grid = payload.scenario_grid
    if "opponent_sampling" in fields_set:
        _validate_opponent_sampling(payload.opponent_sampling)
        protocol.opponent_sampling = payload.opponent_sampling
    if "opponent_pool_ref" in fields_set:
        if payload.opponent_pool_ref:
            _validate_opponent_pool_ref(db, payload.opponent_pool_ref)
            protocol.opponent_pool_id = payload.opponent_pool_ref.pool_id
            protocol.opponent_pool_version = payload.opponent_pool_ref.version
        else:
            protocol.opponent_pool_id = None
            protocol.opponent_pool_version = None

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
            "scenario_grid": protocol.scenario_grid,
            "opponent_sampling": protocol.opponent_sampling,
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
                    "scenario_grid": protocol.scenario_grid,
                    "opponent_sampling": protocol.opponent_sampling,
                    "opponent_pool_ref": {
                        "pool_id": protocol.opponent_pool_id,
                        "version": protocol.opponent_pool_version,
                    }
                    if protocol.opponent_pool_id
                    else None,
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
    if payload.scenario_grid is not None:
        _validate_scenario_grid(payload.scenario_grid)
    if payload.opponent_sampling is not None:
        _validate_opponent_sampling(payload.opponent_sampling)
    if payload.opponent_pool_ref:
        _validate_opponent_pool_ref(db, payload.opponent_pool_ref)
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
        scenario_grid=payload.scenario_grid if payload.scenario_grid is not None else base.scenario_grid,
        opponent_sampling=payload.opponent_sampling if payload.opponent_sampling is not None else base.opponent_sampling,
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
        name=f"eval-{payload.protocol_id}-{datetime.now(timezone.utc).strftime('%H%M%S')}",
        type="EVAL",
        status="PENDING",
        algo=settings.eval_algo_name,
        env=payload.protocol_id,
        config={
            "webhook_url": payload.webhook_url,
            "protocolId": payload.protocol_id, 
            "policySnapshotId": payload.policy_snapshot_id,
            "protocol": {
                "name": protocol.name,
                "version": protocol.version,
                "env": {
                    "envId": protocol.env_id,
                    "version": protocol.env_version or "",
                    "mapSet": protocol.map_set or "",
                },
                "evalSeeds": protocol.eval_seeds,
                "episodesPerMatch": protocol.episodes_per_match,
                "timeoutSec": protocol.timeout_sec,
                "metrics": protocol.metrics,
                "scenarioGrid": protocol.scenario_grid,
                "opponentSampling": protocol.opponent_sampling,
                "opponentPoolRef": {
                    "poolId": protocol.opponent_pool_id,
                    "version": protocol.opponent_pool_version,
                }
                if protocol.opponent_pool_id
                else None,
            },
            # We also need to inject the algo entrypoint info so the Runner knows what to load
            # The runner looks at `config.algo.entrypoint`.
            "algo": {
                "entrypoint": settings.eval_entrypoint,
                "name": settings.eval_algo_name
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

    try:
        job_manager.submit(job.id)
    except ValueError as exc:
        if str(exc) == "job_queue_full":
            job.status = "CANCELED"
            job.message = "job_queue_full"
            run.status = "CANCELED"
            db.commit()
            raise HTTPException(status_code=429, detail="job_queue_full")
        raise
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
        name=f"matrix-{payload.protocol_id}-{datetime.now(timezone.utc).strftime('%H%M%S')}",
        type="MATRIX",
        status="PENDING",
        algo=settings.matrix_algo_name,
        env=payload.protocol_id,
        config={
            "webhook_url": payload.webhook_url,
            "protocolId": payload.protocol_id,
            "policySnapshotIds": member_ids,
            "gamesPerPair": payload.games_per_pair,
            "poolId": pool_id,
            "metric": payload.metric,
            "algo": {
                "entrypoint": settings.matrix_entrypoint,
                "name": settings.matrix_algo_name,
            },
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

    try:
        job_manager.submit(job.id)
    except ValueError as exc:
        if str(exc) == "job_queue_full":
            job.status = "CANCELED"
            job.message = "job_queue_full"
            run.status = "CANCELED"
            db.commit()
            raise HTTPException(status_code=429, detail="job_queue_full")
        raise
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
        if not check_ws_token(websocket, db):
            await websocket.close(code=1008)
            return
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

    import tempfile
    buffer = tempfile.SpooledTemporaryFile(max_size=20 * 1024 * 1024)
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
    return ArtifactDownloadResponse(url=url, expires_at=(datetime.now(timezone.utc).isoformat()))


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


def _multipart_available() -> bool:
    try:
        from python_multipart import __version__ as multipart_version

        return bool(multipart_version)
    except Exception:
        try:
            from multipart.multipart import parse_options_header

            return parse_options_header is not None
        except Exception:
            return False


if _multipart_available():

    @router.post("/datasets/upload", response_model=Dataset, status_code=201)
    def upload_dataset(
        name: str = Form(...),
        format: str = Form("jsonl"),
        description: Optional[str] = Form(None),
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
    ) -> Dataset:
        dataset = dataset_service.create_dataset_from_upload(db, name, description, format, file)
        return Dataset.model_validate(dataset)

else:

    @router.post("/datasets/upload", status_code=503)
    def upload_dataset_unavailable() -> Dict[str, Any]:
        raise HTTPException(
            status_code=503,
            detail="python_multipart_not_installed",
        )


@router.get("/datasets/{dataset_id}/download")
def download_dataset(dataset_id: str, db: Session = Depends(get_db)):
    dataset = dataset_service.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="dataset_not_found")

    url = dataset_service.resolve_download_url(dataset)
    if url:
        return RedirectResponse(url=url)

    # Fall back to local file path.
    path = Path(dataset.path).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    if not path.exists():
        raise HTTPException(status_code=404, detail="dataset_file_missing")
    return FileResponse(path)


@router.get("/datasets/{dataset_id}/preview", response_model=DatasetPreview)
def preview_dataset(dataset_id: str, db: Session = Depends(get_db)) -> DatasetPreview:
    dataset = dataset_service.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="dataset_not_found")
    preview = dataset_service.build_preview(dataset)
    return DatasetPreview.model_validate(preview)


@router.post("/admin/webhooks", response_model=Webhook, status_code=201)
def create_webhook(payload: WebhookCreate, db: Session = Depends(get_db)) -> Webhook:
    webhook = models.Webhook(url=payload.url, events=payload.events, secret=payload.secret, active=True)
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    return Webhook.model_validate(webhook)


@router.post("/agentic/specs/validate", response_model=AgenticSpecValidationResponse)
def validate_agentic_spec(payload: AgenticIdeaInput) -> AgenticSpecValidationResponse:
    return agentic_os_service.validate_spec_input(payload)


@router.get("/agentic/approval-policy/templates", response_model=AgenticApprovalPolicyTemplateListResponse)
def list_agentic_approval_policy_templates() -> AgenticApprovalPolicyTemplateListResponse:
    payload = agentic_os_service.list_approval_policy_templates()
    rows = [AgenticApprovalPolicyTemplate.model_validate(item) for item in (payload.get("items") or [])]
    return AgenticApprovalPolicyTemplateListResponse(
        recommended_template_id=payload.get("recommendedTemplateId"),
        context_summary=payload.get("contextSummary") or {},
        items=rows,
    )


@router.post("/agentic/approval-policy/templates/suggest", response_model=AgenticApprovalPolicyTemplateListResponse)
def suggest_agentic_approval_policy_templates(payload: AgenticIdeaInput) -> AgenticApprovalPolicyTemplateListResponse:
    suggestion = agentic_os_service.list_approval_policy_templates(payload)
    rows = [AgenticApprovalPolicyTemplate.model_validate(item) for item in (suggestion.get("items") or [])]
    return AgenticApprovalPolicyTemplateListResponse(
        recommended_template_id=suggestion.get("recommendedTemplateId"),
        context_summary=suggestion.get("contextSummary") or {},
        items=rows,
    )


@router.get("/agentic/approvers", response_model=AgenticApproverListResponse)
def list_agentic_approvers() -> AgenticApproverListResponse:
    payload = agentic_os_service.list_approvers()
    rows = [AgenticApproverRecord.model_validate(item) for item in (payload.get("items") or [])]
    return AgenticApproverListResponse(
        strict_mode=bool(payload.get("strictMode")),
        total=int(payload.get("total") or len(rows)),
        items=rows,
    )


@router.post("/agentic/runs", response_model=AgenticRunCreateResponse, status_code=201)
def create_agentic_run(payload: AgenticRunCreateRequest) -> AgenticRunCreateResponse:
    detail = agentic_os_service.create_run(payload)
    return AgenticRunCreateResponse(run_id=detail.run_id, status=detail.status, detail=detail)


@router.get("/agentic/runs", response_model=AgenticListResponse)
def list_agentic_runs(page: int = 1, page_size: int = 20) -> AgenticListResponse:
    items, total = agentic_os_service.list_runs(page=page, page_size=page_size)
    return AgenticListResponse(page=page, page_size=page_size, total=total, items=items)


@router.get("/agentic/runs/{run_id}", response_model=AgenticRunDetail)
def get_agentic_run(run_id: str) -> AgenticRunDetail:
    try:
        return agentic_os_service.get_run_detail(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/agentic/runs/{run_id}/report", response_model=AgenticRunReportResponse)
def get_agentic_run_report(run_id: str) -> AgenticRunReportResponse:
    try:
        payload = agentic_os_service.get_run_report(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return AgenticRunReportResponse(
        run_id=run_id,
        generated_at=str(payload.get("generatedAt") or ""),
        report=payload.get("report") or {},
        markdown=str(payload.get("markdown") or ""),
        artifact_json_path=str(payload.get("artifactJsonPath") or ""),
        artifact_markdown_path=str(payload.get("artifactMarkdownPath") or ""),
    )


@router.get("/agentic/runs/{run_id}/sub-agents", response_model=AgenticSubAgentListResponse)
def list_agentic_sub_agents(
    run_id: str,
    page: int = 1,
    page_size: int = 50,
    node_id: Optional[str] = None,
    status: Optional[str] = None,
) -> AgenticSubAgentListResponse:
    try:
        items, total = agentic_os_service.list_sub_agents(
            run_id=run_id,
            page=page,
            page_size=page_size,
            node_id=node_id,
            status=status,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return AgenticSubAgentListResponse(run_id=run_id, page=page, page_size=page_size, total=total, items=items)


@router.post("/agentic/runs/{run_id}/execute", response_model=AgenticActionResponse)
def execute_agentic_run(run_id: str, payload: AgenticExecuteRequest) -> AgenticActionResponse:
    try:
        state = agentic_os_service.execute_run(run_id, payload)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    detail = agentic_os_service.get_run_detail(run_id)
    return AgenticActionResponse(ok=True, message=f"run_status={state.get('status')}", detail=detail)


@router.post("/agentic/runs/{run_id}/approvals", response_model=AgenticActionResponse)
def update_agentic_approvals(run_id: str, payload: AgenticApproveRequest) -> AgenticActionResponse:
    try:
        state = agentic_os_service.approve_actions(run_id, payload)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    detail = agentic_os_service.get_run_detail(run_id)
    return AgenticActionResponse(ok=True, message=f"approval_updated status={state.get('status')}", detail=detail)


@router.post("/agentic/runs/{run_id}/nodes/{node_id}/branch", response_model=AgenticActionResponse)
def add_agentic_branch(run_id: str, node_id: str, payload: AgenticBranchRequest) -> AgenticActionResponse:
    try:
        state = agentic_os_service.add_branch(run_id, node_id, payload)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    detail = agentic_os_service.get_run_detail(run_id)
    return AgenticActionResponse(ok=True, message=f"branch_added status={state.get('status')}", detail=detail)


@router.delete("/agentic/runs/{run_id}/nodes/{node_id}", response_model=AgenticActionResponse)
def delete_agentic_branch(run_id: str, node_id: str) -> AgenticActionResponse:
    try:
        state = agentic_os_service.delete_branch(run_id, node_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    detail = agentic_os_service.get_run_detail(run_id)
    return AgenticActionResponse(ok=True, message=f"branch_deleted status={state.get('status')}", detail=detail)


@router.post("/agentic/runs/{run_id}/recover", response_model=AgenticActionResponse)
def recover_agentic_run(run_id: str) -> AgenticActionResponse:
    try:
        state = agentic_os_service.recover_run(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    detail = agentic_os_service.get_run_detail(run_id)
    return AgenticActionResponse(ok=True, message=f"run_recovered status={state.get('status')}", detail=detail)


@router.post("/agentic/runs/{run_id}/matrix", response_model=AgenticMatrixResponse)
def generate_agentic_matrix(run_id: str, payload: AgenticMatrixRequest) -> AgenticMatrixResponse:
    try:
        matrix = agentic_os_service.build_matrix(run_id, payload)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return AgenticMatrixResponse(run_id=run_id, matrix=matrix)


@router.post("/agentic/runs/{run_id}/repro-bundle", response_model=AgenticReproResponse)
def export_agentic_repro_bundle(run_id: str) -> AgenticReproResponse:
    try:
        bundle = agentic_os_service.export_repro_bundle(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return AgenticReproResponse(run_id=run_id, bundle_path=bundle["bundle_path"], manifest=bundle["manifest"])


@router.get("/agentic/runs/{run_id}/audit-replay", response_model=AgenticAuditReplayResponse)
def replay_agentic_audit(run_id: str, upto_event_seq: Optional[int] = None) -> AgenticAuditReplayResponse:
    try:
        replay = agentic_os_service.replay_run(run_id, upto_event_seq=upto_event_seq)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return AgenticAuditReplayResponse(
        run_id=run_id,
        verified=bool(replay.get("verified")),
        checked_events=int(replay.get("checkedEvents") or 0),
        chain_head=replay.get("chainHead"),
        failure_reason=replay.get("failureReason"),
        replay=replay.get("replay") or {},
    )

@router.websocket("/runs/{run_id}/logs/stream")
async def stream_run_logs_ws(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    import random
    import asyncio
    
    db = SessionLocal()
    try:
        if not check_ws_token(websocket, db):
            await websocket.close(code=1008)
            return
    finally:
        db.close()
        
    try:
        step = 0
        while True:
            loss = max(0.01, round(0.5 * (0.9 ** (step / 10)) + random.uniform(-0.05, 0.05), 4))
            reward = round(10 + step * 0.5 + random.uniform(-2, 2), 2)
            log_line = f"Step {step}: Loss: {loss}, Reward: {reward}"
            await websocket.send_text(log_line)
            step += 1
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        return

from pydantic import BaseModel
class DemoJobRequest(BaseModel):
    env: str
    algo: str
    gpu: str

@router.post("/runs/demo-submit")
def submit_demo_job(payload: DemoJobRequest, db: Session = Depends(get_db)):
    import datetime, uuid
    run = models.Run(
        project_id="system",
        name=f"demo-{payload.algo}-{datetime.datetime.now().strftime('%H%M%S')}",
        type="TRAIN",
        status="RUNNING",
        algo=payload.algo,
        env=payload.env,
        gpu=int(payload.gpu) if payload.gpu.isdigit() else 0,
        config={"demo": True},
        metrics={}
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    
    job = models.Job(run_id=run.id, status="PENDING")
    db.add(job)
    db.commit()
    
    return {"run_id": run.id, "status": "success"}
