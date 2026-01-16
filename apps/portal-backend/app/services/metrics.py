import json
from pathlib import Path
from typing import Dict, List, Any

from sqlalchemy.orm import Session

from app.db import models
from app.services import paths


class MetricsService:
    def read_series(self, run_id: str) -> Dict[str, List[Dict[str, Any]]]:
        metrics_file = paths.metrics_path(run_id)
        if not metrics_file.exists():
            return {}
        return self._parse_metrics(metrics_file)

    def sync_run_metrics(self, db: Session, run: models.Run) -> Dict[str, List[Dict[str, Any]]]:
        series = self.read_series(run.id)
        if series:
            run.metrics = series
            db.commit()
            db.refresh(run)
        return series

    def read_raw(self, metrics_path: str) -> str:
        path = Path(metrics_path)
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")

    def _parse_metrics(self, path: Path) -> Dict[str, List[Dict[str, Any]]]:
        series: Dict[str, List[Dict[str, Any]]] = {
            "returnMean": [],
            "winRate": [],
            "entropy": [],
        }
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            step = payload.get("step")
            values = payload.get("values")
            if not isinstance(values, dict):
                values = {k: v for k, v in payload.items() if k != "step"}
            if step is None:
                continue
            for key, value in values.items():
                mapped = self._normalize_key(key)
                if mapped not in series:
                    series[mapped] = []
                series[mapped].append({"step": step, "value": value})
        return series

    def _normalize_key(self, key: str) -> str:
        if key == "return_mean":
            return "returnMean"
        if key == "win_rate":
            return "winRate"
        return key


metrics_service = MetricsService()
