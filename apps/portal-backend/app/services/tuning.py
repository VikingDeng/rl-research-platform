import json
import time
import threading
from datetime import datetime
from typing import Dict, Any, List, Optional

try:
    import optuna
except Exception:
    optuna = None
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import SessionLocal
from app.core.config import settings
from app.schemas.runs import TrainJobRequest
from app.services.job_manager import job_manager
from app.api.deps import get_db # We can't use deps in thread, need new session

class TuningService:
    def __init__(self):
        # In-memory track of active tuning threads
        self._threads: Dict[str, threading.Thread] = {}
        self.available = optuna is not None
        # Storage URL for Optuna
        self.storage_url = settings.database_url.replace("+psycopg2", "") # Optuna uses standard sqlalchemy URLs

    def start_tuning(self, 
                     project_id: str, 
                     study_name: str, 
                     algo_spec: Dict[str, Any], 
                     env_spec: Dict[str, Any], 
                     search_space: Dict[str, Any], 
                     n_trials: int = 10,
                     metric: str = "winRate",
                     direction: str = "maximize"):
        if not self.available:
            raise ValueError("optuna_not_installed")
        
        # Create a parent "Group" run to hold these? 
        # Or just use a common group_id.
        group_id = f"tune-{datetime.utcnow().strftime('%H%M%S')}"
        
        thread = threading.Thread(
            target=self._tuning_loop,
            args=(project_id, study_name, group_id, algo_spec, env_spec, search_space, n_trials, metric, direction),
            daemon=True
        )
        self._threads[group_id] = thread
        thread.start()
        return group_id

    def _tuning_loop(self, project_id, study_name, group_id, algo_spec, env_spec, search_space, n_trials, metric, direction):
        print(f"[Tuning] Starting study {study_name} (Group: {group_id})")
        
        # 1. Create/Load Study
        study = optuna.create_study(
            study_name=study_name,
            storage=self.storage_url,
            direction=direction,
            load_if_exists=True
        )
        
        db = SessionLocal()
        
        try:
            for i in range(n_trials):
                # 2. Ask for params
                trial = study.ask()
                params = {}
                
                # Simple parsing of search space config
                # Expected format: {"lr": {"type": "loguniform", "low": 1e-5, "high": 1e-2}}
                for param_name, config in search_space.items():
                    ptype = config.get("type", "categorical")
                    if ptype == "categorical":
                        params[param_name] = trial.suggest_categorical(param_name, config["choices"])
                    elif ptype == "uniform":
                        params[param_name] = trial.suggest_float(param_name, config["low"], config["high"])
                    elif ptype == "loguniform":
                        params[param_name] = trial.suggest_float(param_name, config["low"], config["high"], log=True)
                    elif ptype == "int":
                        params[param_name] = trial.suggest_int(param_name, config["low"], config["high"])
                
                print(f"[Tuning] Trial {i+1}/{n_trials}: {params}")
                
                # 3. Construct Job
                # Merge params into train config or algo config?
                # Usually train config.
                base_train = algo_spec.get("train", {})
                merged_train = {**base_train, **params}
                
                # We need to construct the full request. 
                # This logic duplicates `submit_train_job` route logic slightly but we call internal helpers?
                # No, we can just insert DB records and submit to JobManager directly.
                
                # ... (Simplified Job Submission Logic mimicking routes.py) ...
                # Ideally we refactor `submit_train_job` to be a service method, but for now we manually build it.
                
                run_name = f"{study_name}-t{trial.number}"
                
                # 3.1 Create Run
                # Need to resolve Template/Algo IDs? 
                # Assume `algo_spec` has resolved IDs from the caller.
                
                run = models.Run(
                    project_id=project_id,
                    name=run_name,
                    type="TRAIN",
                    status="PENDING",
                    algo=algo_spec.get("algoId", "unknown"),
                    env=env_spec.get("envId", "unknown"),
                    group_id=group_id,
                    config={
                        "env": env_spec,
                        "algo": algo_spec,
                        "train": merged_train,
                        "resources": {"gpus": 1, "priority": 2}, # Default 1 GPU
                        # Mark as tuning trial
                        "tuning": {"trial": trial.number, "params": params}
                    },
                    metrics={}
                )
                db.add(run)
                db.commit()
                db.refresh(run)
                
                job = models.Job(run_id=run.id, status="PENDING", priority=3) # High priority for tuning
                db.add(job)
                db.commit()
                
                # 4. Submit
                job_manager.submit(job.id)
                
                # 5. Wait Loop
                final_metric = None
                while True:
                    db.expire(run) # Reload from DB
                    if run.status in ["SUCCEEDED", "FAILED", "CANCELED"]:
                        break
                    time.sleep(5)
                
                if run.status == "SUCCEEDED":
                    # Get metric from run.metrics (which is populated by finalize_job)
                    # Need to read series again?
                    # The `metrics` column in DB is JSON.
                    vals = run.metrics.get(metric, [])
                    if vals:
                        # Take last value or max/mean? Usually last or max.
                        # Let's take mean of last 5? Or just last.
                        final_metric = vals[-1]["value"]
                    else:
                        print(f"[Tuning] Warning: Metric {metric} not found in run {run.id}")
                        # Prune or fail?
                        final_metric = 0.0 # Fallback
                        
                    print(f"[Tuning] Trial {i+1} finished. {metric}={final_metric}")
                    study.tell(trial, final_metric)
                else:
                    print(f"[Tuning] Trial {i+1} failed/canceled.")
                    # Tell Optuna it failed? 
                    # study.tell(trial, state=optuna.trial.TrialState.FAIL)
                    # Optuna python API `tell` doesn't easily support FAIL state with value?
                    # We just skip telling or report a bad value.
                    study.tell(trial, -9999.0) # Penalty
                    
        except Exception as e:
            print(f"[Tuning] Exception: {e}")
            import traceback
            traceback.print_exc()
        finally:
            db.close()
            print(f"[Tuning] Group {group_id} finished.")

tuning_service = TuningService()
