import hashlib
import os
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional

from app.core.config import settings


@dataclass
class RuntimePackageSpec:
    python_path: Path
    packages: List[str]
    cache_key: str


def prepare_runtime(packages: Iterable[str]) -> Optional[RuntimePackageSpec]:
    normalized = _normalize_packages(packages)
    if not normalized:
        return None

    cache_root = Path(settings.runtime_cache_root).expanduser()
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_key = _cache_key(normalized)
    runtime_root = cache_root / cache_key
    site_packages = runtime_root / "site-packages"
    marker = runtime_root / ".installed"
    expected_marker = "\n".join(normalized)

    if marker.exists() and marker.read_text(encoding="utf-8").strip() == expected_marker:
        return RuntimePackageSpec(python_path=site_packages, packages=normalized, cache_key=cache_key)

    if not settings.runtime_auto_install:
        raise ValueError("runtime_packages_not_installed")

    site_packages.mkdir(parents=True, exist_ok=True)
    _pip_install(normalized, site_packages)
    marker.write_text(expected_marker, encoding="utf-8")
    return RuntimePackageSpec(python_path=site_packages, packages=normalized, cache_key=cache_key)


def _normalize_packages(packages: Iterable[str]) -> List[str]:
    normalized: List[str] = []
    for pkg in packages:
        if not pkg:
            continue
        value = str(pkg).strip()
        if value:
            normalized.append(value)
    return sorted(set(normalized))


def _cache_key(packages: List[str]) -> str:
    seed = "|".join(packages) + f"|py{sys.version_info.major}.{sys.version_info.minor}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return digest[:12]


def _pip_install(packages: List[str], target: Path) -> None:
    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--target",
        str(target),
    ]

    index_url = settings.runtime_pip_index_url
    if index_url:
        cmd.extend(["--index-url", index_url])

    extra_args = settings.runtime_pip_extra_args
    if extra_args:
        cmd.extend(shlex.split(extra_args))

    cmd.extend(packages)
    env = os.environ.copy()
    env.setdefault("PYTHONNOUSERSITE", "1")
    subprocess.run(cmd, check=True, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
