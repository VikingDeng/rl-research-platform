from app.schemas.base import APIModel


class BootstrapCreated(APIModel):
    projects: int
    envs: int
    env_versions: int
    algos: int
    algo_versions: int
    templates: int
    template_versions: int


class BootstrapDefaults(APIModel):
    project_id: str
    env_id: str
    env_version: str
    algo_id: str
    algo_version_id: str
    template_id: str
    template_version_id: str


class BootstrapResponse(APIModel):
    created: BootstrapCreated
    defaults: BootstrapDefaults
