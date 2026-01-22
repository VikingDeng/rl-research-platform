from typing import Any, Dict, List, Optional
import importlib
import os
from pathlib import Path
import shutil


def make_env(
    env_id: Optional[str] = None,
    map_set: Optional[str] = None,
    map_sets: Optional[List[Dict[str, Any]]] = None,
    maps: Optional[List[str]] = None,
) -> Any:
    """
    OrbitZoo env factory. Requires OrbitZoo + its dependencies installed.
    """
    orbitzoo = None
    try:
        orbitzoo = importlib.import_module("orbitzoo")
    except Exception:
        try:
            orbitzoo = importlib.import_module("orbit_zoo")
        except Exception as exc:
            raise ImportError(
                "orbitzoo_not_installed: run scripts/install-orbitzoo.sh for conda setup"
            ) from exc

    orekit_zip = os.getenv("ORBITZOO_OREKIT_DATA_ZIP")
    if orekit_zip and Path(orekit_zip).is_file():
        local_zip = Path.cwd() / "orekit-data.zip"
        if not local_zip.exists():
            shutil.copy(orekit_zip, local_zip)

    selected = None
    if maps:
        selected = maps[0]
    if not selected and map_set and map_sets:
        for entry in map_sets:
            if entry.get("id") == map_set:
                candidate = entry.get("maps") or []
                if candidate:
                    selected = candidate[0]
                    break
    if not selected:
        selected = env_id or "default"

    factory = getattr(orbitzoo, "make_env", None) or getattr(orbitzoo, "make", None)
    if not callable(factory):
        raise RuntimeError("orbitzoo_factory_missing")

    return factory(selected)
