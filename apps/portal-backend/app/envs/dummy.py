from typing import Any, Dict


def make_env(env_id: str = "dummy", **kwargs: Any) -> Dict[str, Any]:
    return {"env_id": env_id, "kwargs": kwargs}
