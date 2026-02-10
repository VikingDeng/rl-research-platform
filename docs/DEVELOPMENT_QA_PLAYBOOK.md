# Development and QA Playbook

This document defines the default engineering workflow and quality gates for RL Research Platform.

## 1) Goal

- Keep every feature change shippable.
- Ensure core user flow is always verifiable on a clean machine.
- Make merge/release decisions based on deterministic checks, not manual confidence.

## 2) Standard Workflow

1. Create/confirm the feature scope and acceptance criteria.
2. Implement backend + frontend changes.
3. Add or update tests/scripts for the changed behavior.
4. Run quality gate locally.
5. Open PR only after local gate passes.

## 3) Definition of Done (DoD)

A change is done only if all items below are true:

- All related functionality is implemented end-to-end.
- `scripts/full-quality-gate.sh --full` passes locally.
- CI (`.github/workflows/ci.yml`) is green.
- Docs are updated for any changed workflow or configuration.

## 4) Required Test Commands

Quick local loop:

```bash
./scripts/full-quality-gate.sh --quick
```

If your machine has restricted npm install permissions, use prepared frontend assets and skip install explicitly:
```bash
FRONTEND_INSTALL_MODE=skip ./scripts/acceptance-check.sh
```

Full pre-PR gate:

```bash
./scripts/full-quality-gate.sh --full
```

Run only real API chain smoke:

```bash
./scripts/real-chain-smoke.sh
```

Assistant planner smoke:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/assistant/ideas \
  -H "Content-Type: application/json" \
  -d '{"idea":"Build a robust MAPPO baseline for SMAC with 3 variants","mode":"plan","maxRuns":3}' | jq
```

## 5) What the Full Gate Covers

`scripts/full-quality-gate.sh --full` executes:

- Python compile checks for backend and runner modules.
- `scripts/acceptance-check.sh --with-real-chain`:
  - compose config validation
  - frontend build
  - backend health (`/healthz`)
  - real chain smoke (project/env/algo/template/train/eval/matrix/pools/datasets/artifacts/repro bundle)
- Backend regression pytest set:
  - `tests/test_runner_integration.py::test_runner_integration`
  - `tests/test_platform_fixes.py::test_init_db_direct_sqlite_bootstrap_is_supported`
  - `tests/test_platform_fixes.py::test_artifact_manifest_written`
  - `tests/test_platform_fixes.py::test_matrix_materialization_includes_replay_payload`

## 6) CI Policy

CI must run the same full gate as local:

- Workflow: `.github/workflows/ci.yml`
- Command: `./scripts/full-quality-gate.sh --full`

If CI fails, merging is blocked.

## 7) Failure Handling

If full gate fails:

1. Read `stdout` and `.local/real-smoke/backend.log`.
2. Reproduce with the specific script (`acceptance-check` or `real-chain-smoke`).
3. Fix root cause and re-run full gate.
4. Do not bypass checks for demo convenience.

## 8) Release Checklist

Before tagging release/demo build:

1. Run `./scripts/full-quality-gate.sh --full`.
2. Verify CI green on target branch.
3. Record command output for audit/demo evidence.
4. Update release notes with behavior changes and known limits.

## 9) Registry Preflight Policy

- Always run registry preflight before saving new env/algo versions in production workspaces.
- In `Create Job`, treat preflight warnings about unfrozen versions and unpinned git commits as reproducibility risks.
- For paper/benchmark runs, freeze env/template/algo/plugin versions and pin git by commit hash.

## 10) Strict Failure Policy

- Live API mode is strict: frontend does not auto-downgrade to mock on backend failures.
- AI Assistant is fail-fast: no silent variant skipping, no implicit registry fallback creation.
- Eval pipeline is fail-fast: missing model artifact causes job failure (`eval_model_artifact_missing`), not silent fallback.
- Fix registry/config errors first, then rerun the same workflow.

## 11) Researcher Workflow Hardening

Use these APIs/UI panels as part of daily researcher workflow:

- Strict algorithm onboarding wizard:
```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/admin/algos/onboarding/strict \
  -H "Content-Type: application/json" \
  -d '{
    "algoId":"custom-ppo",
    "name":"Custom PPO",
    "version":"0.1.0",
    "entrypoint":"custom_algo:train",
    "code":"def train(config, **kwargs):\n    return {\"ok\": True}\n",
    "create": false
  }' | jq
```

- Run failure diagnosis:
```bash
curl -sS http://127.0.0.1:8000/api/v1/runs/<RUN_ID>/diagnosis | jq
```

- Reproducibility lock report:
```bash
curl -sS http://127.0.0.1:8000/api/v1/runs/<RUN_ID>/repro-lock | jq
```

Expected operating rule:

- If diagnosis has blockers, fix before re-launch.
- If repro lock is `UNLOCKED`, freeze versions/pin commit/seed before claiming benchmark quality.
