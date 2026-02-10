# AI Lab Assistant Workflow

This document describes the built-in assistant that converts one plain-text research idea into executable train-job chains.

## 1) What It Does

- Reads an idea and picks active registry assets (project/env/algo/template).
- Generates a multi-run plan (baseline + controlled variants).
- Runs train preflight for each variant.
- Optionally submits all planned runs directly to the real backend queue.

### Strict Failure Policy

- Assistant uses **fail-fast** behavior: it does not silently skip failed variants.
- If any plan preflight fails, the API returns an error with `reason` + `hint`.
- If execute mode fails on a variant submission, the API stops immediately and returns fix guidance.
- Assistant does not auto-create project/template as fallback. Registry issues must be fixed explicitly.

## 2) Files Backing the Assistant

- Agent profile: `assistant/AGENT.md`
- Skill profiles:
  - `assistant/skills/research_planner.md`
  - `assistant/skills/repro_guardian.md`

The API response returns which skill/profile path was used for the plan.

## 3) UI Entry

- Sidebar: **AI Lab Assistant**
- Route: `/assistant`

Use:
1. Enter idea.
2. Choose `Plan Only` or `Plan + Execute`.
3. Choose skill profile and run count.
4. Generate plan or directly submit.

## 4) API

Endpoint:

```text
POST /api/v1/assistant/ideas
```

Sample request:

```json
{
  "idea": "Build a robust MAPPO baseline for SMAC with 3 controlled variants.",
  "mode": "execute",
  "projectId": "<your_project_id>",
  "skillProfile": "repro_guardian",
  "maxRuns": 3
}
```

## 5) Local Verification Commands

Assistant endpoint smoke test:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/assistant/ideas \
  -H "Content-Type: application/json" \
  -d '{
    "idea":"Build a robust MAPPO baseline for SMAC with 3 variants",
    "mode":"plan",
    "maxRuns":3
  }' | jq
```

Full quality gate:

```bash
./scripts/full-quality-gate.sh --full
```
