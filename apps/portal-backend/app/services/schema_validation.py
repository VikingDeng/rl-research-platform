from typing import Any, Dict, Iterable, Optional

from jsonschema import Draft7Validator, SchemaError


def _format_path(path_parts: Iterable[Any]) -> str:
    parts = []
    for part in path_parts:
        if isinstance(part, int):
            parts.append(f"[{part}]")
        else:
            parts.append(str(part))
    if not parts:
        return ""
    return ".".join(p for p in parts if p)


def validate_json_schema(schema: Dict[str, Any], payload: Dict[str, Any]) -> Optional[str]:
    try:
        Draft7Validator.check_schema(schema)
    except SchemaError as exc:
        return f"schema_invalid:{exc.message}"

    validator = Draft7Validator(schema)
    errors = sorted(validator.iter_errors(payload), key=lambda e: e.path)
    if not errors:
        return None

    first = errors[0]
    path = _format_path(first.path)
    if path:
        return f"{path}:{first.message}"
    return first.message


def validate_env_constraints(
    constraints: Dict[str, Any],
    env_id: str,
    env_version: str,
    api_mode: str,
    map_set: Optional[str],
) -> Optional[str]:
    allowed_envs = constraints.get("envIds") or constraints.get("env_ids")
    if isinstance(allowed_envs, list) and allowed_envs and env_id not in allowed_envs:
        return "env_not_allowed"

    allowed_versions = constraints.get("versions") or constraints.get("envVersions")
    if isinstance(allowed_versions, list) and allowed_versions and env_version not in allowed_versions:
        return "env_version_not_allowed"

    allowed_api_modes = constraints.get("apiModes") or constraints.get("api_modes")
    if isinstance(allowed_api_modes, list) and allowed_api_modes and api_mode not in allowed_api_modes:
        return "api_mode_not_allowed"

    allowed_map_sets = constraints.get("mapSets") or constraints.get("map_sets")
    if isinstance(allowed_map_sets, list) and allowed_map_sets and map_set and map_set not in allowed_map_sets:
        return "map_set_not_allowed"

    return None
