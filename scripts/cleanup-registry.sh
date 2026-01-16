#!/bin/sh
set -e

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"

if [ ! -d "$BACKEND_DIR" ]; then
  echo "Backend not found at $BACKEND_DIR"
  exit 1
fi

if [ -f "$BACKEND_DIR/.env" ]; then
  set -a
  . "$BACKEND_DIR/.env"
  set +a
fi

PYTHON="$BACKEND_DIR/.venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  PYTHON=python3
fi

PYTHONPATH="$BACKEND_DIR" "$PYTHON" - <<'PY'
from app.db import models
from app.db.session import SessionLocal


def main() -> None:
    db = SessionLocal()
    try:
        system_run_ids = [row[0] for row in db.query(models.Run.id).filter(models.Run.project_id == "system").all()]

        eval_results_deleted = db.query(models.EvalResult).delete(synchronize_session=False)
        matrix_results_deleted = db.query(models.MatrixResult).delete(synchronize_session=False)

        opponent_members_deleted = db.query(models.OpponentPoolMember).delete(synchronize_session=False)
        opponent_versions_deleted = db.query(models.OpponentPoolVersion).delete(synchronize_session=False)
        opponent_pools_deleted = db.query(models.OpponentPool).delete(synchronize_session=False)

        eval_protocols_deleted = db.query(models.EvalProtocol).delete(synchronize_session=False)

        db.query(models.Run).update(
            {models.Run.template_version_id: None},
            synchronize_session=False,
        )
        template_versions_deleted = db.query(models.TemplateVersion).delete(synchronize_session=False)
        templates_deleted = db.query(models.Template).delete(synchronize_session=False)

        checkpoints_deleted = 0
        artifacts_deleted = 0
        jobs_deleted = 0
        runs_deleted = 0
        if system_run_ids:
            checkpoints_deleted = (
                db.query(models.Checkpoint)
                .filter(models.Checkpoint.run_id.in_(system_run_ids))
                .delete(synchronize_session=False)
            )
            artifacts_deleted = (
                db.query(models.Artifact)
                .filter(models.Artifact.run_id.in_(system_run_ids))
                .delete(synchronize_session=False)
            )
            jobs_deleted = (
                db.query(models.Job)
                .filter(models.Job.run_id.in_(system_run_ids))
                .delete(synchronize_session=False)
            )
            runs_deleted = (
                db.query(models.Run)
                .filter(models.Run.id.in_(system_run_ids))
                .delete(synchronize_session=False)
            )

        system_project_deleted = db.query(models.Project).filter(models.Project.id == "system").delete(synchronize_session=False)

        db.commit()

        print("cleanup_registry: done")
        print(f"  eval_results_deleted={eval_results_deleted}")
        print(f"  matrix_results_deleted={matrix_results_deleted}")
        print(f"  opponent_members_deleted={opponent_members_deleted}")
        print(f"  opponent_versions_deleted={opponent_versions_deleted}")
        print(f"  opponent_pools_deleted={opponent_pools_deleted}")
        print(f"  eval_protocols_deleted={eval_protocols_deleted}")
        print(f"  template_versions_deleted={template_versions_deleted}")
        print(f"  templates_deleted={templates_deleted}")
        print(f"  system_project_deleted={system_project_deleted}")
        print(f"  system_runs_deleted={runs_deleted}")
        print(f"  system_jobs_deleted={jobs_deleted}")
        print(f"  system_checkpoints_deleted={checkpoints_deleted}")
        print(f"  system_artifacts_deleted={artifacts_deleted}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
PY
