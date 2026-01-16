import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


def generate_id() -> str:
    return uuid.uuid4().hex


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    git_repo: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    git_branch: Mapped[Optional[str]] = mapped_column(String, nullable=True, default="main")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Algo(Base):
    __tablename__ = "algos"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class AlgoVersion(Base):
    __tablename__ = "algo_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    algo_id: Mapped[str] = mapped_column(ForeignKey("algos.id"), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String, nullable=False)
    entrypoint: Mapped[str] = mapped_column(String, nullable=False)
    package: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    artifact_uri: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    config_schema: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    default_config: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    resource_profile: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    env_constraints: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    default_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    versions: Mapped[list["TemplateVersion"]] = relationship(back_populates="template", cascade="all, delete-orphan")


class TemplateVersion(Base):
    __tablename__ = "template_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    template_id: Mapped[str] = mapped_column(ForeignKey("templates.id"), nullable=False, index=True)
    algo_version_id: Mapped[Optional[str]] = mapped_column(ForeignKey("algo_versions.id"), nullable=True, index=True)
    version: Mapped[str] = mapped_column(String, nullable=False)
    default_config: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    network_template: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    env_constraints: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    wrappers: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    template: Mapped[Template] = relationship(back_populates="versions")


class EnvSpec(Base):
    __tablename__ = "envs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    versions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    maps: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class EnvVersion(Base):
    __tablename__ = "env_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    env_id: Mapped[str] = mapped_column(ForeignKey("envs.id"), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String, nullable=False)
    api_mode: Mapped[str] = mapped_column(String, nullable=False)
    entrypoint: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    package: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    default_image_digest: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    map_sets: Mapped[Optional[list[dict]]] = mapped_column(JSONB, nullable=True)
    scenario_schema: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Plugin(Base):
    __tablename__ = "plugins"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    name: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    author: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    installed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class PluginVersion(Base):
    __tablename__ = "plugin_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    plugin_id: Mapped[str] = mapped_column(ForeignKey("plugins.id"), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String, nullable=False)
    wheel_uri: Mapped[str] = mapped_column(String, nullable=False)
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    manifest: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    template_version_id: Mapped[Optional[str]] = mapped_column(ForeignKey("template_versions.id"), nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    algo: Mapped[str] = mapped_column(String, nullable=False)
    env: Mapped[str] = mapped_column(String, nullable=False)
    group_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    duration: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    gpu: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    git: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    git_branch: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    git_commit: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=2)  # 1=Low, 2=Normal, 3=High
    backend_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    executor: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    path: Mapped[str] = mapped_column(String, nullable=False)  # S3 path or local path
    format: Mapped[str] = mapped_column(String, nullable=False)  # e.g., 'jsonl', 'hdf5', 'd4rl'
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Checkpoint(Base):
    __tablename__ = "checkpoints"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), nullable=False, index=True)
    step: Mapped[int] = mapped_column(Integer, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    path: Mapped[str] = mapped_column(String, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EvalProtocol(Base):
    __tablename__ = "eval_protocols"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    protocol_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    version: Mapped[str] = mapped_column(String, nullable=False, default="1.0.0")
    name: Mapped[str] = mapped_column(String, nullable=False)
    env_id: Mapped[str] = mapped_column(String, nullable=False)
    env_version: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    map_set: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    eval_seeds: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False, default=list)
    episodes_per_match: Mapped[int] = mapped_column(Integer, nullable=False)
    timeout_sec: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    metrics: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String), nullable=True)
    opponent_pool_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    opponent_pool_version: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OpponentPool(Base):
    __tablename__ = "opponent_pools"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    pool_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[str] = mapped_column(String, nullable=False)
    env: Mapped[str] = mapped_column(String, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OpponentPoolVersion(Base):
    __tablename__ = "opponent_pool_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    pool_id: Mapped[str] = mapped_column(ForeignKey("opponent_pools.id"), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OpponentPoolMember(Base):
    __tablename__ = "opponent_pool_members"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    pool_id: Mapped[str] = mapped_column(ForeignKey("opponent_pools.id"), nullable=False, index=True)
    snapshot_id: Mapped[str] = mapped_column(String, nullable=False)


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    path: Mapped[str] = mapped_column(String, nullable=False)
    size: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    last_modified: Mapped[str] = mapped_column(String, nullable=False)
    object_key: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EvalResult(Base):
    __tablename__ = "eval_results"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    run_id: Mapped[Optional[str]] = mapped_column(ForeignKey("runs.id"), nullable=True)
    protocol_id: Mapped[str] = mapped_column(String, nullable=False)
    metrics: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    summary: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    ci: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    artifact_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class MatrixResult(Base):
    __tablename__ = "matrix_results"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    protocol_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    pool_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    cells: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
    labels: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String), nullable=True)
    matrix: Mapped[Optional[list[list[float]]]] = mapped_column(JSONB, nullable=True)
    ranking: Mapped[Optional[list[dict]]] = mapped_column(JSONB, nullable=True)
    meta: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    artifacts: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    summary: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    export_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_id)
    url: Mapped[str] = mapped_column(String, nullable=False)
    events: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    secret: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
