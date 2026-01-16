from datetime import datetime
from typing import List, Optional

from app.schemas.base import APIModel


class ProjectBase(APIModel):
    name: str
    description: Optional[str] = None
    tags: List[str] = []
    git_repo: Optional[str] = None
    git_branch: Optional[str] = "main"


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(APIModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    git_repo: Optional[str] = None
    git_branch: Optional[str] = None


class Project(ProjectBase):
    id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    active_runs: Optional[int] = None
    total_runs: Optional[int] = None
