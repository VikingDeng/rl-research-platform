import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse
from urllib.request import urlretrieve

from app.services import paths
from app.services.s3 import s3_client


@dataclass
class PluginRuntime:
    spec_path: Path
    python_path: Path


def prepare_runtime(run_id: str, plugin: Dict[str, Any], run_config: Dict[str, Any]) -> PluginRuntime:
    wheel_uri = plugin.get("wheelUri")
    sha256 = plugin.get("sha256")
    if not wheel_uri or not sha256:
        raise ValueError("plugin_wheel_missing")

    plugin_root = paths.plugin_dir(run_id) / plugin["pluginId"] / plugin["version"]
    plugin_root.mkdir(parents=True, exist_ok=True)
    wheel_path = _resolve_wheel(wheel_uri, plugin_root)
    _verify_sha256(wheel_path, sha256)

    install_dir = plugin_root / "site-packages"
    install_dir.mkdir(parents=True, exist_ok=True)
    marker = install_dir / ".installed"
    if not marker.exists() or marker.read_text(encoding="utf-8").strip() != sha256:
        _pip_install(wheel_path, install_dir)
        marker.write_text(sha256, encoding="utf-8")

    spec_path = paths.manifest_dir(run_id) / "plugin_runtime.json"
    spec_payload = {
        "plugin": plugin,
        "hooks": (plugin.get("manifest") or {}).get("hooks", {}),
        "runConfig": run_config,
    }
    spec_path.write_text(json.dumps(spec_payload, indent=2), encoding="utf-8")
    return PluginRuntime(spec_path=spec_path, python_path=install_dir)


def _resolve_wheel(wheel_uri: str, dest_dir: Path) -> Path:
    parsed = urlparse(wheel_uri)
    if parsed.scheme == "s3":
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        filename = Path(key).name
        dest = dest_dir / filename
        if not dest.exists():
            s3_client.download_file(bucket, key, str(dest))
        return dest
    if parsed.scheme in {"http", "https"}:
        filename = Path(parsed.path).name or "plugin.whl"
        dest = dest_dir / filename
        if not dest.exists():
            urlretrieve(wheel_uri, str(dest))
        return dest
    if parsed.scheme == "file":
        source = Path(parsed.path)
    else:
        source = Path(wheel_uri)
    if not source.exists():
        raise ValueError("plugin_wheel_not_found")
    dest = dest_dir / source.name
    if source.resolve() != dest.resolve():
        shutil.copy2(source, dest)
    return dest


def _verify_sha256(path: Path, expected: str) -> None:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual.lower() != expected.lower():
        raise ValueError("plugin_sha256_mismatch")


def _pip_install(wheel_path: Path, target: Path) -> None:
    env = os.environ.copy()
    env.setdefault("PYTHONNOUSERSITE", "1")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--no-deps",
            "--target",
            str(target),
            str(wheel_path),
        ],
        check=True,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
