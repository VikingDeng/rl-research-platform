# RL Research Platform Disaster Recovery Runbook (One-Page)

## 1) Incident Types

- P0: Service unavailable (`/healthz` down, API 5xx spike, data corruption risk).
- P1: Partial degradation (jobs stuck, object store unavailable, one subsystem down).
- P2: Non-critical regression (UI glitches, delayed jobs, non-blocking failures).

## 2) First 10 Minutes

1. Freeze changes: stop deploys/merges.
2. Capture state:
   - `docker compose ps`
   - `docker compose logs --tail=200 rl-platform`
   - `docker compose logs --tail=200 postgres`
   - `docker compose logs --tail=200 minio`
3. Confirm blast radius:
   - API health: `curl -fsS http://127.0.0.1:8000/healthz`
   - Data plane: create/read one lightweight run artifact.
4. Communicate status and ETA to stakeholders.

## 3) Recovery Playbooks

### A) Backend/API crash loop

1. Validate config: `docker compose -f docker-compose.yml config -q`
2. Restart backend only: `docker compose up -d rl-platform`
3. If still failing, inspect startup log and roll back last config change.

### B) PostgreSQL failure

1. Check DB container: `docker compose ps postgres`
2. If DB volume corruption suspected, restore from backup.
3. Point backend to known-good DB snapshot and restart `rl-platform`.

### C) MinIO/S3 failure

1. Validate MinIO health and credentials.
2. Restore artifact volume or switch to standby bucket endpoint.
3. Re-run one run detail page validation (artifact list + replay access).

### D) Determined integration failure

1. Temporarily force local safe mode:
   - `EXECUTOR_MODE=local`
   - `LOCAL_EXECUTOR_MODE=mock`
2. Keep demo and CRUD paths available while external scheduler is repaired.

## 4) Backup and Restore Minimums

- PostgreSQL: daily logical dump + retained 7 days.
- MinIO artifacts: bucket snapshot/replication daily.
- Local run data (`runs_data/`): periodic tar backup for demo continuity.

Example restore order:
1. Restore DB snapshot.
2. Restore artifacts bucket/volume.
3. Start stack (`docker compose up -d`).
4. Run `scripts/acceptance-check.sh`.

## 5) Exit Criteria (Recovery Complete)

- `/healthz` stable for 10+ minutes.
- Dashboard, Run Detail, Matrix and Opponent Pools render without API errors.
- One replay asset opens or exports successfully.
- Acceptance script returns all PASS.
