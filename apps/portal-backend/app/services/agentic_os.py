from __future__ import annotations

import copy
import difflib
import hashlib
import json
import math
import os
import platform
import fnmatch
import random
import re
import shlex
import subprocess
import traceback
import uuid
import zipfile
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import yaml

try:
    import fcntl
except ImportError:
    fcntl = None

from app.core.config import settings
from app.schemas.agentic_os import (
    AgenticApproveRequest,
    AgenticBranchRequest,
    AgenticContractReport,
    AgenticExecuteRequest,
    AgenticIdeaInput,
    AgenticMatrixRequest,
    AgenticNode,
    AgenticNodeRunRecord,
    AgenticLlmTraceRecord,
    AgenticRunCreateRequest,
    AgenticRunDetail,
    AgenticRunSummary,
    AgenticSearchStats,
    AgenticSubAgentRecord,
    AgenticSpecValidationResponse,
)

UTC = timezone.utc


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _now_iso() -> str:
    return _now().isoformat()


def _stable_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9_]+", str(text).lower()))


def _short(text: str, limit: int = 220) -> str:
    stripped = " ".join(str(text).strip().split())
    if len(stripped) <= limit:
        return stripped
    return stripped[: limit - 3] + "..."


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def _write_jsonl(path: Path, rows: Sequence[Dict[str, Any]]) -> None:
    lines = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    _atomic_write_text(path, lines, encoding="utf-8")


def _atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    tmp_path.write_text(content, encoding=encoding)
    os.replace(tmp_path, path)


class AgenticOSService:
    REQUIRED_CONTRACT_ITEMS: Tuple[str, ...] = (
        "spec/research_spec.json",
        "spec/root_config_draft.yaml",
        "spec/eval_protocol_draft.yaml",
        "spec/risk_statement.md",
        "tot/tree.json",
        "timeline/events.jsonl",
        "timeline/timeline.json",
        "artifacts/config_resolved.json",
        "artifacts/env_summary.json",
        "artifacts/metrics.json",
        "artifacts/diagnostics.json",
        "artifacts/runtime_execution.json",
        "artifacts/sub_agents.json",
        "artifacts/node_runs.json",
        "artifacts/llm_traces.jsonl",
        "artifacts/run_report.json",
        "artifacts/run_report.md",
        "artifacts/error_report.json",
        "artifacts/log.txt",
        "artifacts/ckpt/",
        "manifest/git_info.json",
        "manifest/env_snapshot.json",
        "manifest/dependency_summary.txt",
        "manifest/decision_snapshot.json",
        "audit/audit_log.jsonl",
        "audit/replay_report.json",
        "repro_bundle/reproduce.sh",
    )

    HIGH_RISK_ACTIONS: Tuple[str, ...] = (
        "external_dependency_install",
        "unknown_script_execution",
        "data_exfiltration",
    )
    KNOWN_ACTIONS: Tuple[str, ...] = (
        "external_dependency_install",
        "unknown_script_execution",
        "data_exfiltration",
        "switch_offline_stub",
        "reduce_scope",
        "retry_with_debug",
    )
    APPROVER_ROLES: Tuple[str, ...] = ("admin", "ops", "security")
    APPROVAL_MODES: Tuple[str, ...] = ("strict", "balanced", "permissive")
    MAX_SUB_AGENT_DEPTH: int = 2
    CODE_MUTATION_EXTENSIONS: Tuple[str, ...] = (
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".go",
        ".rs",
        ".c",
        ".cc",
        ".cpp",
        ".java",
    )
    DISALLOWED_MUTATION_KINDS: Tuple[str, ...] = (
        "hyperparameter",
        "hyper_parameter",
        "hparam",
        "hparams",
        "config",
        "config_tuning",
        "sweep",
    )
    CODE_CHANGE_KEYWORDS: Tuple[str, ...] = (
        "code",
        "source",
        "patch",
        "diff",
        "function",
        "module",
        "class",
        "method",
        "encoder",
        "decoder",
        "head",
        "adapter",
        "objective",
        "loss",
        "architecture",
        "mutation",
        "refactor",
    )

    def __init__(self) -> None:
        run_root = Path(settings.local_run_root).expanduser()
        if not run_root.is_absolute():
            run_root = (Path.cwd() / run_root).resolve()

        self.root = run_root.parent / "agentic_os"
        self.runs_root = self.root / "runs"
        self.registry_path = self.root / "runs.jsonl"
        self.root.mkdir(parents=True, exist_ok=True)
        self.runs_root.mkdir(parents=True, exist_ok=True)
        self.registry_path.touch(exist_ok=True)
        self.workspace_root = self._detect_workspace_root()
        self._ensure_schema_and_examples()

    def _detect_workspace_root(self) -> Path:
        for parent in Path(__file__).resolve().parents:
            if (parent / "MLE").exists() and (parent / "rl-research-platform").exists():
                return parent
        return Path.cwd()

    def _ensure_schema_and_examples(self) -> None:
        docs_root = self.workspace_root / "docs"
        schema_dir = docs_root / "schemas"
        examples_dir = docs_root / "examples"
        schema_dir.mkdir(parents=True, exist_ok=True)
        examples_dir.mkdir(parents=True, exist_ok=True)

        schema_path = schema_dir / "research_spec.schema.json"
        schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": "ResearchSpec",
            "type": "object",
            "required": [
                "schemaVersion",
                "specId",
                "title",
                "taskGoal",
                "environment",
                "successMetrics",
                "budget",
                "constraints",
            ],
            "properties": {
                "schemaVersion": {"type": "string"},
                "specId": {"type": "string"},
                "title": {"type": "string"},
                "taskGoal": {"type": "string"},
                "environment": {
                    "type": "object",
                    "required": ["name", "dataSources"],
                    "properties": {
                        "name": {"type": "string"},
                        "dataSources": {"type": "array", "items": {"type": "string"}},
                    },
                },
                "successMetrics": {"type": "object"},
                "budget": {
                    "type": "object",
                    "required": ["gpuHours", "wallclockMinutes"],
                    "properties": {
                        "gpuHours": {"type": "number", "minimum": 0},
                        "wallclockMinutes": {"type": "integer", "minimum": 1},
                    },
                },
                "constraints": {
                    "type": "object",
                    "properties": {
                        "compliance": {"type": "array", "items": {"type": "string"}},
                        "forbiddenActions": {"type": "array", "items": {"type": "string"}},
                        "allowNetwork": {"type": "boolean"},
                        "allowDependencyInstall": {"type": "boolean"},
                    },
                },
                "execution": {
                    "type": "object",
                    "properties": {
                        "mode": {"type": "string", "enum": ["offline_stub", "local_shell", "mle_runner"]},
                        "localCommand": {"type": ["string", "null"]},
                    },
                },
                "subAgentPolicy": {
                    "type": "object",
                    "properties": {
                        "enabled": {"type": "boolean"},
                        "maxDepth": {"type": "integer", "minimum": 1, "maximum": 4},
                        "maxPerNode": {"type": "integer", "minimum": 1, "maximum": 8},
                        "maxTotal": {"type": "integer", "minimum": 1, "maximum": 64},
                        "timeoutMs": {"type": "integer", "minimum": 50, "maximum": 10000},
                    },
                },
                "approvalPolicy": {
                    "type": "object",
                    "properties": {
                        "mode": {"type": "string", "enum": ["strict", "balanced", "permissive"]},
                        "highRiskActions": {"type": "array", "items": {"type": "string"}},
                        "blockedActionRoles": {"type": "array", "items": {"type": "string"}},
                        "highRiskActionRoles": {"type": "array", "items": {"type": "string"}},
                        "requireApprovalForUnknownActions": {"type": "boolean"},
                        "minApprovals": {"type": "integer", "minimum": 1, "maximum": 3},
                        "requireDistinctRoles": {"type": "boolean"},
                        "approvalTtlMinutes": {"type": "integer", "minimum": 5, "maximum": 10080},
                    },
                },
                "llmPolicy": {
                    "type": "object",
                    "properties": {
                        "planning": {"type": "boolean"},
                        "coding": {"type": "boolean"},
                        "experiment": {"type": "boolean"},
                        "review": {"type": "boolean"},
                        "safety": {"type": "boolean"},
                    },
                },
                "git": {
                    "type": "object",
                    "properties": {
                        "repo": {"type": ["string", "null"]},
                        "branch": {"type": ["string", "null"]},
                        "commit": {"type": ["string", "null"]},
                    },
                },
                "requestedActions": {"type": "array", "items": {"type": "string"}},
                "generatedAt": {"type": "string"},
                "offlineMode": {"type": "boolean"},
            },
        }
        schema_path.write_text(json.dumps(schema, indent=2, ensure_ascii=False), encoding="utf-8")

        idea_sample_path = examples_dir / "idea_input.json"
        if not idea_sample_path.exists():
            sample = {
                "title": "SMAC win-rate lift under budget",
                "taskGoal": "Improve SMAC 3s5z win rate by at least 5% while keeping GPU cost bounded.",
                "environment": "pettingzoo.smac_v2:3s5z",
                "dataSources": ["registry://baseline_runs", "s3://marl-datasets/smac/3s5z"],
                "successMetrics": {"winRate": ">=0.62", "eloLift": ">=35"},
                "budget": {"gpuHours": 4, "wallclockMinutes": 180},
                "constraints": {
                    "compliance": ["no_pii", "no_external_data_push"],
                    "forbiddenActions": ["data_exfiltration"],
                    "allowNetwork": False,
                    "allowDependencyInstall": False,
                },
                "executionMode": "offline_stub",
                "localCommand": None,
                "subAgentPolicy": {
                    "enabled": True,
                    "maxDepth": 2,
                    "maxPerNode": 3,
                    "maxTotal": 24,
                    "timeoutMs": 1500,
                },
                "llmPolicy": {
                    "planning": True,
                    "coding": True,
                    "experiment": True,
                    "review": True,
                    "safety": True,
                },
                "approvalPolicy": {
                    "mode": "balanced",
                    "highRiskActions": ["unknown_script_execution"],
                    "blockedActionRoles": ["admin", "security"],
                    "highRiskActionRoles": ["admin", "ops", "security"],
                    "requireApprovalForUnknownActions": True,
                    "minApprovals": 1,
                    "requireDistinctRoles": False,
                    "approvalTtlMinutes": 120,
                },
                "requestedActions": ["unknown_script_execution"],
            }
            idea_sample_path.write_text(json.dumps(sample, indent=2, ensure_ascii=False), encoding="utf-8")

        rules_path = schema_dir / "approval_policy_rules.yaml"
        if not rules_path.exists():
            rules_path.write_text(
                yaml.safe_dump(self._default_approval_policy_rules(), sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )

        execution_rules_path = schema_dir / "execution_policy_rules.yaml"
        if not execution_rules_path.exists():
            execution_rules_path.write_text(
                yaml.safe_dump(self._default_execution_policy_rules(), sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )

        runtime_rules_path = schema_dir / "agentic_runtime_rules.yaml"
        if not runtime_rules_path.exists():
            runtime_rules_path.write_text(
                yaml.safe_dump(self._default_runtime_rules(), sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )

        spec_rules_path = schema_dir / "spec_generation_rules.yaml"
        if not spec_rules_path.exists():
            spec_rules_path.write_text(
                yaml.safe_dump(self._default_spec_generation_rules(), sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )

        approver_registry_path = schema_dir / "approver_registry.yaml"
        if not approver_registry_path.exists():
            approver_registry_path.write_text(
                yaml.safe_dump(self._default_approver_registry(), sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )

    @property
    def schema_path(self) -> Path:
        return self.workspace_root / "docs" / "schemas" / "research_spec.schema.json"

    @property
    def approval_policy_rules_path(self) -> Path:
        return self.workspace_root / "docs" / "schemas" / "approval_policy_rules.yaml"

    @property
    def execution_policy_rules_path(self) -> Path:
        return self.workspace_root / "docs" / "schemas" / "execution_policy_rules.yaml"

    @property
    def runtime_rules_path(self) -> Path:
        return self.workspace_root / "docs" / "schemas" / "agentic_runtime_rules.yaml"

    @property
    def spec_generation_rules_path(self) -> Path:
        return self.workspace_root / "docs" / "schemas" / "spec_generation_rules.yaml"

    @property
    def approver_registry_path(self) -> Path:
        return self.workspace_root / "docs" / "schemas" / "approver_registry.yaml"

    def validate_spec_input(self, idea: AgenticIdeaInput) -> AgenticSpecValidationResponse:
        self._assert_llm_ready()
        normalized_spec = self._build_research_spec(idea)
        root_config = self._build_root_config_draft(normalized_spec)
        eval_protocol = self._build_eval_protocol_draft(normalized_spec)
        risk_statement = self._build_risk_statement(normalized_spec)
        retrieval = self.retrieve_context(
            query=f"plan generation {idea.task_goal} {idea.environment}",
            k=4,
        )
        return AgenticSpecValidationResponse(
            valid=True,
            normalized_spec=normalized_spec,
            root_config_draft=root_config,
            eval_protocol_draft=eval_protocol,
            risk_statement=risk_statement,
            retrieval_context=retrieval,
        )

    def create_run(self, payload: AgenticRunCreateRequest) -> AgenticRunDetail:
        self._assert_llm_ready()
        validation = self.validate_spec_input(payload.idea)
        run_id = f"agentic-{_now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        run_dir = self.runs_root / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        now_iso = _now_iso()
        nodes = self._build_tot_tree(validation.normalized_spec)
        state: Dict[str, Any] = {
            "run_id": run_id,
            "webhook_url": payload.webhook_url,
            "created_at": now_iso,
            "updated_at": now_iso,
            "status": "PENDING",
            "idea": payload.idea.model_dump(by_alias=True),
            "research_spec": validation.normalized_spec,
            "root_config_draft": validation.root_config_draft,
            "eval_protocol_draft": validation.eval_protocol_draft,
            "risk_statement": validation.risk_statement,
            "tot_tree": nodes,
            "sub_agents": [],
            "node_runs": [],
            "timeline": [],
            "events": [],
            "pending_approvals": [],
            "approved_actions": [],
            "matrix": None,
            "repro_bundle": None,
            "failure_reason": None,
            "failure_history": [],
            "induce_failure": bool(payload.induce_failure),
            "failure_injected": False,
            "retrieval_context": validation.retrieval_context,
            "git_info": self._resolve_git_context(validation.normalized_spec.get("git")),
            "audit_chain": {"seq": 0, "last_hash": "GENESIS"},
            "idempotency": {},
        }

        self._bootstrap_run_files(run_dir, state)
        self._append_event(state, event="run_created", message="Agentic run initialized", payload={"run_id": run_id})
        self._persist_state(run_id, state)
        self._sync_contract_and_registry(run_id)

        if payload.auto_execute:
            state = self.execute_run(run_id, AgenticExecuteRequest(mode="all"))

        return self.get_run_detail(run_id)

    def list_runs(self, page: int = 1, page_size: int = 20) -> Tuple[List[AgenticRunSummary], int]:
        page = max(1, int(page))
        page_size = max(1, min(int(page_size), 200))
        with self._file_lock(self._registry_lock_path()):
            records = _read_jsonl(self.registry_path)
        records.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        total = len(records)
        offset = max(0, (page - 1) * page_size)
        window = records[offset : offset + page_size]
        items = [
            AgenticRunSummary(
                run_id=str(row.get("run_id")),
                title=str(row.get("title") or "Agentic Run"),
                objective=str(row.get("objective") or ""),
                status=str(row.get("status") or "UNKNOWN"),
                created_at=self._parse_dt(row.get("created_at")),
                updated_at=self._parse_dt(row.get("updated_at")),
                contract_pass_rate=float(row.get("contract_pass_rate") or 0.0),
                failure_reason=row.get("failure_reason"),
            )
            for row in window
        ]
        return items, total

    def list_approval_policy_templates(self, idea: Optional[AgenticIdeaInput] = None) -> Dict[str, Any]:
        rules = self._load_approval_policy_rules()
        rules_version = str(rules.get("version") or "1.0")
        rules_hash = _stable_hash(rules)
        templates_cfg = rules.get("templates") or {}
        if not isinstance(templates_cfg, dict) or not templates_cfg:
            templates_cfg = self._default_approval_policy_rules().get("templates") or {}

        weights = rules.get("riskWeights") or {}
        baseline_high_risk = [
            str(v).strip()
            for v in (rules.get("baselineHighRiskActions") or list(self.HIGH_RISK_ACTIONS))
            if str(v).strip()
        ]
        context = self._approval_context_from_idea(idea, baseline_high_risk=baseline_high_risk)
        score = self._approval_risk_score(context, weights)

        mode_thresholds = []
        for template_id, row in templates_cfg.items():
            if not isinstance(row, dict):
                continue
            min_score = int(row.get("minRiskScore") or 0)
            mode_thresholds.append((min_score, str(template_id)))
        mode_thresholds.sort(key=lambda item: item[0])

        recommended_template_id = "balanced" if "balanced" in templates_cfg else (mode_thresholds[0][1] if mode_thresholds else "")
        if idea is not None:
            for min_score, template_id in mode_thresholds:
                if score >= min_score:
                    recommended_template_id = template_id
        if context["blockedRequestedActions"] and "strict" in templates_cfg:
            recommended_template_id = "strict"
        if recommended_template_id not in templates_cfg and mode_thresholds:
            recommended_template_id = mode_thresholds[-1][1]

        all_high_risk = set(baseline_high_risk)
        all_high_risk.update(context["requestedHighRiskActions"])
        all_high_risk.update(context["unknownActions"])

        items: List[Dict[str, Any]] = []
        for template_id, row in templates_cfg.items():
            if not isinstance(row, dict):
                continue
            mode = str(row.get("mode") or template_id).lower().strip()
            policy = self._normalize_approval_policy(
                {
                    "mode": mode,
                    "highRiskActions": sorted(all_high_risk),
                    "blockedActionRoles": row.get("blockedActionRoles") or [],
                    "highRiskActionRoles": row.get("highRiskActionRoles") or [],
                    "requireApprovalForUnknownActions": row.get("requireApprovalForUnknownActions"),
                    "minApprovals": row.get("minApprovals"),
                    "requireDistinctRoles": row.get("requireDistinctRoles"),
                    "approvalTtlMinutes": row.get("approvalTtlMinutes"),
                }
            )
            label = str(row.get("label") or template_id.title())
            description = str(row.get("description") or "")
            rationale = self._build_template_rationale(
                template_id=str(template_id),
                context=context,
                score=score,
                min_score=int(row.get("minRiskScore") or 0),
            )
            items.append(
                {
                    "templateId": str(template_id),
                    "label": label,
                    "description": description,
                    "rationale": rationale,
                    "policy": policy,
                    "recommended": str(template_id) == str(recommended_template_id),
                }
            )

        items.sort(key=lambda row: str(row.get("templateId")))
        return {
            "recommendedTemplateId": recommended_template_id,
            "contextSummary": {
                "riskScore": score,
                "policyRulesVersion": rules_version,
                "policyRulesHash": rules_hash,
                **context,
            },
            "items": items,
        }

    def list_approvers(self) -> Dict[str, Any]:
        registry = self._load_approver_registry()
        items = list(registry.get("items") or [])
        items.sort(key=lambda row: (str(row.get("actorId") or ""), str(",".join(row.get("roles") or []))))
        return {
            "strictMode": bool(registry.get("strictMode")),
            "total": len(items),
            "items": items,
        }

    def list_sub_agents(
        self,
        run_id: str,
        page: int = 1,
        page_size: int = 50,
        node_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Tuple[List[AgenticSubAgentRecord], int]:
        page = max(1, int(page))
        page_size = max(1, min(int(page_size), 200))
        state = self._load_state(run_id)
        rows = list(state.get("sub_agents") or [])

        if node_id:
            rows = [row for row in rows if str(row.get("parentNodeId") or "") == str(node_id)]
        if status:
            target = str(status).upper()
            rows = [row for row in rows if str(row.get("status") or "").upper() == target]

        rows.sort(key=lambda row: str(row.get("startedAt") or ""), reverse=True)
        total = len(rows)
        offset = (page - 1) * page_size
        window = rows[offset : offset + page_size]
        items = [
            AgenticSubAgentRecord(
                sub_agent_id=str(row.get("subAgentId") or ""),
                parent_node_id=str(row.get("parentNodeId") or ""),
                parent_sub_agent_id=row.get("parentSubAgentId"),
                owner_agent=str(row.get("ownerAgent") or ""),
                role=str(row.get("role") or ""),
                objective=str(row.get("objective") or ""),
                depth=int(row.get("depth") or 1),
                status=str(row.get("status") or "UNKNOWN"),
                started_at=self._parse_dt(row.get("startedAt")),
                finished_at=self._parse_dt(row.get("finishedAt")) if row.get("finishedAt") else None,
                evidence=row.get("evidence") or {},
                children=list(row.get("children") or []),
            )
            for row in window
        ]
        return items, total

    def execute_run(self, run_id: str, payload: AgenticExecuteRequest) -> Dict[str, Any]:
        with self._file_lock(self._run_lock_path(run_id)):
            return self._execute_run_locked(run_id, payload)

    def _execute_run_locked(self, run_id: str, payload: AgenticExecuteRequest) -> Dict[str, Any]:
        state = self._load_state(run_id)
        key = str(payload.idempotency_key or "").strip()
        if key and self._is_idempotent_done(state, scope="execute", key=key):
            return state
        state["status"] = "RUNNING"
        state["updated_at"] = _now_iso()
        max_steps = max(1, int(os.getenv("AGENTIC_MAX_EXECUTE_STEPS", "128")))
        steps = 0

        if payload.mode == "next":
            node = self._select_pending_node_for_search(state)
            if node is not None:
                self._execute_node(state, node)
                steps += 1
                self._persist_state(run_id, state)
                self._sync_contract_and_registry(run_id)
        else:
            while steps < max_steps:
                node = self._select_pending_node_for_search(state)
                if node is None:
                    break
                self._execute_node(state, node)
                steps += 1
                self._persist_state(run_id, state)
                self._sync_contract_and_registry(run_id)
                if node.get("status") in {"BLOCKED", "FAILED"}:
                    break

        if steps >= max_steps:
            self._append_event(
                state,
                event="search_step_cap_reached",
                message=f"Execution stopped after reaching max step cap {max_steps}",
                payload={"max_steps": max_steps},
            )

        blocked = any(n.get("status") == "BLOCKED" for n in state.get("tot_tree", []))
        failed = any(n.get("status") == "FAILED" for n in state.get("tot_tree", []))
        pending = any(n.get("status") in {"PENDING", "RETRY_PENDING", "RUNNING"} for n in state.get("tot_tree", []))

        if blocked:
            state["status"] = "BLOCKED"
        elif failed:
            state["status"] = "FAILED"
        elif not pending:
            state["status"] = "SUCCEEDED"
            self._append_event(state, event="run_completed", message="All ToT nodes succeeded", payload={"run_id": run_id})
        else:
            state["status"] = "RUNNING"

        state["updated_at"] = _now_iso()
        if key:
            self._mark_idempotent_done(state, scope="execute", key=key, status=str(state.get("status")))
        self._persist_state(run_id, state)
        self._sync_contract_and_registry(run_id)
        
        # Fire dynamic webhook if status reached terminal state
        if state["status"] in {"SUCCEEDED", "FAILED", "BLOCKED"} and state.get("webhook_url"):
            from app.services.webhook_service import send_dynamic_webhook
            import threading
            
            metrics = {}
            if state["status"] == "SUCCEEDED":
                # Collect metrics from contract or search stats
                metrics = state.get("search_stats", {})
            
            payload = {
                "run_id": run_id,
                "status": "COMPLETED" if state["status"] == "SUCCEEDED" else state["status"],
                "metrics": metrics,
                "error_message": state.get("failure_reason") or ""
            }
            # Fire in background to not block the request
            threading.Thread(target=send_dynamic_webhook, args=(state["webhook_url"], payload), daemon=True).start()
        return state

    def approve_actions(self, run_id: str, payload: AgenticApproveRequest) -> Dict[str, Any]:
        with self._file_lock(self._run_lock_path(run_id)):
            return self._approve_actions_locked(run_id, payload)

    def _approve_actions_locked(self, run_id: str, payload: AgenticApproveRequest) -> Dict[str, Any]:
        state = self._load_state(run_id)
        key = str(payload.idempotency_key or "").strip()
        if key and self._is_idempotent_done(state, scope="approve", key=key):
            return state

        actor_role = str(payload.actor_role or "").strip().lower()
        if actor_role not in set(self.APPROVER_ROLES):
            raise PermissionError("approval_role_not_allowed")
        actor_id = str(payload.actor_id or "actor:unknown")
        comment = str(payload.comment or "").strip()

        approvals = state.get("pending_approvals", [])
        now = _now()
        now_iso = now.isoformat()
        expired_ids: List[str] = []
        for item in approvals:
            if str(item.get("status") or "") != "PENDING":
                continue
            expires_at_raw = str(item.get("expires_at") or "").strip()
            if not expires_at_raw:
                continue
            try:
                expires_at = datetime.fromisoformat(expires_at_raw)
            except Exception:
                continue
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at <= now:
                item["status"] = "EXPIRED"
                item["expired_at"] = now_iso
                expired_ids.append(str(item.get("id") or ""))

        if expired_ids:
            self._append_event(
                state,
                event="approval_expired",
                message=f"Expired approvals: {len(expired_ids)}",
                payload={"approval_ids": [item for item in expired_ids if item]},
                actor="system",
            )

        ids = set(payload.approval_ids)
        selected_rows = [item for item in approvals if (not ids or item.get("id") in ids)]
        selected_actions = sorted(set(str(item.get("action") or "").strip() for item in selected_rows if str(item.get("action") or "").strip()))
        actor_check = self._validate_approval_actor(
            actor_id=actor_id,
            actor_role=actor_role,
            run_id=run_id,
            actions=selected_actions,
        )
        if not bool(actor_check.get("ok")):
            raise PermissionError(str(actor_check.get("reason") or "approval_actor_validation_failed"))
        decision = str(payload.decision or "approve").strip().lower()
        if decision == "reopen":
            if actor_role not in {"admin", "security"}:
                raise PermissionError("approval_reopen_role_not_allowed")
            reopened_ids: List[str] = []
            for item in approvals:
                if ids and item.get("id") not in ids:
                    continue
                if str(item.get("status") or "") not in {"REJECTED", "EXPIRED", "APPROVED"}:
                    continue
                item.setdefault("history", []).append(
                    {
                        "status": item.get("status"),
                        "at": now_iso,
                        "actor_id": actor_id,
                        "actor_role": actor_role,
                        "comment": comment,
                    }
                )
                item["status"] = "PENDING"
                item["reopened_at"] = now_iso
                item["reopened_by"] = actor_id
                item["reopened_role"] = actor_role
                item["approvals"] = []
                item["approval_votes"] = 0
                ttl_minutes = int(item.get("approval_ttl_minutes") or 120)
                item["expires_at"] = (now + timedelta(minutes=max(5, min(10080, ttl_minutes)))).replace(microsecond=0).isoformat()
                for field in (
                    "decided_at",
                    "decided_by",
                    "decided_role",
                    "decision_comment",
                    "expired_at",
                    "last_decision_at",
                    "last_decision_by",
                    "last_decision_role",
                    "last_decision_comment",
                ):
                    item.pop(field, None)
                reopened_ids.append(str(item.get("id") or ""))

            if reopened_ids:
                approved_actions = {
                    str(item.get("action") or "")
                    for item in approvals
                    if str(item.get("status") or "") == "APPROVED" and str(item.get("action") or "")
                }
                state["approved_actions"] = sorted(approved_actions)
                for node in state.get("tot_tree", []):
                    evidence = node.get("evidence") or {}
                    required_actions = set(str(v) for v in (evidence.get("requiredApprovals") or []) if str(v))
                    if not required_actions:
                        continue
                    if required_actions.issubset(approved_actions):
                        continue
                    if node.get("status") in {"SUCCEEDED", "RETRY_PENDING", "RUNNING"}:
                        node["status"] = "BLOCKED"
                state["status"] = "BLOCKED"

            self._append_event(
                state,
                event="approval_reopened",
                message=f"Reopened approvals: {len(reopened_ids)}",
                payload={"approval_ids": [item for item in reopened_ids if item], "actor_id": actor_id, "actor_role": actor_role, "comment": comment},
                actor=actor_id,
            )
            state["updated_at"] = now_iso
            if key:
                self._mark_idempotent_done(state, scope="approve", key=key, status=str(state.get("status")))
            self._persist_state(run_id, state)
            self._sync_contract_and_registry(run_id)
            return state

        target_items = [item for item in approvals if (not ids or item.get("id") in ids) and item.get("status") == "PENDING"]

        if not target_items:
            state["updated_at"] = _now_iso()
            if key:
                self._mark_idempotent_done(state, scope="approve", key=key, status=str(state.get("status")))
            self._persist_state(run_id, state)
            self._sync_contract_and_registry(run_id)
            return state

        for item in target_items:
            required_roles = set(str(v).lower() for v in (item.get("required_roles") or []) if str(v).strip())
            if required_roles and actor_role not in required_roles:
                raise PermissionError("approval_role_insufficient")

        quorum_progress: List[Dict[str, Any]] = []
        for item in approvals:
            if ids and item.get("id") not in ids:
                continue
            if item.get("status") != "PENDING":
                continue
            if decision == "approve":
                vote_rows = item.setdefault("approvals", [])
                existing_actor_ids = {str(v.get("actor_id") or "").strip() for v in vote_rows if isinstance(v, dict)}
                if actor_id not in existing_actor_ids:
                    vote = {
                        "actor_id": actor_id,
                        "actor_role": actor_role,
                        "at": _now_iso(),
                    }
                    if comment:
                        vote["comment"] = comment
                    vote_rows.append(vote)

                unique_votes = {str(v.get("actor_id") or "").strip() for v in vote_rows if isinstance(v, dict)}
                unique_votes.discard("")
                current_votes = len(unique_votes)
                unique_roles = {
                    str(v.get("actor_role") or "").strip().lower()
                    for v in vote_rows
                    if isinstance(v, dict) and str(v.get("actor_role") or "").strip()
                }
                required_votes = max(1, min(3, int(item.get("required_approvals") or 1)))
                require_distinct_roles = bool(item.get("require_distinct_roles"))
                role_quorum_met = (not require_distinct_roles) or (len(unique_roles) >= required_votes)
                item["required_approvals"] = required_votes
                item["approval_votes"] = current_votes
                item["approval_roles"] = sorted(unique_roles)
                item["require_distinct_roles"] = require_distinct_roles

                if current_votes >= required_votes and role_quorum_met:
                    item["status"] = "APPROVED"
                    item["decided_at"] = _now_iso()
                    item["decided_by"] = actor_id
                    item["decided_role"] = actor_role
                    if comment:
                        item["decision_comment"] = comment
                    action = str(item.get("action") or "")
                    if action and action not in state.get("approved_actions", []):
                        state.setdefault("approved_actions", []).append(action)
                else:
                    item["last_decision_at"] = _now_iso()
                    item["last_decision_by"] = actor_id
                    item["last_decision_role"] = actor_role
                    if comment:
                        item["last_decision_comment"] = comment

                quorum_progress.append(
                    {
                        "approval_id": item.get("id"),
                        "action": item.get("action"),
                        "votes": current_votes,
                        "required": required_votes,
                        "distinct_roles_required": require_distinct_roles,
                        "distinct_roles": len(unique_roles),
                        "role_quorum_met": role_quorum_met,
                        "status": item.get("status"),
                    }
                )
            else:
                item["status"] = "REJECTED"
                item["decided_at"] = _now_iso()
                item["decided_by"] = actor_id
                item["decided_role"] = actor_role
                if comment:
                    item["decision_comment"] = comment

        approved_actions = {
            str(item.get("action") or "")
            for item in approvals
            if str(item.get("status") or "") == "APPROVED" and str(item.get("action") or "")
        }
        state["approved_actions"] = sorted(approved_actions)

        if decision == "approve":
            for node in state.get("tot_tree", []):
                if node.get("status") != "BLOCKED":
                    continue
                evidence = node.get("evidence") or {}
                blocked_actions = set(evidence.get("blockedActions") or [])
                required_actions = set(evidence.get("requiredApprovals") or [])
                needed = blocked_actions | required_actions
                if needed and needed.issubset(approved_actions):
                    node["status"] = "RETRY_PENDING"
                    self._append_event(
                        state,
                        event="node_unblocked",
                        message=f"{node.get('node_id')} moved to RETRY_PENDING",
                        payload={"node_id": node.get("node_id"), "approved_actions": sorted(approved_actions)},
                    )

        self._append_event(
            state,
            event="approval_updated",
            message=f"Approval decision={decision}",
            payload={
                "approval_ids": payload.approval_ids,
                "actor_id": actor_id,
                "actor_role": actor_role,
                "comment": comment,
                "quorum_progress": quorum_progress,
            },
            actor=actor_id,
        )
        state["updated_at"] = now_iso
        if key:
            self._mark_idempotent_done(state, scope="approve", key=key, status=str(state.get("status")))
        self._persist_state(run_id, state)
        self._sync_contract_and_registry(run_id)
        return state

    def add_branch(self, run_id: str, parent_node_id: str, payload: AgenticBranchRequest) -> Dict[str, Any]:
        with self._file_lock(self._run_lock_path(run_id)):
            return self._add_branch_locked(run_id, parent_node_id, payload)

    def _add_branch_locked(self, run_id: str, parent_node_id: str, payload: AgenticBranchRequest) -> Dict[str, Any]:
        state = self._load_state(run_id)
        parent = self._find_node(state, parent_node_id)
        if parent is None:
            raise ValueError("parent_node_not_found")

        new_id = self._next_node_id(state)
        node = {
            "node_id": new_id,
            "parent_id": parent_node_id,
            "agent": "ResearchAgent",
            "title": payload.title,
            "hypothesis": payload.hypothesis,
            "execution_plan": payload.execution_plan,
            "expected_metrics": payload.expected_metrics,
            "budget": payload.budget,
            "node_function": "coding",
            "llm_enabled": bool(self._is_node_llm_enabled(state, parent)),
            "risk": payload.risk,
            "status": "PENDING",
            "rationale": "User-inserted branch",
            "evidence": {},
            "sub_agents": [],
            "next_suggestions": ["Execute this branch", "Compare against sibling branches"],
            "children": [],
        }
        state.setdefault("tot_tree", []).append(node)
        parent.setdefault("children", []).append(new_id)

        self._append_event(
            state,
            event="tot_branch_added",
            message=f"Branch {new_id} added under {parent_node_id}",
            payload={"parent_node_id": parent_node_id, "new_node_id": new_id},
        )
        state["updated_at"] = _now_iso()
        self._persist_state(run_id, state)
        self._sync_contract_and_registry(run_id)
        return state

    def delete_branch(self, run_id: str, node_id: str) -> Dict[str, Any]:
        with self._file_lock(self._run_lock_path(run_id)):
            return self._delete_branch_locked(run_id, node_id)

    def _delete_branch_locked(self, run_id: str, node_id: str) -> Dict[str, Any]:
        if node_id == "n0":
            raise ValueError("cannot_delete_root")

        state = self._load_state(run_id)
        node = self._find_node(state, node_id)
        if node is None:
            raise ValueError("node_not_found")

        descendants = self._collect_descendants(state, node_id)
        remove_ids = set([node_id] + descendants)
        state["tot_tree"] = [n for n in state.get("tot_tree", []) if n.get("node_id") not in remove_ids]

        for other in state.get("tot_tree", []):
            children = [c for c in other.get("children", []) if c not in remove_ids]
            other["children"] = children

        self._append_event(
            state,
            event="tot_branch_deleted",
            message=f"Branch {node_id} deleted",
            payload={"node_id": node_id, "removed": sorted(remove_ids)},
        )
        state["updated_at"] = _now_iso()
        self._persist_state(run_id, state)
        self._sync_contract_and_registry(run_id)
        return state

    def build_matrix(self, run_id: str, payload: AgenticMatrixRequest) -> Dict[str, Any]:
        with self._file_lock(self._run_lock_path(run_id)):
            return self._build_matrix_locked(run_id, payload)

    def _build_matrix_locked(self, run_id: str, payload: AgenticMatrixRequest) -> Dict[str, Any]:
        state = self._load_state(run_id)
        run_dir = self._run_dir(run_id)
        ckpt_dir = run_dir / "artifacts" / "ckpt"
        ckpt_dir.mkdir(parents=True, exist_ok=True)

        checkpoint_ids = payload.checkpoint_ids or sorted([p.stem for p in ckpt_dir.glob("*.json")])
        if not checkpoint_ids:
            checkpoint_ids = ["baseline", "candidate_a", "candidate_b"]
            for ckpt in checkpoint_ids:
                (ckpt_dir / f"{ckpt}.json").write_text(
                    json.dumps({"checkpointId": ckpt, "createdAt": _now_iso()}, indent=2),
                    encoding="utf-8",
                )

        labels = list(checkpoint_ids)
        if payload.downsample and len(labels) > payload.max_size:
            labels = self._downsample_labels(labels, payload.max_size)

        matrix_values: List[List[float]] = []
        cells: List[Dict[str, Any]] = []

        cells_dir = run_dir / "matrix" / "cells"
        cells_dir.mkdir(parents=True, exist_ok=True)

        for i, row_label in enumerate(labels):
            row_values: List[float] = []
            for j, col_label in enumerate(labels):
                if i == j:
                    win_rate = 0.5
                else:
                    seed = int(hashlib.sha256(f"{run_id}:{row_label}:{col_label}".encode("utf-8")).hexdigest()[:8], 16)
                    rng = random.Random(seed)
                    base = 0.35 + (rng.random() * 0.3)
                    win_rate = round(base, 4)
                row_values.append(win_rate)

                confidence = round(0.5 + abs(win_rate - 0.5), 4)
                verdict = "draw"
                if win_rate > 0.53:
                    verdict = f"{row_label}>{col_label}"
                elif win_rate < 0.47:
                    verdict = f"{col_label}>{row_label}"

                log_rel = f"matrix/cells/{row_label}__vs__{col_label}.log"
                replay_rel = f"matrix/cells/{row_label}__vs__{col_label}.replay.json"
                (run_dir / log_rel).write_text(
                    f"match {row_label} vs {col_label}\nwin_rate={win_rate}\nverdict={verdict}\n",
                    encoding="utf-8",
                )
                (run_dir / replay_rel).write_text(
                    json.dumps(
                        {
                            "kind": "agentic_marl_replay_v1",
                            "runId": run_id,
                            "row": row_label,
                            "col": col_label,
                            "seed": int(hashlib.sha256(f"{row_label}{col_label}".encode("utf-8")).hexdigest()[:6], 16),
                            "verdict": verdict,
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )

                cells.append(
                    {
                        "row": row_label,
                        "col": col_label,
                        "value": win_rate,
                        "winRate": win_rate,
                        "confidence": confidence,
                        "verdict": verdict,
                        "logUri": log_rel,
                        "replayUri": replay_rel,
                    }
                )
            matrix_values.append(row_values)

        ranking = self._compute_elo(labels, cells)
        matrix = {
            "labels": labels,
            "matrix": matrix_values,
            "cells": cells,
            "ranking": ranking,
            "meta": {
                "metric": "winRate",
                "gamesPerPair": 1,
                "generatedAt": _now_iso(),
                "downsampled": len(labels) != len(checkpoint_ids),
                "originalCount": len(checkpoint_ids),
            },
        }

        matrix_dir = run_dir / "matrix"
        matrix_dir.mkdir(parents=True, exist_ok=True)
        (matrix_dir / "matrix.json").write_text(json.dumps(matrix, indent=2), encoding="utf-8")
        (matrix_dir / "matrix.csv").write_text(self._to_csv(cells), encoding="utf-8")
        (matrix_dir / "ranking.json").write_text(json.dumps(ranking, indent=2), encoding="utf-8")

        state["matrix"] = matrix
        self._append_event(
            state,
            event="matrix_generated",
            message=f"Generated {len(labels)}x{len(labels)} matrix",
            payload={"run_id": run_id, "labels": labels},
        )
        state["updated_at"] = _now_iso()
        self._persist_state(run_id, state)
        self._sync_contract_and_registry(run_id)
        return matrix

    def export_repro_bundle(self, run_id: str) -> Dict[str, Any]:
        with self._file_lock(self._run_lock_path(run_id)):
            return self._export_repro_bundle_locked(run_id)

    def _export_repro_bundle_locked(self, run_id: str) -> Dict[str, Any]:
        state = self._load_state(run_id)
        run_dir = self._run_dir(run_id)
        repro_dir = run_dir / "repro_bundle"
        repro_dir.mkdir(parents=True, exist_ok=True)
        run_report = self._write_run_report(state)
        report_payload = run_report.get("report") or {}

        summary_context = self.retrieve_context(
            query=f"report summary {state.get('status')} {(state.get('research_spec') or {}).get('taskGoal')}",
            k=4,
        )
        report_summary = {
            "runId": run_id,
            "status": state.get("status"),
            "objective": report_payload.get("objective") or (state.get("research_spec") or {}).get("taskGoal"),
            "timelineCount": len(state.get("timeline") or []),
            "eventCount": len(state.get("events") or []),
            "nodeRunCount": len(state.get("node_runs") or []),
            "llmTraceCount": len(self._load_llm_traces(run_id, limit=100000)),
            "contractPassRate": report_payload.get("contractPassRate"),
            "failureEvents": report_payload.get("failureEvents"),
            "recoveryEvents": report_payload.get("recoveryEvents"),
            "runReport": "artifacts/run_report.json",
            "runReportMarkdown": "artifacts/run_report.md",
            "retrievalContext": summary_context,
            "generatedAt": _now_iso(),
        }
        report_summary_path = run_dir / "artifacts" / "report_summary.json"
        report_summary_path.parent.mkdir(parents=True, exist_ok=True)
        report_summary_path.write_text(json.dumps(report_summary, indent=2, ensure_ascii=False), encoding="utf-8")

        policy_snapshot_dir = run_dir / "manifest" / "policy_rules"
        policy_snapshot_dir.mkdir(parents=True, exist_ok=True)
        policy_sources = {
            "approval_policy_rules.yaml": self.approval_policy_rules_path,
            "execution_policy_rules.yaml": self.execution_policy_rules_path,
            "agentic_runtime_rules.yaml": self.runtime_rules_path,
            "approver_registry.yaml": self.approver_registry_path,
        }
        copied_rules: List[str] = []
        for dst_name, src_path in policy_sources.items():
            if not src_path.exists():
                continue
            target = policy_snapshot_dir / dst_name
            target.write_text(src_path.read_text(encoding="utf-8"), encoding="utf-8")
            copied_rules.append(f"manifest/policy_rules/{dst_name}")

        runtime_execution_path = run_dir / "artifacts" / "runtime_execution.json"
        runtime_execution = {}
        if runtime_execution_path.exists():
            try:
                runtime_execution = json.loads(runtime_execution_path.read_text(encoding="utf-8"))
            except Exception:
                runtime_execution = {}
        runtime_checkpoints = sorted(
            [str(path.relative_to(run_dir)) for path in (run_dir / "artifacts" / "ckpt").glob("ckpt_runtime_*.json")]
        )

        manifest = {
            "runId": run_id,
            "generatedAt": _now_iso(),
            "status": state.get("status"),
            "specHash": _stable_hash(state.get("research_spec", {})),
            "configHash": _stable_hash(state.get("root_config_draft", {})),
            "git": state.get("git_info"),
            "decisionSnapshot": "manifest/decision_snapshot.json",
            "timeline": "timeline/timeline.json",
            "events": "timeline/events.jsonl",
            "auditLog": "audit/audit_log.jsonl",
            "auditReplayReport": "audit/replay_report.json",
            "reportSummary": "artifacts/report_summary.json",
            "runReport": "artifacts/run_report.json",
            "runReportMarkdown": "artifacts/run_report.md",
            "nodeRunsLedger": "artifacts/node_runs.json",
            "llmTraces": "artifacts/llm_traces.jsonl",
            "policyRules": copied_rules,
            "runtimeExecution": {
                "path": "artifacts/runtime_execution.json",
                "mode": runtime_execution.get("mode"),
                "status": runtime_execution.get("status"),
                "commandHash": runtime_execution.get("commandHash"),
                "runtimeCheckpoints": runtime_checkpoints,
            },
        }
        (repro_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        script = """#!/usr/bin/env bash
set -euo pipefail
RUN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "Replaying Agentic MARL run from ${RUN_DIR}" 
python - <<'PY'
import json
from pathlib import Path
run_dir = Path(__file__).resolve().parents[1]
manifest = json.loads((run_dir / "repro_bundle" / "manifest.json").read_text(encoding="utf-8"))
print(json.dumps({"runId": manifest.get("runId"), "status": manifest.get("status")}, indent=2))
PY
"""
        reproduce_path = repro_dir / "reproduce.sh"
        reproduce_path.write_text(script, encoding="utf-8")
        try:
            os.chmod(reproduce_path, 0o755)
        except OSError:
            pass

        bundle_zip = repro_dir / "repro_bundle.zip"
        with zipfile.ZipFile(bundle_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for rel in (
                "spec/research_spec.json",
                "spec/root_config_draft.yaml",
                "spec/eval_protocol_draft.yaml",
                "spec/risk_statement.md",
                "manifest/git_info.json",
                "manifest/env_snapshot.json",
                "manifest/dependency_summary.txt",
                "manifest/decision_snapshot.json",
                "timeline/timeline.json",
                "timeline/events.jsonl",
                "audit/audit_log.jsonl",
                "audit/replay_report.json",
                "artifacts/report_summary.json",
                "artifacts/run_report.json",
                "artifacts/run_report.md",
                "artifacts/runtime_execution.json",
                "artifacts/node_runs.json",
                "artifacts/llm_traces.jsonl",
                "manifest/policy_rules/approval_policy_rules.yaml",
                "manifest/policy_rules/execution_policy_rules.yaml",
                "manifest/policy_rules/agentic_runtime_rules.yaml",
                "manifest/policy_rules/approver_registry.yaml",
                "repro_bundle/manifest.json",
                "repro_bundle/reproduce.sh",
            ):
                src = run_dir / rel
                if src.exists():
                    zf.write(src, arcname=rel)
            node_runs_root = run_dir / "artifacts" / "node_runs"
            if node_runs_root.exists():
                for src in sorted(node_runs_root.rglob("*")):
                    if src.is_file():
                        zf.write(src, arcname=str(src.relative_to(run_dir)))

        state["repro_bundle"] = {
            "bundlePath": str(bundle_zip),
            "manifestPath": str(repro_dir / "manifest.json"),
        }
        self._append_event(state, event="repro_bundle_exported", message="Repro bundle generated", payload=manifest)
        state["updated_at"] = _now_iso()
        self._persist_state(run_id, state)
        self._sync_contract_and_registry(run_id)
        return {"bundle_path": str(bundle_zip), "manifest": manifest}

    def recover_run(self, run_id: str) -> Dict[str, Any]:
        with self._file_lock(self._run_lock_path(run_id)):
            return self._recover_run_locked(run_id)

    def _recover_run_locked(self, run_id: str) -> Dict[str, Any]:
        state = self._load_state(run_id)
        previous_status = str(state.get("status") or "UNKNOWN")
        resumed_nodes: List[str] = []
        for node in state.get("tot_tree", []):
            if str(node.get("status") or "") != "RUNNING":
                continue
            node["status"] = "RETRY_PENDING"
            resumed_nodes.append(str(node.get("node_id") or ""))

        blocked_nodes = any(n.get("status") == "BLOCKED" for n in state.get("tot_tree", []))
        failed_nodes = any(n.get("status") == "FAILED" for n in state.get("tot_tree", []))
        pending_nodes = any(n.get("status") in {"PENDING", "RETRY_PENDING", "RUNNING"} for n in state.get("tot_tree", []))
        pending_approvals = any(item.get("status") == "PENDING" for item in state.get("pending_approvals", []))

        if pending_approvals or blocked_nodes:
            recovered_status = "BLOCKED"
        elif failed_nodes and not pending_nodes:
            recovered_status = "FAILED"
        elif pending_nodes:
            recovered_status = "RUNNING"
        else:
            recovered_status = "SUCCEEDED"

        state["status"] = recovered_status
        state["updated_at"] = _now_iso()
        self._append_event(
            state,
            event="run_recovered",
            message=f"Recovered run status {previous_status}->{recovered_status}",
            payload={
                "previous_status": previous_status,
                "recovered_status": recovered_status,
                "resumed_nodes": resumed_nodes,
            },
        )
        self._persist_state(run_id, state)
        self._sync_contract_and_registry(run_id)
        return state

    def replay_run(self, run_id: str, upto_event_seq: Optional[int] = None) -> Dict[str, Any]:
        state = self._load_state(run_id)
        events = list(state.get("events") or [])
        verification = self._verify_audit_chain(events)

        selected_events = events
        if upto_event_seq is not None:
            selected_events = [event for event in events if int(event.get("seq") or 0) <= int(upto_event_seq)]

        node_states: Dict[str, str] = {}
        branch_ops: List[Dict[str, Any]] = []
        replay_status = "PENDING"
        matrix_generated = False
        repro_exported = False
        approvals_updated = 0
        sub_agents_started = 0
        sub_agents_succeeded = 0
        sub_agents_failed = 0
        sub_agent_states: Dict[str, str] = {}

        for event in selected_events:
            event_name = str(event.get("event") or "")
            payload = event.get("payload") or {}
            node_id = str(payload.get("node_id") or "")

            if event_name == "node_started" and node_id:
                node_states[node_id] = "RUNNING"
                replay_status = "RUNNING"
            elif event_name == "node_succeeded" and node_id:
                node_states[node_id] = "SUCCEEDED"
            elif event_name == "node_failed" and node_id:
                node_states[node_id] = "FAILED"
                replay_status = "FAILED"
            elif event_name == "node_unblocked" and node_id:
                node_states[node_id] = "RETRY_PENDING"
                replay_status = "RUNNING"
            elif event_name == "tot_branch_added":
                branch_ops.append({"op": "add", "payload": payload})
            elif event_name == "tot_branch_deleted":
                branch_ops.append({"op": "delete", "payload": payload})
            elif event_name == "tot_node_expanded":
                branch_ops.append({"op": "expand", "payload": payload})
            elif event_name == "approval_updated":
                approvals_updated += 1
            elif event_name == "sub_agent_started":
                sub_agents_started += 1
                sid = str(payload.get("sub_agent_id") or "")
                if sid:
                    sub_agent_states[sid] = "RUNNING"
            elif event_name == "sub_agent_succeeded":
                sub_agents_succeeded += 1
                sid = str(payload.get("sub_agent_id") or "")
                if sid:
                    sub_agent_states[sid] = "SUCCEEDED"
            elif event_name == "sub_agent_failed":
                sub_agents_failed += 1
                sid = str(payload.get("sub_agent_id") or "")
                if sid:
                    sub_agent_states[sid] = "FAILED"
            elif event_name == "matrix_generated":
                matrix_generated = True
            elif event_name == "repro_bundle_exported":
                repro_exported = True
            elif event_name == "run_completed":
                replay_status = "SUCCEEDED"

        if replay_status == "PENDING" and selected_events:
            replay_status = "RUNNING"
        if upto_event_seq is None and str(state.get("status")) in {"SUCCEEDED", "FAILED", "BLOCKED"}:
            replay_status = str(state.get("status"))
        semantic = self._semantic_replay_validation(selected_events)

        return {
            "runId": run_id,
            "verified": bool(verification.get("valid")),
            "checkedEvents": int(verification.get("checked") or 0),
            "chainHead": verification.get("lastHash"),
            "failureReason": verification.get("reason"),
            "replay": {
                "uptoEventSeq": upto_event_seq,
                "replayedEvents": len(selected_events),
                "replayStatus": replay_status,
                "matchesCurrentState": replay_status == str(state.get("status")) if upto_event_seq is None else None,
                "nodeStates": node_states,
                "subAgentStates": sub_agent_states,
                "subAgentsStarted": sub_agents_started,
                "subAgentsSucceeded": sub_agents_succeeded,
                "subAgentsFailed": sub_agents_failed,
                "branchOps": branch_ops,
                "approvalsUpdated": approvals_updated,
                "matrixGenerated": matrix_generated,
                "reproExported": repro_exported,
                "semanticValid": bool(semantic.get("valid")),
                "semanticIssues": list(semantic.get("issues") or []),
            },
        }

    def get_run_report(self, run_id: str) -> Dict[str, Any]:
        with self._file_lock(self._run_lock_path(run_id)):
            state = self._load_state(run_id)
            return self._write_run_report(state)

    def _collect_search_stats(self, state: Dict[str, Any]) -> Dict[str, Any]:
        def _safe_int(value: Any, default: int = 0) -> int:
            try:
                return int(value)
            except (TypeError, ValueError):
                return default

        def _safe_float(value: Any, default: float = 0.0) -> float:
            try:
                return float(value)
            except (TypeError, ValueError):
                return default

        nodes = list(state.get("tot_tree") or [])
        if not nodes:
            return {
                "total_nodes": 0,
                "root_nodes": 0,
                "max_depth": 0,
                "expanded_nodes": 0,
                "visited_nodes": 0,
                "pending_nodes": 0,
                "avg_branching_factor": 0.0,
                "avg_frontier_score": 0.0,
                "avg_value": 0.0,
                "total_visits": 0,
                "selection_events": 0,
                "expansion_events": 0,
                "exploration_coverage": 0.0,
            }

        by_id = {str(node.get("node_id") or ""): node for node in nodes}
        child_count: Dict[str, int] = {}
        root_nodes = 0
        max_depth = 0
        expanded_nodes = 0
        visited_nodes = 0
        pending_nodes = 0
        total_visits = 0
        frontier_scores: List[float] = []
        node_values: List[float] = []
        child_edges = 0
        branch_nodes = 0

        for node in nodes:
            node_id = str(node.get("node_id") or "")
            parent_id = str(node.get("parent_id") or "")
            if not parent_id or parent_id not in by_id:
                root_nodes += 1
            elif node_id:
                child_count[parent_id] = child_count.get(parent_id, 0) + 1

            status = str(node.get("status") or "").upper()
            if status in {"PENDING", "RETRY_PENDING", "RUNNING"}:
                pending_nodes += 1

            evidence = node.get("evidence") or {}
            search = evidence.get("search") if isinstance(evidence, dict) else {}
            if not isinstance(search, dict):
                search = {}

            visits = _safe_int(search.get("visits"), 0)
            value = _safe_float(search.get("value"), 0.0)
            frontier = _safe_float(search.get("frontierScore"), 0.0)
            expanded = bool(search.get("expanded"))

            total_visits += visits
            if visits > 0:
                visited_nodes += 1
            if expanded:
                expanded_nodes += 1
            frontier_scores.append(frontier)
            node_values.append(value)

        for parent, count in child_count.items():
            if parent:
                child_edges += count
                if count > 0:
                    branch_nodes += 1

        for node in nodes:
            depth = 0
            seen = set()
            cursor = node
            while True:
                parent_id = str(cursor.get("parent_id") or "")
                if not parent_id or parent_id in seen:
                    break
                seen.add(parent_id)
                parent = by_id.get(parent_id)
                if not parent:
                    break
                depth += 1
                cursor = parent
                if depth > len(nodes):
                    break
            max_depth = max(max_depth, depth)

        selection_events = 0
        expansion_events = 0
        for event in state.get("events") or []:
            event_name = str((event or {}).get("event") or "")
            if event_name == "search_node_selected":
                selection_events += 1
            elif event_name == "tot_node_expanded":
                expansion_events += 1

        total_nodes = len(nodes)
        avg_branching = float(child_edges / branch_nodes) if branch_nodes > 0 else 0.0
        avg_frontier = float(sum(frontier_scores) / len(frontier_scores)) if frontier_scores else 0.0
        avg_value = float(sum(node_values) / len(node_values)) if node_values else 0.0
        coverage = float(visited_nodes / max(1, total_nodes))

        return {
            "total_nodes": total_nodes,
            "root_nodes": root_nodes,
            "max_depth": max_depth,
            "expanded_nodes": expanded_nodes,
            "visited_nodes": visited_nodes,
            "pending_nodes": pending_nodes,
            "avg_branching_factor": round(avg_branching, 4),
            "avg_frontier_score": round(avg_frontier, 4),
            "avg_value": round(avg_value, 4),
            "total_visits": total_visits,
            "selection_events": selection_events,
            "expansion_events": expansion_events,
            "exploration_coverage": round(coverage, 4),
        }

    def get_run_detail(self, run_id: str) -> AgenticRunDetail:
        state = self._load_state(run_id)
        contract = self._validate_contract(run_id)
        record = self._registry_record(run_id)
        search_stats = self._collect_search_stats(state)
        llm_traces = self._load_llm_traces(run_id, limit=1000)

        return AgenticRunDetail(
            run_id=run_id,
            status=str(state.get("status") or "UNKNOWN"),
            created_at=self._parse_dt(state.get("created_at")),
            updated_at=self._parse_dt(state.get("updated_at")),
            idea=state.get("idea") or {},
            research_spec=state.get("research_spec") or {},
            root_config_draft=state.get("root_config_draft") or {},
            eval_protocol_draft=state.get("eval_protocol_draft") or {},
            risk_statement=str(state.get("risk_statement") or ""),
            tot_tree=[AgenticNode.model_validate(node) for node in state.get("tot_tree", [])],
            timeline=state.get("timeline") or [],
            events=state.get("events") or [],
            pending_approvals=state.get("pending_approvals") or [],
            node_runs=[AgenticNodeRunRecord.model_validate(item) for item in state.get("node_runs", [])],
            llm_traces=[AgenticLlmTraceRecord.model_validate(item) for item in llm_traces],
            contract=contract,
            search_stats=AgenticSearchStats.model_validate(search_stats),
            matrix=state.get("matrix"),
            registry_record=record,
            repro_bundle=state.get("repro_bundle"),
        )

    def retrieve_context(self, query: str, k: int = 5) -> List[Dict[str, Any]]:
        tokens = _tokenize(query)
        if not tokens:
            return []

        docs: List[Tuple[str, str]] = []
        candidate_paths = [
            self.workspace_root / "rl-research-platform" / "docs" / "CONTRACT.md",
            self.workspace_root / "rl-research-platform" / "docs" / "LLM_INTEGRATION_GUIDE.md",
            self.workspace_root / "rl-research-platform" / "docs" / "ARCHITECTURE_OVERVIEW.md",
            self.workspace_root / "rl-research-platform" / "apps" / "portal-backend" / "runner" / "README.md",
            self.workspace_root / "rl-research-platform" / "apps" / "portal-backend" / "runner" / "runner_main.py",
            self.workspace_root / "rl-research-platform" / "apps" / "portal-backend" / "runner" / "algorithms" / "simple_train.py",
            self.workspace_root / "rl-research-platform" / "apps" / "portal-backend" / "runner" / "algorithms" / "matrix_eval.py",
            self.workspace_root / "rl-research-platform" / "apps" / "portal-backend" / "app" / "schemas" / "eval.py",
            self.workspace_root / "rl-research-platform" / "apps" / "portal-backend" / "app" / "services" / "eval_matrix.py",
            self.workspace_root / "MLE" / "docs" / "agents.md",
            self.workspace_root / "MLE" / "docs" / "architecture.md",
            self.workspace_root / "MLE" / "src" / "toto" / "engine" / "runner.py",
            self.workspace_root / "MLE" / "src" / "toto" / "utils" / "failure_classify.py",
            self.workspace_root / "MLE" / "src" / "toto" / "registry" / "contract.py",
            self.workspace_root / "MLE" / "src" / "toto" / "registry" / "run_manager.py",
            self.workspace_root / "docs" / "examples" / "eval_protocol_draft.yaml",
            self.registry_path,
        ]
        for path in candidate_paths:
            if path.exists() and path.is_file():
                try:
                    text = path.read_text(encoding="utf-8")
                except Exception:
                    continue
                if text.strip():
                    try:
                        source = str(path.relative_to(self.workspace_root))
                    except ValueError:
                        source = str(path)
                    docs.append((source, text))

        for failure_path in sorted(self.runs_root.glob("*/artifacts/error_report.json"))[-20:]:
            if not failure_path.is_file():
                continue
            try:
                text = failure_path.read_text(encoding="utf-8")
            except Exception:
                continue
            if not text.strip() or text.strip() == "{}":
                continue
            try:
                source = str(failure_path.relative_to(self.workspace_root))
            except ValueError:
                source = str(failure_path)
            docs.append((source, text))

        scored: List[Tuple[int, str, str]] = []
        for source, text in docs:
            lowered = text.lower()
            hits = sum(1 for tok in tokens if tok in lowered)
            if hits <= 0:
                continue
            scored.append((hits, source, _short(text, limit=300)))

        scored.sort(key=lambda row: (-row[0], row[1]))
        return [
            {
                "source": source,
                "score": score,
                "snippet": snippet,
            }
            for score, source, snippet in scored[:k]
        ]

    def _build_research_spec(self, idea: AgenticIdeaInput) -> Dict[str, Any]:
        execution_mode = self._normalize_execution_mode(idea.execution_mode)
        approval_rules = self._load_approval_policy_rules()
        approval_policy = self._normalize_approval_policy(
            {
                "mode": idea.approval_policy.mode,
                "highRiskActions": list(idea.approval_policy.high_risk_actions),
                "blockedActionRoles": list(idea.approval_policy.blocked_action_roles),
                "highRiskActionRoles": list(idea.approval_policy.high_risk_action_roles),
                "requireApprovalForUnknownActions": idea.approval_policy.require_approval_for_unknown_actions,
                "minApprovals": idea.approval_policy.min_approvals,
                "requireDistinctRoles": idea.approval_policy.require_distinct_roles,
                "approvalTtlMinutes": idea.approval_policy.approval_ttl_minutes,
            }
        )
        approval_policy_meta = self._approval_policy_snapshot(policy=approval_policy, rules=approval_rules)
        return {
            "schemaVersion": "1.0",
            "specId": f"spec-{uuid.uuid4().hex[:12]}",
            "title": idea.title,
            "taskGoal": idea.task_goal,
            "environment": {
                "name": idea.environment,
                "dataSources": idea.data_sources,
            },
            "successMetrics": idea.success_metrics,
            "budget": {
                "gpuHours": float(idea.budget.gpu_hours),
                "wallclockMinutes": int(idea.budget.wallclock_minutes),
            },
            "constraints": {
                "compliance": list(idea.constraints.compliance),
                "forbiddenActions": list(idea.constraints.forbidden_actions),
                "allowNetwork": bool(idea.constraints.allow_network),
                "allowDependencyInstall": bool(idea.constraints.allow_dependency_install),
            },
            "execution": {
                "mode": execution_mode,
                "localCommand": str(idea.local_command).strip() if idea.local_command else None,
            },
            "subAgentPolicy": {
                "enabled": bool(idea.sub_agent_policy.enabled),
                "maxDepth": int(max(1, min(4, idea.sub_agent_policy.max_depth))),
                "maxPerNode": int(max(1, min(8, idea.sub_agent_policy.max_per_node))),
                "maxTotal": int(max(1, min(64, idea.sub_agent_policy.max_total))),
                "timeoutMs": int(max(50, min(10000, idea.sub_agent_policy.timeout_ms))),
            },
            "llmPolicy": {
                "planning": bool(idea.llm_policy.planning),
                "coding": bool(idea.llm_policy.coding),
                "experiment": bool(idea.llm_policy.experiment),
                "review": bool(idea.llm_policy.review),
                "safety": bool(idea.llm_policy.safety),
            },
            "approvalPolicy": approval_policy,
            "approvalPolicyMeta": approval_policy_meta,
            "git": idea.git.model_dump(by_alias=True) if idea.git else None,
            "requestedActions": list(idea.requested_actions),
            "generatedAt": _now_iso(),
            "offlineMode": execution_mode == "offline_stub",
        }

    def _spec_generation_context(self, spec: Dict[str, Any]) -> Dict[str, Any]:
        budget = spec.get("budget") or {}
        constraints = spec.get("constraints") or {}
        execution = spec.get("execution") or {}
        env = spec.get("environment") or {}
        metrics = [str(k).strip() for k in (spec.get("successMetrics") or {}).keys() if str(k).strip()]
        compliance = [str(v).strip() for v in (constraints.get("compliance") or []) if str(v).strip()]

        try:
            gpu_hours = float(budget.get("gpuHours") or 0.0)
        except Exception:
            gpu_hours = 0.0
        try:
            wallclock_minutes = int(budget.get("wallclockMinutes") or 60)
        except Exception:
            wallclock_minutes = 60

        return {
            "gpuHours": max(0.0, gpu_hours),
            "wallclockMinutes": max(1, wallclock_minutes),
            "allowNetwork": bool(constraints.get("allowNetwork")),
            "allowDependencyInstall": bool(constraints.get("allowDependencyInstall")),
            "executionMode": self._normalize_execution_mode(execution.get("mode")),
            "metricCount": len(metrics),
            "metricKeys": metrics,
            "dataSourceCount": len(env.get("dataSources") or []),
            "requestedActionCount": len(spec.get("requestedActions") or []),
            "forbiddenActionCount": len(constraints.get("forbiddenActions") or []),
            "complianceTags": compliance,
        }

    def _spec_profile_matches(self, context: Dict[str, Any], match: Dict[str, Any]) -> bool:
        if not isinstance(match, dict):
            return True

        def _as_float(value: Any, fallback: float) -> float:
            try:
                return float(value)
            except Exception:
                return fallback

        def _as_int(value: Any, fallback: int) -> int:
            try:
                return int(value)
            except Exception:
                return fallback

        if "minGpuHours" in match and context["gpuHours"] < _as_float(match.get("minGpuHours"), 0.0):
            return False
        if "maxGpuHours" in match and context["gpuHours"] > _as_float(match.get("maxGpuHours"), context["gpuHours"]):
            return False
        if "minWallclockMinutes" in match and context["wallclockMinutes"] < _as_int(match.get("minWallclockMinutes"), 1):
            return False
        if "maxWallclockMinutes" in match and context["wallclockMinutes"] > _as_int(
            match.get("maxWallclockMinutes"), context["wallclockMinutes"]
        ):
            return False
        if "minMetricCount" in match and context["metricCount"] < _as_int(match.get("minMetricCount"), 0):
            return False
        if "maxMetricCount" in match and context["metricCount"] > _as_int(match.get("maxMetricCount"), context["metricCount"]):
            return False
        if "minDataSourceCount" in match and context["dataSourceCount"] < _as_int(match.get("minDataSourceCount"), 0):
            return False
        if "minRequestedActionCount" in match and context["requestedActionCount"] < _as_int(
            match.get("minRequestedActionCount"), 0
        ):
            return False
        if "minForbiddenActionCount" in match and context["forbiddenActionCount"] < _as_int(
            match.get("minForbiddenActionCount"), 0
        ):
            return False
        if "allowNetwork" in match and bool(match.get("allowNetwork")) != bool(context["allowNetwork"]):
            return False
        if "allowDependencyInstall" in match and bool(match.get("allowDependencyInstall")) != bool(context["allowDependencyInstall"]):
            return False

        execution_modes = match.get("executionModes")
        if isinstance(execution_modes, list):
            allowed_modes = {str(v).strip().lower() for v in execution_modes if str(v).strip()}
            if allowed_modes and str(context["executionMode"]).lower() not in allowed_modes:
                return False

        required_metric_keys = match.get("requiresMetricKeys")
        if isinstance(required_metric_keys, list):
            metric_set = {str(v).strip() for v in context.get("metricKeys") or []}
            wanted = {str(v).strip() for v in required_metric_keys if str(v).strip()}
            if wanted and not wanted.issubset(metric_set):
                return False

        required_tags = match.get("requiresComplianceTags")
        if isinstance(required_tags, list):
            tag_set = {str(v).strip() for v in context.get("complianceTags") or []}
            wanted = {str(v).strip() for v in required_tags if str(v).strip()}
            if wanted and not wanted.issubset(tag_set):
                return False

        return True

    def _select_spec_generation_profile(self, spec: Dict[str, Any]) -> Dict[str, Any]:
        rules = self._load_spec_generation_rules()
        profiles = rules.get("profiles") or {}
        context = self._spec_generation_context(spec)

        candidates: List[Tuple[int, int, str, Dict[str, Any]]] = []
        for profile_id, row in profiles.items():
            if not isinstance(row, dict):
                continue
            match = row.get("match") or {}
            if not self._spec_profile_matches(context, match if isinstance(match, dict) else {}):
                continue
            try:
                priority = int(row.get("priority") or 0)
            except Exception:
                priority = 0
            specificity = len(match.keys()) if isinstance(match, dict) else 0
            candidates.append((priority, specificity, str(profile_id), row))

        if candidates:
            candidates.sort(key=lambda item: (-item[0], -item[1], item[2]))
            _, _, profile_id, profile = candidates[0]
        else:
            fallback_id = "balanced_default" if isinstance(profiles.get("balanced_default"), dict) else ""
            if not fallback_id and profiles:
                fallback_id = sorted(profiles.keys())[0]
            profile_id = str(fallback_id or "default")
            profile = profiles.get(profile_id) if isinstance(profiles.get(profile_id), dict) else {}

        return {
            "profileId": profile_id,
            "profile": profile if isinstance(profile, dict) else {},
            "context": context,
            "rulesVersion": str(rules.get("version") or "1.0"),
            "stepHeuristics": rules.get("stepHeuristics") or {},
        }

    def _build_root_config_draft(self, spec: Dict[str, Any]) -> Dict[str, Any]:
        budget = spec.get("budget") or {}
        env = spec.get("environment") or {}
        constraints = spec.get("constraints") or {}
        execution = spec.get("execution") or {}
        execution_mode = self._normalize_execution_mode(execution.get("mode"))
        sub_agent_policy = spec.get("subAgentPolicy") or {}
        llm_policy = self._normalize_llm_policy(spec.get("llmPolicy") or {})
        approval_policy = self._normalize_approval_policy(spec.get("approvalPolicy") or {})
        selection = self._select_spec_generation_profile(spec)
        profile = selection.get("profile") or {}
        profile_root = profile.get("rootConfig") if isinstance(profile.get("rootConfig"), dict) else {}
        profile_algo = profile_root.get("algo") if isinstance(profile_root.get("algo"), dict) else {}
        profile_train = profile_root.get("train") if isinstance(profile_root.get("train"), dict) else {}
        profile_resources = profile_root.get("resources") if isinstance(profile_root.get("resources"), dict) else {}
        heuristics = selection.get("stepHeuristics") if isinstance(selection.get("stepHeuristics"), dict) else {}

        try:
            wallclock = int(budget.get("wallclockMinutes") or 60)
        except Exception:
            wallclock = 60
        wallclock = max(1, wallclock)
        try:
            gpu_hours = float(budget.get("gpuHours") or 0.0)
        except Exception:
            gpu_hours = 0.0

        steps_per_minute = float(profile_train.get("stepsPerMinute") or heuristics.get("stepsPerMinute") or 150)
        min_steps = int(heuristics.get("minTotalEnvSteps") or 1000)
        max_steps = int(heuristics.get("maxTotalEnvSteps") or 50000)
        steps = int(max(min_steps, min(max_steps, wallclock * steps_per_minute)))

        gpu_threshold = float(profile_resources.get("gpuThresholdToEnable") or heuristics.get("gpuThresholdToEnable") or 0.25)
        forced_gpus = profile_resources.get("forcedGpus")
        if forced_gpus is not None:
            try:
                gpus = max(0, int(forced_gpus))
            except Exception:
                gpus = 1 if gpu_hours > gpu_threshold else 0
        else:
            base_gpus = 1 if gpu_hours > gpu_threshold else 0
            multiplier = float(profile_resources.get("gpusMultiplier") or 1.0)
            gpus = int(max(0, round(base_gpus * multiplier)))
            try:
                min_gpus = int(profile_resources.get("minGpus") or 0)
            except Exception:
                min_gpus = 0
            try:
                max_gpus = int(profile_resources.get("maxGpus") or 8)
            except Exception:
                max_gpus = 8
            max_gpus = max(min_gpus, max_gpus)
            gpus = max(min_gpus, min(max_gpus, gpus))

        algo: Dict[str, Any] = {
            "family": str(profile_algo.get("family") or "mappo"),
            "entrypoint": str(profile_algo.get("entrypoint") or "algorithms.simple_train:train"),
            "adapterMode": execution_mode,
        }
        local_command = str(execution.get("localCommand") or "").strip()
        if local_command:
            algo["localCommand"] = local_command

        return {
            "project": {
                "name": spec.get("title"),
                "objective": spec.get("taskGoal"),
            },
            "env": {
                "id": env.get("name"),
                "dataSources": env.get("dataSources") or [],
            },
            "algo": algo,
            "train": {
                "totalEnvSteps": steps,
                "rolloutLen": int(profile_train.get("rolloutLen") or heuristics.get("defaultRolloutLen") or 128),
                "batchSize": int(profile_train.get("batchSize") or heuristics.get("defaultBatchSize") or 2048),
                "lr": float(profile_train.get("lr") or heuristics.get("defaultLr") or 3e-4),
            },
            "resources": {
                "gpus": gpus,
                "maxWallclockMinutes": wallclock,
            },
            "safety": {
                "allowNetwork": bool(constraints.get("allowNetwork")),
                "allowDependencyInstall": bool(constraints.get("allowDependencyInstall")),
                "forbiddenActions": constraints.get("forbiddenActions") or [],
                "approvalPolicy": approval_policy,
            },
            "orchestration": {
                "subAgentPolicy": {
                    "enabled": bool(sub_agent_policy.get("enabled", True)),
                    "maxDepth": int(sub_agent_policy.get("maxDepth", self.MAX_SUB_AGENT_DEPTH)),
                    "maxPerNode": int(sub_agent_policy.get("maxPerNode", 3)),
                    "maxTotal": int(sub_agent_policy.get("maxTotal", 24)),
                    "timeoutMs": int(sub_agent_policy.get("timeoutMs", 1500)),
                },
                "llmPolicy": llm_policy,
            },
            "generation": {
                "profileId": selection.get("profileId"),
                "rulesVersion": selection.get("rulesVersion"),
                "context": selection.get("context"),
            },
        }

    def _build_eval_protocol_draft(self, spec: Dict[str, Any]) -> Dict[str, Any]:
        metrics = list((spec.get("successMetrics") or {}).keys())
        if not metrics:
            metrics = ["winRate"]

        selection = self._select_spec_generation_profile(spec)
        profile = selection.get("profile") or {}
        eval_profile = profile.get("evalProtocol") if isinstance(profile.get("evalProtocol"), dict) else {}
        matrix_plan = eval_profile.get("matrixPlan") if isinstance(eval_profile.get("matrixPlan"), dict) else {}
        k_default = 4 if len(metrics) < 3 else 6

        return {
            "name": f"protocol-{spec.get('title', 'agentic')}",
            "metric": metrics[0],
            "metrics": metrics,
            "gamesPerPair": int(eval_profile.get("gamesPerPair") or 8),
            "seeds": list(eval_profile.get("seeds") or [1, 2, 3]),
            "confidenceLevel": float(eval_profile.get("confidenceLevel") or 0.95),
            "matrixPlan": {
                "mode": str(matrix_plan.get("mode") or "NxN"),
                "checkpointSelection": str(matrix_plan.get("checkpointSelection") or "best_k"),
                "k": int(matrix_plan.get("k") or k_default),
            },
            "generation": {
                "profileId": selection.get("profileId"),
                "rulesVersion": selection.get("rulesVersion"),
            },
        }

    def _build_risk_statement(self, spec: Dict[str, Any]) -> str:
        constraints = spec.get("constraints") or {}
        requested = spec.get("requestedActions") or []
        forbidden = set(constraints.get("forbiddenActions") or [])
        blocked = [action for action in requested if action in forbidden]
        execution = spec.get("execution") or {}
        execution_mode = self._normalize_execution_mode(execution.get("mode"))
        approval_policy = self._normalize_approval_policy(spec.get("approvalPolicy") or {})
        approval_policy_meta = spec.get("approvalPolicyMeta") or self._approval_policy_snapshot(policy=approval_policy)
        llm_policy = self._normalize_llm_policy(spec.get("llmPolicy") or {})
        selection = self._select_spec_generation_profile(spec)
        profile = selection.get("profile") or {}
        risk_hints = [str(v).strip() for v in (profile.get("riskHints") or []) if str(v).strip()]

        lines = [
            "# Risk Statement",
            "",
            f"- Objective: {spec.get('taskGoal')}",
            f"- Offline mode: {spec.get('offlineMode')}",
            f"- Generation profile: {selection.get('profileId')} (rulesVersion={selection.get('rulesVersion')})",
            f"- Compliance tags: {', '.join(constraints.get('compliance') or []) or 'none'}",
            f"- Forbidden actions: {', '.join(constraints.get('forbiddenActions') or []) or 'none'}",
            f"- Requested high-risk actions: {', '.join(requested) or 'none'}",
            f"- Initial blocked actions: {', '.join(blocked) or 'none'}",
            f"- Execution mode: {execution_mode}",
            f"- Local command configured: {bool(str(execution.get('localCommand') or '').strip())}",
            f"- Approval mode: {approval_policy.get('mode')}",
            f"- Min approvals per gated action: {approval_policy.get('minApprovals')}",
            f"- Distinct roles required: {approval_policy.get('requireDistinctRoles')}",
            f"- Approval TTL (minutes): {approval_policy.get('approvalTtlMinutes')}",
            f"- High-risk approver roles: {', '.join(approval_policy.get('highRiskActionRoles') or []) or 'none'}",
            f"- Blocked-action approver roles: {', '.join(approval_policy.get('blockedActionRoles') or []) or 'none'}",
            f"- Unknown actions require approval: {approval_policy.get('requireApprovalForUnknownActions')}",
            f"- Approval rules version: {approval_policy_meta.get('rulesVersion')}",
            f"- Approval rules hash: {approval_policy_meta.get('rulesHash')}",
            f"- Approval policy hash: {approval_policy_meta.get('policyHash')}",
            f"- Approval template candidates: {', '.join(approval_policy_meta.get('matchedTemplates') or []) or 'none'}",
            f"- Node LLM toggles: planning={llm_policy.get('planning')}, coding={llm_policy.get('coding')}, experiment={llm_policy.get('experiment')}, review={llm_policy.get('review')}, safety={llm_policy.get('safety')}",
        ]
        if risk_hints:
            lines.append(f"- Rule hints: {', '.join(risk_hints)}")
        return "\n".join(lines)

    def _normalize_llm_policy(self, raw_policy: Dict[str, Any]) -> Dict[str, bool]:
        defaults = {
            "planning": True,
            "coding": True,
            "experiment": True,
            "review": True,
            "safety": True,
        }
        if not isinstance(raw_policy, dict):
            return defaults
        normalized: Dict[str, bool] = {}
        for key, default_value in defaults.items():
            value = raw_policy.get(key)
            normalized[key] = default_value if value is None else bool(value)
        return normalized

    def _llm_policy(self, state: Dict[str, Any]) -> Dict[str, bool]:
        spec = state.get("research_spec") or {}
        raw = spec.get("llmPolicy") or {}
        return self._normalize_llm_policy(raw if isinstance(raw, dict) else {})

    def _node_function(self, node: Dict[str, Any]) -> str:
        explicit = str(node.get("node_function") or node.get("nodeFunction") or "").strip().lower()
        if explicit in {"planning", "coding", "experiment", "review", "safety"}:
            return explicit

        agent = str(node.get("agent") or "").lower()
        title = str(node.get("title") or "").lower()
        if "safety" in agent or "safety" in title:
            return "safety"
        if "eval" in agent or "review" in title:
            return "review"
        if "execute candidate run" in title or "experiment" in title or "runner" in agent:
            return "experiment"
        if "research" in agent or "integration" in agent or "repair" in title:
            return "coding"
        return "planning"

    def _is_node_llm_enabled(self, state: Dict[str, Any], node: Dict[str, Any]) -> bool:
        explicit = node.get("llm_enabled")
        if explicit is not None:
            return bool(explicit)
        policy = self._llm_policy(state)
        node_function = self._node_function(node)
        return bool(policy.get(node_function, True))

    def _build_tot_tree(self, spec: Dict[str, Any]) -> List[Dict[str, Any]]:
        budget = spec.get("budget") or {}
        execution_mode = self._normalize_execution_mode((spec.get("execution") or {}).get("mode"))
        metric_targets = spec.get("successMetrics") if isinstance(spec.get("successMetrics"), dict) else {}
        metric = next(iter((metric_targets or {"winRate": ">=0.55"}).keys()))
        goal = str(spec.get("taskGoal") or "Improve target metric with reproducible evidence.")
        env_name = str(((spec.get("environment") or {}).get("name") or "environment"))
        llm_policy = self._normalize_llm_policy(spec.get("llmPolicy") or {})
        metric_target = str(metric_targets.get(metric) or "improve")

        nodes: List[Dict[str, Any]] = [
            {
                "node_id": "n0",
                "parent_id": None,
                "agent": "ResearchAgent",
                "title": "Root Spec",
                "hypothesis": f"Task '{goal}' can be transformed into an executable plan for {env_name}.",
                "execution_plan": "Normalize research specification, define lane ownership, and lock execution boundaries.",
                "expected_metrics": {metric: "baseline"},
                "budget": {"gpuHours": budget.get("gpuHours", 0), "wallclockMinutes": budget.get("wallclockMinutes", 60)},
                "node_function": "planning",
                "llm_enabled": bool(llm_policy.get("planning", True)),
                "risk": "low",
                "status": "SUCCEEDED",
                "rationale": "Root context is initialized at run creation.",
                "evidence": {"source": "spec/research_spec.json"},
                "sub_agents": [],
                "next_suggestions": ["Execute branch nodes", "Inspect safety before run"],
                "children": ["n1", "n2", "n3", "n4", "n5", "n6"],
            },
            {
                "node_id": "n1",
                "parent_id": "n0",
                "agent": "ResearchAgent",
                "title": "Model/Loss Mutation Proposal",
                "hypothesis": "Architecture and objective-level code mutations can improve target metric with bounded cost.",
                "execution_plan": "Generate code-level mutation candidates (architecture/loss/objective) and expected uplift.",
                "expected_metrics": {metric: metric_target},
                "budget": {"gpuHours": 0.7, "wallclockMinutes": 25},
                "node_function": "coding",
                "llm_enabled": bool(llm_policy.get("coding", True)),
                "risk": "medium",
                "status": "PENDING",
                "rationale": "Research lane generates code-level hypotheses rather than only hyper-parameter sweeps.",
                "evidence": {},
                "sub_agents": [],
                "next_suggestions": ["Run integration check", "Prepare fallback baseline"],
                "children": [],
            },
            {
                "node_id": "n2",
                "parent_id": "n0",
                "agent": "IntegrationAgent",
                "title": "Adapter Strategy",
                "hypothesis": "Runner contract can host target repo with minimal adapter patching.",
                "execution_plan": "Pick native adapter or fallback offline adapter from retrieved templates.",
                "expected_metrics": {"adapterSuccessRate": ">=0.85"},
                "budget": {"gpuHours": 0.3, "wallclockMinutes": 20},
                "node_function": "coding",
                "llm_enabled": bool(llm_policy.get("coding", True)),
                "risk": "high",
                "status": "PENDING",
                "rationale": "Integration lane bridges external code and platform runner contract.",
                "evidence": {},
                "sub_agents": [],
                "next_suggestions": ["If failure then branch repair", "Record adapter provenance"],
                "children": [],
            },
            {
                "node_id": "n3",
                "parent_id": "n0",
                "agent": "OpsAgent",
                "title": "Budget and Ops Guard",
                "hypothesis": "Current budget can support one baseline + one challenger run.",
                "execution_plan": "Allocate runtime budget, set fallback mode, and emit ops hints.",
                "expected_metrics": {"runtimeStability": ">=0.95"},
                "budget": {"gpuHours": 0.2, "wallclockMinutes": 15},
                "node_function": "planning",
                "llm_enabled": bool(llm_policy.get("planning", True)),
                "risk": "medium",
                "status": "PENDING",
                "rationale": "Ops lane controls execution economics and retries.",
                "evidence": {},
                "sub_agents": [],
                "next_suggestions": ["Clamp steps when budget tight", "Use offline fallback on missing deps"],
                "children": [],
            },
            {
                "node_id": "n4",
                "parent_id": "n0",
                "agent": "EvalAgent",
                "title": "Evaluation Protocol",
                "hypothesis": "NxN checkpoint matrix can reveal robust winner under unified protocol.",
                "execution_plan": "Draft matrix evaluation protocol and confidence computation.",
                "expected_metrics": {"matrixCoverage": ">=0.9"},
                "budget": {"gpuHours": 0.4, "wallclockMinutes": 20},
                "node_function": "review",
                "llm_enabled": bool(llm_policy.get("review", True)),
                "risk": "low",
                "status": "PENDING",
                "rationale": "Eval lane produces judge-ready league evidence.",
                "evidence": {},
                "sub_agents": [],
                "next_suggestions": ["Generate Elo", "Attach cell-level replay references"],
                "children": [],
            },
            {
                "node_id": "n5",
                "parent_id": "n0",
                "agent": "SafetyAgent",
                "title": "Safety Gate",
                "hypothesis": "High-risk actions can be intercepted before execution.",
                "execution_plan": "Check requested actions against forbidden list and approval policy.",
                "expected_metrics": {"policyViolations": "0"},
                "budget": {"gpuHours": 0.0, "wallclockMinutes": 5},
                "node_function": "safety",
                "llm_enabled": bool(llm_policy.get("safety", True)),
                "risk": "high",
                "status": "PENDING",
                "rationale": "Safety lane enforces approval for high-risk operations.",
                "evidence": {},
                "sub_agents": [],
                "next_suggestions": ["Request approval or block", "Emit audit record"],
                "children": [],
            },
            {
                "node_id": "n6",
                "parent_id": "n0",
                "agent": "OpsAgent",
                "title": "Execute Candidate Run",
                "hypothesis": "Selected code mutation branch can produce reproducible metrics and evidence.",
                "execution_plan": f"Run execution adapter ({execution_mode}) and generate per-node run artifacts/checkpoints/metrics.",
                "expected_metrics": {metric: spec.get("successMetrics", {}).get(metric)},
                "budget": {"gpuHours": 1.8, "wallclockMinutes": 50},
                "node_function": "experiment",
                "llm_enabled": bool(llm_policy.get("experiment", True)),
                "risk": "medium",
                "status": "PENDING",
                "rationale": "Execution lane materializes artifacts and observability evidence.",
                "evidence": {},
                "sub_agents": [],
                "next_suggestions": ["Build matrix after checkpoints", "Export repro bundle"],
                "children": [],
            },
        ]
        return nodes

    def _run_lock_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / ".run.lock"

    def _registry_lock_path(self) -> Path:
        return self.root / ".registry.lock"

    @contextmanager
    def _file_lock(self, lock_path: Path) -> Iterable[None]:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+", encoding="utf-8") as lock_file:
            if fcntl is not None:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _run_dir(self, run_id: str) -> Path:
        return self.runs_root / run_id

    def _llm_traces_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / "artifacts" / "llm_traces.jsonl"

    def _append_llm_trace(
        self,
        run_id: str,
        row: Dict[str, Any],
    ) -> None:
        run_id = str(run_id or "").strip()
        if not run_id:
            return
        path = self._llm_traces_path(run_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        except Exception:
            return

    def _load_llm_traces(self, run_id: str, *, limit: int = 500) -> List[Dict[str, Any]]:
        path = self._llm_traces_path(run_id)
        rows = _read_jsonl(path)
        if limit > 0 and len(rows) > limit:
            rows = rows[-limit:]
        return rows

    def _state_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / "state.json"

    def _load_state(self, run_id: str) -> Dict[str, Any]:
        state_path = self._state_path(run_id)
        if not state_path.exists():
            raise FileNotFoundError("agentic_run_not_found")
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(state, dict):
            raise ValueError("agentic_state_invalid")
        state.setdefault("tot_tree", [])
        state.setdefault("sub_agents", [])
        state.setdefault("node_runs", [])
        state.setdefault("timeline", [])
        state.setdefault("events", [])
        state.setdefault("pending_approvals", [])
        return state

    def _persist_state(self, run_id: str, state: Dict[str, Any]) -> None:
        run_dir = self._run_dir(run_id)
        run_dir.mkdir(parents=True, exist_ok=True)
        _atomic_write_text(self._state_path(run_id), json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")

        (run_dir / "tot" / "tree.json").parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_text(
            run_dir / "tot" / "tree.json",
            json.dumps(state.get("tot_tree", []), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (run_dir / "timeline" / "timeline.json").parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_text(
            run_dir / "timeline" / "timeline.json",
            json.dumps(state.get("timeline", []), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        events_path = run_dir / "timeline" / "events.jsonl"
        events_lines = "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in state.get("events", []))
        _atomic_write_text(events_path, events_lines, encoding="utf-8")

        audit_dir = run_dir / "audit"
        audit_dir.mkdir(parents=True, exist_ok=True)
        audit_log_path = audit_dir / "audit_log.jsonl"
        _atomic_write_text(audit_log_path, events_lines, encoding="utf-8")

        verification = self._verify_audit_chain(state.get("events") or [])
        semantic = self._semantic_replay_validation(state.get("events") or [])
        replay_report = {
            "runId": run_id,
            "verified": bool(verification.get("valid")),
            "checkedEvents": int(verification.get("checked") or 0),
            "chainHead": verification.get("lastHash"),
            "failureReason": verification.get("reason"),
            "semanticValid": bool(semantic.get("valid")),
            "semanticIssues": list(semantic.get("issues") or []),
            "generatedAt": _now_iso(),
        }
        _atomic_write_text(
            audit_dir / "replay_report.json",
            json.dumps(replay_report, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        (run_dir / "manifest" / "decision_snapshot.json").parent.mkdir(parents=True, exist_ok=True)
        decision = {
            "run_id": run_id,
            "status": state.get("status"),
            "tot_tree": state.get("tot_tree", []),
            "subAgents": state.get("sub_agents", []),
            "pendingApprovals": state.get("pending_approvals", []),
            "auditChain": state.get("audit_chain", {}),
            "idempotency": state.get("idempotency", {}),
            "updatedAt": state.get("updated_at"),
        }
        _atomic_write_text(
            run_dir / "manifest" / "decision_snapshot.json",
            json.dumps(decision, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        metrics_payload = {
            "runStatus": state.get("status"),
            "timelineCount": len(state.get("timeline", [])),
            "eventCount": len(state.get("events", [])),
            "subAgentCount": len(state.get("sub_agents", [])),
            "nodeSummary": {
                "pending": sum(1 for n in state.get("tot_tree", []) if n.get("status") in {"PENDING", "RETRY_PENDING"}),
                "blocked": sum(1 for n in state.get("tot_tree", []) if n.get("status") == "BLOCKED"),
                "failed": sum(1 for n in state.get("tot_tree", []) if n.get("status") == "FAILED"),
                "succeeded": sum(1 for n in state.get("tot_tree", []) if n.get("status") == "SUCCEEDED"),
            },
            "searchSummary": self._collect_search_stats(state),
        }
        (run_dir / "artifacts" / "metrics.json").parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_text(
            run_dir / "artifacts" / "metrics.json",
            json.dumps(metrics_payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        diagnostics = {
            "retrieval_context": state.get("retrieval_context", []),
            "failure_history": state.get("failure_history", []),
            "approvals": state.get("pending_approvals", []),
            "sub_agents": state.get("sub_agents", []),
            "node_runs": state.get("node_runs", []),
            "llm_traces": self._load_llm_traces(run_id, limit=800),
        }
        _atomic_write_text(
            run_dir / "artifacts" / "diagnostics.json",
            json.dumps(diagnostics, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        _atomic_write_text(
            run_dir / "artifacts" / "sub_agents.json",
            json.dumps(state.get("sub_agents", []), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        _atomic_write_text(
            run_dir / "artifacts" / "node_runs.json",
            json.dumps(state.get("node_runs", []), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        self._write_run_report(state)

    def _bootstrap_run_files(self, run_dir: Path, state: Dict[str, Any]) -> None:
        (run_dir / "spec").mkdir(parents=True, exist_ok=True)
        (run_dir / "tot").mkdir(parents=True, exist_ok=True)
        (run_dir / "timeline").mkdir(parents=True, exist_ok=True)
        (run_dir / "artifacts" / "ckpt").mkdir(parents=True, exist_ok=True)
        (run_dir / "artifacts" / "replay").mkdir(parents=True, exist_ok=True)
        (run_dir / "manifest").mkdir(parents=True, exist_ok=True)
        (run_dir / "audit").mkdir(parents=True, exist_ok=True)
        (run_dir / "matrix").mkdir(parents=True, exist_ok=True)
        (run_dir / "repro_bundle").mkdir(parents=True, exist_ok=True)

        (run_dir / "spec" / "research_spec.json").write_text(
            json.dumps(state.get("research_spec", {}), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (run_dir / "spec" / "root_config_draft.yaml").write_text(
            yaml.safe_dump(state.get("root_config_draft", {}), sort_keys=False),
            encoding="utf-8",
        )
        (run_dir / "spec" / "eval_protocol_draft.yaml").write_text(
            yaml.safe_dump(state.get("eval_protocol_draft", {}), sort_keys=False),
            encoding="utf-8",
        )
        (run_dir / "spec" / "risk_statement.md").write_text(str(state.get("risk_statement") or ""), encoding="utf-8")

        (run_dir / "timeline" / "timeline.json").write_text("[]\n", encoding="utf-8")
        (run_dir / "timeline" / "events.jsonl").write_text("", encoding="utf-8")

        (run_dir / "artifacts" / "config_resolved.json").write_text(
            json.dumps(state.get("root_config_draft", {}), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (run_dir / "artifacts" / "env_summary.json").write_text(
            json.dumps(
                {
                    "python": platform.python_version(),
                    "platform": platform.platform(),
                    "environment": state.get("research_spec", {}).get("environment", {}),
                    "offlineMode": bool((state.get("research_spec") or {}).get("offlineMode", True)),
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (run_dir / "artifacts" / "metrics.json").write_text(json.dumps({"status": "PENDING"}, indent=2), encoding="utf-8")
        (run_dir / "artifacts" / "diagnostics.json").write_text(json.dumps({"status": "PENDING"}, indent=2), encoding="utf-8")
        (run_dir / "artifacts" / "runtime_execution.json").write_text(
            json.dumps({"status": "PENDING", "mode": self._execution_adapter_mode(state)}, indent=2),
            encoding="utf-8",
        )
        (run_dir / "artifacts" / "sub_agents.json").write_text("[]\n", encoding="utf-8")
        (run_dir / "artifacts" / "node_runs.json").write_text("[]\n", encoding="utf-8")
        (run_dir / "artifacts" / "llm_traces.jsonl").write_text("", encoding="utf-8")
        (run_dir / "artifacts" / "run_report.json").write_text(json.dumps({"status": "PENDING"}, indent=2), encoding="utf-8")
        (run_dir / "artifacts" / "run_report.md").write_text("# Agentic Run Report\n\nstatus: PENDING\n", encoding="utf-8")
        (run_dir / "artifacts" / "error_report.json").write_text(json.dumps({}, indent=2), encoding="utf-8")
        (run_dir / "artifacts" / "log.txt").write_text("agentic run initialized\n", encoding="utf-8")
        (run_dir / "audit" / "audit_log.jsonl").write_text("", encoding="utf-8")
        (run_dir / "audit" / "replay_report.json").write_text(
            json.dumps(
                {
                    "runId": state.get("run_id"),
                    "verified": True,
                    "checkedEvents": 0,
                    "chainHead": "GENESIS",
                    "generatedAt": _now_iso(),
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        (run_dir / "manifest" / "git_info.json").write_text(
            json.dumps(state.get("git_info", {}), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (run_dir / "manifest" / "env_snapshot.json").write_text(
            json.dumps(
                {
                    "python": platform.python_version(),
                    "platform": platform.platform(),
                    "cwd": str(self.workspace_root),
                    "generatedAt": _now_iso(),
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        dependency_summary = [
            f"python=={platform.python_version()}",
            f"mode={self._execution_adapter_mode(state)}",
            f"llm_provider={self._llm_provider()}",
        ]
        (run_dir / "manifest" / "dependency_summary.txt").write_text("\n".join(dependency_summary) + "\n", encoding="utf-8")

        default_repro = run_dir / "repro_bundle" / "reproduce.sh"
        default_repro.write_text("#!/usr/bin/env bash\necho 'Run export_repro_bundle to generate full bundle.'\n", encoding="utf-8")
        try:
            os.chmod(default_repro, 0o755)
        except OSError:
            pass

    def _primary_metric_key(self, state: Dict[str, Any]) -> str:
        metrics = ((state.get("research_spec") or {}).get("successMetrics") or {})
        if isinstance(metrics, dict):
            for key in metrics.keys():
                text = str(key).strip()
                if text:
                    return text
        return "winRate"

    def _env_first(self, *keys: str, default: str = "") -> str:
        for key in keys:
            value = os.getenv(key)
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return str(default or "").strip()

    def _llm_provider(self) -> str:
        provider = self._env_first(
            "AGENTIC_LLM_PROVIDER",
            "LLM_PROVIDER",
            default=str(getattr(settings, "llm_provider", "openai_compat") or "openai_compat"),
        ).lower()
        # Keep backwards compatibility with old naming while honoring openai-compatible gateways.
        if provider in {"openai", "openai_compat", "openai-compatible"}:
            return "openai_compat"
        return provider

    def _llm_model(self) -> str:
        return self._env_first(
            "AGENTIC_LLM_MODEL",
            "LLM_MODEL",
            default=str(getattr(settings, "llm_model", "gpt-4.1-mini") or "gpt-4.1-mini"),
        )

    def _llm_api_key(self) -> str:
        return self._env_first(
            "AGENTIC_LLM_API_KEY",
            "LLM_API_KEY",
            "MODEL_API_KEY",
            "OPENAI_API_KEY",
            default=str(getattr(settings, "llm_api_key", "") or ""),
        )

    def _llm_base_url(self) -> str:
        return self._env_first(
            "AGENTIC_LLM_BASE_URL",
            "LLM_BASE_URL",
            default=str(getattr(settings, "llm_base_url", "https://api.openai.com/v1") or "https://api.openai.com/v1"),
        ).rstrip("/")

    def _llm_temperature(self) -> float:
        raw = self._env_first(
            "AGENTIC_LLM_TEMPERATURE",
            "LLM_TEMPERATURE",
            default=str(getattr(settings, "llm_temperature", 0.2)),
        )
        try:
            return max(0.0, min(1.0, float(raw)))
        except Exception:
            return 0.2

    def _llm_max_tokens(self) -> int:
        raw = self._env_first(
            "AGENTIC_LLM_MAX_TOKENS",
            "LLM_MAX_TOKENS",
            default=str(getattr(settings, "llm_max_tokens", 1200)),
        )
        try:
            return max(128, min(32768, int(raw)))
        except Exception:
            return 1200

    def _llm_timeout_seconds(self) -> int:
        try:
            raw = self._env_first(
                "AGENTIC_LLM_TIMEOUT_SECONDS",
                "LLM_TIMEOUT_S",
                default=str(getattr(settings, "llm_timeout_s", 60)),
            )
            return max(5, min(300, int(raw)))
        except Exception:
            return 60

    def _llm_max_retries(self) -> int:
        try:
            raw = self._env_first(
                "AGENTIC_LLM_MAX_RETRIES",
                "LLM_MAX_RETRIES",
                default=str(getattr(settings, "llm_max_retries", 3)),
            )
            return max(1, min(5, int(raw)))
        except Exception:
            return 3

    def _assert_llm_ready(self) -> None:
        provider = self._llm_provider()
        if provider != "openai_compat":
            raise RuntimeError(f"llm_required_provider_not_supported:{provider}")
        if not self._llm_model():
            raise RuntimeError("llm_required_missing_model")
        if not self._llm_api_key():
            raise RuntimeError("llm_required_missing_api_key")

    def _extract_first_json_object(self, text: str) -> Dict[str, Any]:
        raw = str(text or "").strip()
        if not raw:
            raise ValueError("llm_empty_content")
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(raw[start : end + 1])
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass
        raise ValueError("llm_invalid_json_object")

    def _validate_json_schema(self, value: Any, schema: Dict[str, Any], path: str = "$") -> None:
        expected_type = str(schema.get("type") or "").strip().lower()
        if expected_type == "object":
            if not isinstance(value, dict):
                raise ValueError(f"{path}: expected object")
            required = schema.get("required") or []
            for key in required:
                if key not in value:
                    raise ValueError(f"{path}: missing required key '{key}'")
            props = schema.get("properties") or {}
            if isinstance(props, dict):
                for key, child_schema in props.items():
                    if key in value and isinstance(child_schema, dict):
                        self._validate_json_schema(value[key], child_schema, path=f"{path}.{key}")
            return

        if expected_type == "array":
            if not isinstance(value, list):
                raise ValueError(f"{path}: expected array")
            min_items = schema.get("minItems")
            max_items = schema.get("maxItems")
            if min_items is not None and len(value) < int(min_items):
                raise ValueError(f"{path}: expected at least {int(min_items)} items")
            if max_items is not None and len(value) > int(max_items):
                raise ValueError(f"{path}: expected at most {int(max_items)} items")
            child_schema = schema.get("items")
            if isinstance(child_schema, dict):
                for idx, item in enumerate(value):
                    self._validate_json_schema(item, child_schema, path=f"{path}[{idx}]")
            return

        if expected_type == "string":
            if not isinstance(value, str):
                raise ValueError(f"{path}: expected string")
            enum = schema.get("enum")
            if isinstance(enum, list) and enum and value not in enum:
                raise ValueError(f"{path}: value '{value}' not in enum")
            return

        if expected_type == "number":
            if not isinstance(value, (int, float)):
                raise ValueError(f"{path}: expected number")
            return

        if expected_type == "integer":
            if not isinstance(value, int):
                raise ValueError(f"{path}: expected integer")
            return

        if expected_type == "boolean":
            if not isinstance(value, bool):
                raise ValueError(f"{path}: expected boolean")
            return

    def _llm_complete_json(
        self,
        *,
        task: str,
        system_prompt: str,
        user_prompt: str,
        schema: Dict[str, Any],
        temperature: float = 0.2,
        run_id: Optional[str] = None,
        node_id: Optional[str] = None,
        role: Optional[str] = None,
    ) -> Dict[str, Any]:
        self._assert_llm_ready()
        max_retries = self._llm_max_retries()
        provider = self._llm_provider()
        model = self._llm_model()
        if provider != "openai_compat":
            raise RuntimeError(f"llm_required_provider_not_supported:{provider}")

        prompt_user = str(user_prompt or "")
        last_error = "unknown"
        for attempt in range(1, max_retries + 1):
            temp = float(max(0.0, min(1.0, temperature if isinstance(temperature, (int, float)) else self._llm_temperature())))
            payload = {
                "model": model,
                "temperature": temp,
                "max_tokens": self._llm_max_tokens(),
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": str(system_prompt or "").strip()},
                    {"role": "user", "content": prompt_user},
                ],
            }
            started_at = _now()
            try:
                base_url = self._llm_base_url()
                url = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._llm_api_key()}",
                }

                req = urllib.request.Request(
                    url,
                    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                    headers=headers,
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=self._llm_timeout_seconds()) as resp:
                        raw = resp.read().decode("utf-8")
                except urllib.error.HTTPError as exc:
                    # Some OpenAI-compatible providers reject response_format for certain models.
                    if int(exc.code) not in {400, 422}:
                        raise
                    retry_payload = dict(payload)
                    retry_payload.pop("response_format", None)
                    req_retry = urllib.request.Request(
                        url,
                        data=json.dumps(retry_payload, ensure_ascii=False).encode("utf-8"),
                        headers=headers,
                        method="POST",
                    )
                    with urllib.request.urlopen(req_retry, timeout=self._llm_timeout_seconds()) as resp:
                        raw = resp.read().decode("utf-8")

                body = json.loads(raw)
                choices = body.get("choices") or []
                if not choices:
                    raise ValueError("llm_no_choices")
                message = (choices[0] or {}).get("message") or {}
                content = message.get("content")
                if isinstance(content, list):
                    parts: List[str] = []
                    for row in content:
                        if isinstance(row, str):
                            cleaned = row.strip()
                            if cleaned:
                                parts.append(cleaned)
                            continue
                        if not isinstance(row, dict):
                            continue
                        cleaned = str(row.get("text") or row.get("content") or "").strip()
                        if cleaned:
                            parts.append(cleaned)
                    text = "\n".join(parts)
                elif isinstance(content, dict):
                    text = str(content.get("text") or content.get("content") or "")
                else:
                    text = str(content or "")
                result = self._extract_first_json_object(text)
                self._validate_json_schema(result, schema)
                usage = body.get("usage") or {}
                prompt_tokens = int(usage.get("prompt_tokens") or 0)
                completion_tokens = int(usage.get("completion_tokens") or 0)
                latency_ms = max(0, int((_now() - started_at).total_seconds() * 1000))
                self._append_llm_trace(
                    str(run_id or ""),
                    {
                        "ts": _now_iso(),
                        "task": str(task or ""),
                        "status": "succeeded",
                        "model": model,
                        "attempt": int(attempt),
                        "latency_ms": latency_ms,
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "node_id": str(node_id or "") or None,
                        "role": str(role or "") or None,
                        "prompt_hash": _stable_hash(
                            {
                                "task": str(task or ""),
                                "system": str(system_prompt or ""),
                                "user": prompt_user,
                                "schema": schema,
                                "attempt": int(attempt),
                            }
                        ),
                        "response_hash": _stable_hash(result),
                        "schema_valid": True,
                        "error": None,
                    },
                )
                return result
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
                latency_ms = 0
                try:
                    latency_ms = max(0, int((_now() - started_at).total_seconds() * 1000))
                except Exception:
                    latency_ms = 0
                last_error = str(exc)
                self._append_llm_trace(
                    str(run_id or ""),
                    {
                        "ts": _now_iso(),
                        "task": str(task or ""),
                        "status": "failed",
                        "model": model,
                        "attempt": int(attempt),
                        "latency_ms": latency_ms,
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "node_id": str(node_id or "") or None,
                        "role": str(role or "") or None,
                        "prompt_hash": _stable_hash(
                            {
                                "task": str(task or ""),
                                "system": str(system_prompt or ""),
                                "user": prompt_user,
                                "schema": schema,
                                "attempt": int(attempt),
                            }
                        ),
                        "response_hash": None,
                        "schema_valid": False,
                        "error": last_error,
                    },
                )
                if attempt >= max_retries:
                    break
                prompt_user = (
                    f"{user_prompt}\n\n"
                    f"Your previous output was invalid for task '{task}': {last_error}\n"
                    "Return JSON only, no markdown, and strictly satisfy the schema."
                )
        raise RuntimeError(f"llm_required_output_invalid task={task} reason={last_error}")

    def _render_mutation_template_text(self, value: str, context: Dict[str, Any]) -> str:
        text = str(value or "")
        for key, raw in context.items():
            text = text.replace(f"{{{key}}}", str(raw))
        return text

    def _append_llm_call_event(
        self,
        state: Dict[str, Any],
        node: Optional[Dict[str, Any]],
        *,
        task: str,
        status: str,
        role: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        run_id = str(state.get("run_id") or "")
        node_id = str((node or {}).get("node_id") or "")
        payload: Dict[str, Any] = {
            "run_id": run_id,
            "node_id": node_id or None,
            "task": str(task or ""),
            "status": str(status or "").lower(),
            "role": str(role or (node or {}).get("agent") or "LLM"),
            "llmEnabled": self._is_node_llm_enabled(state, node or {}),
        }

        traces = self._load_llm_traces(run_id, limit=1) if run_id and str(status).lower() != "started" else []
        if traces:
            last = traces[-1]
            payload["model"] = str(last.get("model") or "")
            payload["latencyMs"] = int(last.get("latency_ms") or 0)
            payload["promptTokens"] = int(last.get("prompt_tokens") or 0)
            payload["completionTokens"] = int(last.get("completion_tokens") or 0)
            payload["attempt"] = int(last.get("attempt") or 0)
        if error:
            payload["error"] = _short(str(error), limit=240)

        message = f"LLM {status}: {task}"
        self._append_event(
            state,
            event="llm_called",
            message=message,
            payload=payload,
            actor=str(role or (node or {}).get("agent") or "LLM"),
        )

    def _invoke_llm_json(
        self,
        *,
        state: Dict[str, Any],
        node: Optional[Dict[str, Any]],
        task: str,
        system_prompt: str,
        user_prompt: str,
        schema: Dict[str, Any],
        temperature: float,
        role: Optional[str] = None,
    ) -> Dict[str, Any]:
        self._append_llm_call_event(state, node, task=task, status="started", role=role)
        try:
            result = self._llm_complete_json(
                task=task,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                schema=schema,
                temperature=temperature,
                run_id=str(state.get("run_id") or ""),
                node_id=str((node or {}).get("node_id") or "") or None,
                role=role,
            )
            self._append_llm_call_event(state, node, task=task, status="succeeded", role=role)
            return result
        except Exception as exc:
            self._append_llm_call_event(state, node, task=task, status="failed", role=role, error=str(exc))
            raise

    def _llm_mutation_template_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "required": ["items"],
            "properties": {
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 4,
                    "items": {
                        "type": "object",
                        "required": [
                            "strategy",
                            "mutationKind",
                            "title",
                            "hypothesis",
                            "executionPlan",
                            "targetFiles",
                            "changeSummary",
                            "validationCommand",
                            "risk",
                        ],
                        "properties": {
                            "strategy": {"type": "string"},
                            "mutationKind": {"type": "string"},
                            "title": {"type": "string"},
                            "hypothesis": {"type": "string"},
                            "executionPlan": {"type": "string"},
                            "targetFiles": {"type": "array", "minItems": 1, "maxItems": 6, "items": {"type": "string"}},
                            "changeSummary": {"type": "string"},
                            "validationCommand": {"type": "string"},
                            "risk": {"type": "string", "enum": ["low", "medium", "high"]},
                        },
                    },
                }
            },
        }

    def _fallback_mutation_templates(self, state: Dict[str, Any], node: Dict[str, Any], lane: str) -> List[Dict[str, Any]]:
        metric_key = self._primary_metric_key(state)
        node_id = str(node.get("node_id") or "")
        defaults = {
            "research": ["apps/portal-backend/runner/algorithms/simple_train.py"],
            "integration": ["apps/portal-backend/app/services/agentic_os.py"],
            "evaluation": ["apps/portal-backend/app/services/eval_matrix.py"],
            "execution": ["apps/portal-backend/app/services/agentic_os.py"],
        }
        target_files = self._normalize_target_files(defaults.get(lane) or defaults["research"])
        return [
            {
                "strategy": f"rule_{lane}_mutation",
                "mutationKind": "code",
                "title": f"{node_id} {lane.title()} Branch",
                "hypothesis": f"Rule-based mutation can improve {metric_key}.",
                "executionPlan": "Apply deterministic patch template and validate.",
                "targetFiles": target_files,
                "changeSummary": "Rule-based fallback mutation template (LLM disabled for this node).",
                "validationCommand": "python -m pytest apps/portal-backend/tests -k agentic -q",
                "risk": "medium",
                "source": "rule_fallback",
            }
        ]

    def _llm_generate_code_mutation_templates(self, state: Dict[str, Any], node: Dict[str, Any], lane: str) -> List[Dict[str, Any]]:
        run_id = str(state.get("run_id") or "")
        node_id = str(node.get("node_id") or "")
        metric_key = self._primary_metric_key(state)
        agent = str(node.get("agent") or "ResearchAgent")
        spec = state.get("research_spec") or {}
        env_name = str(((spec.get("environment") or {}).get("name") or "env"))
        budget = spec.get("budget") or {}
        constraints = spec.get("constraints") or {}

        if not self._is_node_llm_enabled(state, node):
            self._append_event(
                state,
                event="llm_skipped",
                message=f"LLM disabled for node {node_id}; using fallback mutation templates",
                payload={
                    "node_id": node_id,
                    "task": f"mutation_templates_{lane}",
                    "lane": lane,
                    "reason": "node_llm_disabled",
                },
                actor=agent,
            )
            return self._fallback_mutation_templates(state, node, lane)

        retrieval = self.retrieve_context(
            query=f"code mutation plan lane={lane} node={node_id} metric={metric_key} env={env_name}",
            k=3,
        )

        system_prompt = (
            "You are the core planner for Agentic MARL Research OS. "
            "Return strictly valid JSON only. "
            "Propose concrete source-code edit mutation candidates for this ToT node. "
            "Do not output hyperparameter-only sweeps (lr/batch-size/seed only). "
            "Each candidate must modify executable source files."
        )
        user_prompt = json.dumps(
            {
                "task": "code_mutation_templates",
                "lane": lane,
                "runId": run_id,
                "nodeId": node_id,
                "agent": agent,
                "primaryMetric": metric_key,
                "environment": env_name,
                "budget": budget,
                "constraints": constraints,
                "nodeTitle": str(node.get("title") or ""),
                "nodeHypothesis": str(node.get("hypothesis") or ""),
                "nodeExecutionPlan": str(node.get("execution_plan") or ""),
                "retrieval": retrieval,
                "requirements": {
                    "mustBeCodeLevel": True,
                    "mustIncludeTargetFiles": True,
                    "preferFilesInsideWorkspace": True,
                    "mustNotBeHyperparameterOnly": True,
                    "requiredCodeFileExtensions": list(self.CODE_MUTATION_EXTENSIONS),
                    "forbiddenMutationKinds": list(self.DISALLOWED_MUTATION_KINDS),
                    "maxCandidates": 4,
                },
            },
            ensure_ascii=False,
        )

        try:
            result = self._invoke_llm_json(
                state=state,
                node=node,
                task=f"mutation_templates_{lane}",
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                schema=self._llm_mutation_template_schema(),
                temperature=0.2,
                role=agent,
            )

            rows = result.get("items") or []
            if not isinstance(rows, list) or not rows:
                raise RuntimeError(f"llm_required_empty_mutation_templates lane={lane}")

            normalized: List[Dict[str, Any]] = []
            invalid_reasons: List[str] = []
            for item in rows:
                if not isinstance(item, dict):
                    continue
                target_files = self._normalize_target_files(item.get("targetFiles") or [])
                if not target_files:
                    continue
                risk = str(item.get("risk") or "medium").strip().lower()
                if risk not in {"low", "medium", "high"}:
                    risk = "medium"
                candidate = {
                    "strategy": str(item.get("strategy") or "llm_mutation").strip(),
                    "mutationKind": str(item.get("mutationKind") or "code").strip(),
                    "title": str(item.get("title") or f"{node_id} LLM Branch").strip(),
                    "hypothesis": str(item.get("hypothesis") or f"Mutation can improve {metric_key}.").strip(),
                    "executionPlan": str(item.get("executionPlan") or "Apply patch and validate.").strip(),
                    "targetFiles": target_files,
                    "changeSummary": str(item.get("changeSummary") or "LLM-proposed code mutation.").strip(),
                    "validationCommand": str(item.get("validationCommand") or "python -m pytest apps/portal-backend/tests -q").strip(),
                    "risk": risk,
                    "source": "llm",
                }
                valid, reason = self._validate_mutation_candidate(candidate, lane=lane)
                if not valid:
                    invalid_reasons.append(str(reason or "invalid_mutation_candidate"))
                    continue
                normalized.append(candidate)
            if not normalized:
                reason = ";".join(invalid_reasons[:4]) if invalid_reasons else "empty_after_validation"
                raise RuntimeError(f"llm_required_invalid_mutation_templates lane={lane} reason={reason}")
            return normalized
        except RuntimeError:
            # Re-raise runtime errors (like validation failures) so they can be caught by tests/callers
            raise
        except Exception as exc:
            self._append_event(
                state,
                event="llm_fallback",
                message=f"LLM mutation template generation failed for node {node_id}; fallback templates applied",
                payload={
                    "node_id": node_id,
                    "task": f"mutation_templates_{lane}",
                    "lane": lane,
                    "reason": str(exc),
                },
                actor=agent,
            )
            return self._fallback_mutation_templates(state, node, lane)

    def _runtime_code_mutation_templates(self, state: Dict[str, Any], node: Dict[str, Any]) -> List[Dict[str, Any]]:
        agent = str(node.get("agent") or "ResearchAgent")
        lane = (
            "research"
            if agent == "ResearchAgent"
            else "integration"
            if agent == "IntegrationAgent"
            else "evaluation"
            if agent == "EvalAgent"
            else "execution"
        )
        return self._llm_generate_code_mutation_templates(state, node, lane=lane)

    def _node_run_dir(self, run_id: str, node_run_id: str) -> Path:
        return self._run_dir(run_id) / "artifacts" / "node_runs" / node_run_id

    def _latest_node_run_id(self, state: Dict[str, Any], node_id: Optional[str]) -> Optional[str]:
        target = str(node_id or "").strip()
        if not target:
            return None
        for row in reversed(list(state.get("node_runs") or [])):
            if str(row.get("nodeId") or "") != target:
                continue
            node_run_id = str(row.get("nodeRunId") or "").strip()
            if node_run_id:
                return node_run_id
        return None

    def _normalize_target_files(self, values: Iterable[Any]) -> List[str]:
        normalized: List[str] = []
        seen: set[str] = set()
        for value in values:
            raw = str(value or "").strip()
            if not raw:
                continue
            resolved_rel, _ = self._resolve_target_path(raw)
            candidate = (resolved_rel or raw).replace("\\", "/").lstrip("./").strip()
            if not candidate or candidate in seen:
                continue
            normalized.append(candidate)
            seen.add(candidate)
        return normalized

    def _is_code_target_file(self, path: str) -> bool:
        ext = Path(str(path or "")).suffix.lower()
        return bool(ext) and ext in set(self.CODE_MUTATION_EXTENSIONS)

    def _is_mutation_kind_allowed(self, mutation_kind: str) -> bool:
        normalized = str(mutation_kind or "").strip().lower().replace("-", "_")
        return normalized not in set(self.DISALLOWED_MUTATION_KINDS)

    def _looks_like_code_change_plan(self, candidate: Dict[str, Any]) -> bool:
        blob = " ".join(
            [
                str(candidate.get("strategy") or ""),
                str(candidate.get("mutationKind") or ""),
                str(candidate.get("changeSummary") or ""),
                str(candidate.get("title") or ""),
                str(candidate.get("hypothesis") or ""),
                str(candidate.get("executionPlan") or ""),
            ]
        ).lower()
        return any(keyword in blob for keyword in self.CODE_CHANGE_KEYWORDS)

    def _validate_mutation_candidate(self, candidate: Dict[str, Any], lane: str) -> Tuple[bool, str]:
        mutation_kind = str(candidate.get("mutationKind") or "").strip()
        if not mutation_kind:
            return False, "missing_mutation_kind"
        if not self._is_mutation_kind_allowed(mutation_kind):
            return False, f"disallowed_mutation_kind:{mutation_kind}"

        target_files = self._normalize_target_files(candidate.get("targetFiles") or [])
        if not target_files:
            return False, "missing_target_files"
        if not any(self._is_code_target_file(path) for path in target_files):
            return False, "target_files_not_code"

        if not self._looks_like_code_change_plan(candidate):
            return False, "mutation_plan_not_code_like"

        # Evaluation lane may touch protocol files, but at least one executable file keeps it code-level.
        if str(lane or "").strip().lower() == "evaluation":
            if not any(self._is_code_target_file(path) for path in target_files):
                return False, "evaluation_lane_requires_code_targets"

        return True, ""

    def _is_within_workspace(self, path: Path) -> bool:
        try:
            path.resolve().relative_to(self.workspace_root.resolve())
            return True
        except Exception:
            return False

    def _resolve_target_path(self, raw_path: str) -> Tuple[str, Optional[Path]]:
        text = str(raw_path or "").strip().replace("\\", "/")
        if not text:
            return "", None

        if text.startswith("./"):
            text = text[2:]
        if text.startswith("~/"):
            text = text[2:]

        if os.path.isabs(text):
            abs_path = Path(text).resolve()
            if not self._is_within_workspace(abs_path):
                return "", None
            rel = str(abs_path.relative_to(self.workspace_root)).replace("\\", "/")
            if abs_path.exists() and abs_path.is_file():
                return rel, abs_path
            return rel, None

        rel_parts = [part for part in Path(text).parts if part not in ("", ".")]
        if not rel_parts or any(part == ".." for part in rel_parts):
            return "", None
        normalized = "/".join(rel_parts)

        roots: List[Path] = [self.workspace_root]
        if not normalized.startswith("rl-research-platform/"):
            roots.append(self.workspace_root / "rl-research-platform")
        if not normalized.startswith("MLE/"):
            roots.append(self.workspace_root / "MLE")

        candidates: List[Path] = []
        seen: set[str] = set()
        for root in roots:
            try:
                candidate = (root / normalized).resolve()
            except Exception:
                continue
            key = str(candidate)
            if key in seen:
                continue
            seen.add(key)
            if self._is_within_workspace(candidate):
                candidates.append(candidate)

        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                rel = str(candidate.relative_to(self.workspace_root)).replace("\\", "/")
                return rel, candidate

        if candidates:
            rel = str(candidates[0].relative_to(self.workspace_root)).replace("\\", "/")
            return rel, None
        return "", None

    def _derive_node_patch_plan(self, state: Dict[str, Any], node: Dict[str, Any]) -> List[Dict[str, Any]]:
        evidence = node.get("evidence") if isinstance(node.get("evidence"), dict) else {}
        expansion = evidence.get("expansion") if isinstance(evidence, dict) else {}
        raw = expansion.get("mutationPlan") if isinstance(expansion, dict) else None
        plans: List[Dict[str, Any]] = []
        if isinstance(raw, dict):
            plans.append(copy.deepcopy(raw))
        elif isinstance(raw, list):
            plans.extend([copy.deepcopy(item) for item in raw if isinstance(item, dict)])
        if plans:
            return plans

        templates = self._runtime_code_mutation_templates(state, node)
        first = templates[:2]
        rendered: List[Dict[str, Any]] = []
        for item in first:
            rendered.append(
                {
                    "strategy": str(item.get("strategy") or "mutation"),
                    "mutationKind": str(item.get("mutationKind") or "code"),
                    "changeSummary": str(item.get("changeSummary") or ""),
                    "targetFiles": self._normalize_target_files(item.get("targetFiles") or []),
                    "validationCommand": str(item.get("validationCommand") or "python -m pytest apps/portal-backend/tests -q"),
                }
            )
        return rendered

    def _extract_node_run_metrics(self, node: Dict[str, Any]) -> Dict[str, Any]:
        evidence = node.get("evidence") if isinstance(node.get("evidence"), dict) else {}
        execution = evidence.get("execution") if isinstance(evidence, dict) else {}
        runtime = execution.get("runtime") if isinstance(execution, dict) else {}
        runtime_metrics = runtime.get("metrics") if isinstance(runtime, dict) else None
        if isinstance(runtime_metrics, dict) and runtime_metrics:
            return copy.deepcopy(runtime_metrics)

        expected = node.get("expected_metrics") if isinstance(node.get("expected_metrics"), dict) else {}
        normalized: Dict[str, Any] = {}
        for key, value in expected.items():
            raw = str(value)
            match = re.search(r"[-+]?\d*\.?\d+", raw)
            if match:
                try:
                    parsed = float(match.group(0))
                    if parsed > 1.0:
                        parsed = parsed / 100.0
                    normalized[str(key)] = round(max(0.0, min(1.0, parsed)), 4)
                    continue
                except Exception:
                    pass
            normalized[str(key)] = value
        if normalized:
            return normalized
        return {"status": str(node.get("status") or "UNKNOWN")}

    def _mutate_python_content(
        self,
        *,
        target_path: str,
        original: str,
        mutation_kind: str,
        strategy: str,
        summary: str,
        node_run_id: str,
        node_id: str,
        patch_index: int,
        target_index: int,
    ) -> Tuple[str, str, bool]:
        text = original
        changed = False
        mode_bits: List[str] = []

        if target_path.endswith("runner/algorithms/simple_train.py"):
            replacement_rules: List[Tuple[str, str, str]] = []
            if mutation_kind == "loss":
                replacement_rules = [
                    (r"1\.0\s*-\s*0\.02\s*\*\s*idx", "1.0 - 0.0175 * idx", "entropy_decay"),
                    (r"0\.1\s*\*\s*idx", "0.105 * idx", "return_scale"),
                ]
            elif mutation_kind == "objective":
                replacement_rules = [
                    (r"0\.05\s*\*\s*idx", "0.055 * idx", "winrate_curve"),
                ]
            elif mutation_kind == "architecture":
                replacement_rules = [
                    (r'train_cfg\.get\("rolloutLen",\s*10\)', 'train_cfg.get("rolloutLen", 8)', "rollout_len"),
                ]

            for pattern, replacement, label in replacement_rules:
                updated = re.sub(pattern, replacement, text, count=1)
                if updated != text:
                    text = updated
                    changed = True
                    mode_bits.append(label)

            if "agenticMutationScore" not in text:
                lines = text.splitlines()
                for idx, line in enumerate(lines):
                    if '"entropy"' in line and "round(" in line:
                        indent = re.match(r"\s*", line).group(0) if re.match(r"\s*", line) else " " * 12
                        lines.insert(idx + 1, f'{indent}"agenticMutationScore": round(min(1.0, 0.03 * idx + 0.1), 4),')
                        text = "\n".join(lines) + ("\n" if original.endswith("\n") else "")
                        changed = True
                        mode_bits.append("metric_probe")
                        break

        if target_path.endswith("runner/runner_main.py") and mutation_kind == "integration":
            marker = "AGENTIC_INTEGRATION_TRACE_ENABLED = True"
            if marker not in text:
                insert_at = 0
                lines = text.splitlines()
                for idx, line in enumerate(lines):
                    stripped = line.strip()
                    if stripped.startswith("import ") or stripped.startswith("from "):
                        insert_at = idx + 1
                lines.insert(insert_at, marker)
                text = "\n".join(lines) + ("\n" if original.endswith("\n") else "")
                changed = True
                mode_bits.append("integration_trace")

        if target_path.endswith("app/services/eval_matrix.py") and mutation_kind == "evaluation":
            helper_name = "_agentic_confidence_floor"
            if helper_name not in text:
                helper = [
                    "",
                    "",
                    f"def {helper_name}(value: float) -> float:",
                    "    return max(0.0, min(1.0, float(value)))",
                    "",
                ]
                text = text.rstrip("\n") + "\n" + "\n".join(helper)
                changed = True
                mode_bits.append("confidence_floor")

        if not changed and "def train(" in text:
            helper_name = f"_agentic_mutation_payload_{patch_index}_{target_index}"
            if helper_name not in text:
                helper = [
                    "",
                    "",
                    f"def {helper_name}(step_index: int) -> dict:",
                    "    return {",
                    f'        "node_run_id": {json.dumps(node_run_id, ensure_ascii=False)},',
                    f'        "node_id": {json.dumps(node_id, ensure_ascii=False)},',
                    f'        "strategy": {json.dumps(strategy, ensure_ascii=False)},',
                    f'        "mutation_kind": {json.dumps(mutation_kind, ensure_ascii=False)},',
                    f'        "summary": {json.dumps(summary, ensure_ascii=False)},',
                    '        "score": round(min(1.0, 0.2 + 0.01 * float(step_index)), 4),',
                    "    }",
                    "",
                ]
                insert_at = text.find("def train(")
                if insert_at > 0:
                    text = text[:insert_at] + "\n".join(helper) + text[insert_at:]
                else:
                    text = text.rstrip("\n") + "\n" + "\n".join(helper)
                changed = True
                mode_bits.append("payload_helper")

        mode = "python_semantic:" + "+".join(mode_bits) if mode_bits else "python_noop"
        return text, mode, changed

    def _mutate_target_content(
        self,
        *,
        target_path: str,
        original: str,
        patch: Dict[str, Any],
        node_run_id: str,
        node_id: str,
        patch_index: int,
        target_index: int,
    ) -> Tuple[str, str]:
        strategy = str(patch.get("strategy") or "mutation")
        mutation_kind = str(patch.get("mutationKind") or "code")
        summary = _short(str(patch.get("changeSummary") or "Agentic mutation proposal"), limit=220)
        suffix = Path(target_path).suffix.lower()
        generated_at = _now_iso()
        mutation_meta = {
            "node_run_id": node_run_id,
            "node_id": node_id,
            "strategy": strategy,
            "mutation_kind": mutation_kind,
            "summary": summary,
            "generated_at": generated_at,
        }

        if suffix == ".json":
            try:
                payload = json.loads(original)
                if isinstance(payload, dict):
                    payload["_agenticMutation"] = mutation_meta
                    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n", "json_metadata"
            except Exception:
                pass

        if suffix == ".py":
            semantic_mutated, semantic_mode, semantic_changed = self._mutate_python_content(
                target_path=target_path,
                original=original,
                mutation_kind=mutation_kind,
                strategy=strategy,
                summary=summary,
                node_run_id=node_run_id,
                node_id=node_id,
                patch_index=patch_index,
                target_index=target_index,
            )
            if semantic_changed and semantic_mutated != original:
                return semantic_mutated, semantic_mode
            marker = re.sub(r"[^a-zA-Z0-9_]+", "_", f"{node_run_id}_{patch_index}_{target_index}").strip("_")
            marker = marker or "mutation"
            tail = [
                "",
                "",
                f"def _agentic_mutation_marker_{marker}():",
                '    """Generated by Agentic OS node-run for replay evidence."""',
                "    return {",
                f'        "node_run_id": {json.dumps(node_run_id, ensure_ascii=False)},',
                f'        "node_id": {json.dumps(node_id, ensure_ascii=False)},',
                f'        "strategy": {json.dumps(strategy, ensure_ascii=False)},',
                f'        "mutation_kind": {json.dumps(mutation_kind, ensure_ascii=False)},',
                f'        "summary": {json.dumps(summary, ensure_ascii=False)},',
                f'        "generated_at": {json.dumps(generated_at, ensure_ascii=False)},',
                "    }",
                "",
            ]
            base = original.rstrip("\n")
            return base + "\n" + "\n".join(tail), "python_marker"

        if suffix in {".ts", ".tsx", ".js", ".jsx", ".c", ".cc", ".cpp", ".java", ".go", ".rs"}:
            marker = f"// agentic-mutation node_run={node_run_id} strategy={strategy} kind={mutation_kind} summary={summary}"
        elif suffix == ".md":
            marker = f"<!-- agentic-mutation node_run={node_run_id} strategy={strategy} kind={mutation_kind} summary={summary} -->"
        else:
            marker = f"# agentic-mutation node_run={node_run_id} strategy={strategy} kind={mutation_kind} summary={summary}"
        base = original if original.endswith("\n") else original + "\n"
        return base + marker + "\n", "text_marker"

    def _materialize_node_run_patch_artifacts(
        self,
        *,
        state: Dict[str, Any],
        node: Dict[str, Any],
        node_run: Dict[str, Any],
        node_run_dir: Path,
    ) -> Tuple[List[str], Dict[str, Any]]:
        run_id = str(state.get("run_id") or "")
        run_dir = self._run_dir(run_id)
        node_run_id = str(node_run.get("nodeRunId") or "")
        node_id = str(node.get("node_id") or "")
        workspace_dir = node_run_dir / "workspace"
        workspace_dir.mkdir(parents=True, exist_ok=True)

        patch_paths: List[str] = []
        patch_plan = [item for item in (node_run.get("patchPlan") or []) if isinstance(item, dict)]
        manifest: Dict[str, Any] = {
            "generatedAt": _now_iso(),
            "workspaceRoot": str(self.workspace_root),
            "nodeRunId": node_run_id,
            "nodeId": node_id,
            "patches": [],
            "files": [],
            "unresolvedTargets": [],
            "pythonSyntaxErrors": [],
            "summary": {},
        }

        total_targets = 0
        resolved_targets = 0

        for idx, patch in enumerate(patch_plan, start=1):
            target_files = self._normalize_target_files(patch.get("targetFiles") or [])
            patch_meta = {
                "index": idx,
                "strategy": str(patch.get("strategy") or "mutation"),
                "mutationKind": str(patch.get("mutationKind") or "code"),
                "changeSummary": str(patch.get("changeSummary") or ""),
                "resolvedTargets": [],
                "unresolvedTargets": [],
            }
            total_targets += len(target_files)
            diff_chunks: List[str] = []

            for target_index, raw_target in enumerate(target_files, start=1):
                rel_target, source_path = self._resolve_target_path(raw_target)
                target_label = rel_target or raw_target
                if not rel_target or source_path is None:
                    patch_meta["unresolvedTargets"].append(target_label)
                    manifest["unresolvedTargets"].append(target_label)
                    continue
                if not source_path.exists() or not source_path.is_file():
                    patch_meta["unresolvedTargets"].append(target_label)
                    manifest["unresolvedTargets"].append(target_label)
                    continue

                try:
                    original = source_path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    patch_meta["unresolvedTargets"].append(target_label)
                    manifest["unresolvedTargets"].append(target_label)
                    continue
                except Exception:
                    patch_meta["unresolvedTargets"].append(target_label)
                    manifest["unresolvedTargets"].append(target_label)
                    continue

                mutated, mutation_mode = self._mutate_target_content(
                    target_path=rel_target,
                    original=original,
                    patch=patch,
                    node_run_id=node_run_id,
                    node_id=node_id,
                    patch_index=idx,
                    target_index=target_index,
                )

                workspace_target = workspace_dir / rel_target
                _atomic_write_text(workspace_target, mutated, encoding="utf-8")

                diff_text = "".join(
                    difflib.unified_diff(
                        original.splitlines(keepends=True),
                        mutated.splitlines(keepends=True),
                        fromfile=f"a/{rel_target}",
                        tofile=f"b/{rel_target}",
                    )
                )
                if diff_text:
                    if not diff_text.endswith("\n"):
                        diff_text += "\n"
                    diff_chunks.append(diff_text)

                syntax_valid: Optional[bool] = None
                syntax_error: Optional[str] = None
                if rel_target.endswith(".py"):
                    try:
                        compile(mutated, rel_target, "exec")
                        syntax_valid = True
                    except Exception as exc:
                        syntax_valid = False
                        syntax_error = _short(str(exc), limit=240)
                        manifest["pythonSyntaxErrors"].append({"target": rel_target, "error": syntax_error})

                file_record: Dict[str, Any] = {
                    "target": rel_target,
                    "sourcePath": str(source_path),
                    "workspacePath": str(workspace_target),
                    "mutationMode": mutation_mode,
                    "sourceSha256": hashlib.sha256(original.encode("utf-8")).hexdigest(),
                    "mutatedSha256": hashlib.sha256(mutated.encode("utf-8")).hexdigest(),
                }
                if syntax_valid is not None:
                    file_record["syntaxValid"] = syntax_valid
                if syntax_error:
                    file_record["syntaxError"] = syntax_error
                manifest["files"].append(file_record)
                patch_meta["resolvedTargets"].append(rel_target)
                resolved_targets += 1

            if diff_chunks:
                patch_file = node_run_dir / f"patch_{idx:02d}.diff"
                _atomic_write_text(patch_file, "".join(diff_chunks), encoding="utf-8")
                rel_patch = str(patch_file.relative_to(run_dir))
                patch_paths.append(rel_patch)
                patch_meta["patchFile"] = rel_patch
                patch_meta["diffChunks"] = len(diff_chunks)
            manifest["patches"].append(patch_meta)

        manifest["summary"] = {
            "totalTargets": total_targets,
            "resolvedTargets": resolved_targets,
            "unresolvedTargets": len(manifest.get("unresolvedTargets") or []),
            "diffFiles": len([path for path in patch_paths if path.endswith(".diff")]),
            "pythonSyntaxChecked": len([row for row in (manifest.get("files") or []) if str(row.get("target") or "").endswith(".py")]),
            "pythonSyntaxFailed": len(manifest.get("pythonSyntaxErrors") or []),
        }
        manifest_path = node_run_dir / "workspace_manifest.json"
        _atomic_write_text(manifest_path, json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
        patch_paths.append(str(manifest_path.relative_to(run_dir)))

        if any(path.endswith(".diff") for path in patch_paths):
            apply_script = node_run_dir / "apply_patch.sh"
            script_lines = [
                "#!/usr/bin/env bash",
                "set -euo pipefail",
                'ROOT_DIR="${1:-$(pwd)}"',
                'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
                'for patch in "${SCRIPT_DIR}"/patch_*.diff; do',
                '  if [ -f "${patch}" ]; then',
                '    git -C "${ROOT_DIR}" apply "${patch}"',
                "  fi",
                "done",
            ]
            _atomic_write_text(apply_script, "\n".join(script_lines) + "\n", encoding="utf-8")
            try:
                os.chmod(apply_script, 0o755)
            except OSError:
                pass
            patch_paths.append(str(apply_script.relative_to(run_dir)))

        # Record workspace directory for replay tooling.
        patch_paths.append(str(workspace_dir.relative_to(run_dir)))
        return list(dict.fromkeys(patch_paths)), manifest

    def _preview_diff_excerpt(self, diff_text: str, *, max_lines: int = 24, max_chars: int = 2400) -> str:
        rows: List[str] = []
        for line in str(diff_text).splitlines():
            if line.startswith("--- ") or line.startswith("+++ "):
                continue
            if line.startswith("@@") or line.startswith("+") or line.startswith("-"):
                rows.append(line)
            if len(rows) >= max_lines:
                break
        if not rows:
            rows = str(diff_text).splitlines()[:max_lines]
        excerpt = "\n".join(rows).strip()
        if len(excerpt) > max_chars:
            excerpt = excerpt[: max_chars - 3] + "..."
        return excerpt

    def _build_node_run_artifact_evidence(
        self,
        *,
        node_run: Dict[str, Any],
        workspace_manifest: Dict[str, Any],
        run_dir: Path,
    ) -> Dict[str, Any]:
        files = workspace_manifest.get("files") if isinstance(workspace_manifest, dict) else []
        patch_rows = workspace_manifest.get("patches") if isinstance(workspace_manifest, dict) else []
        file_mutations: List[Dict[str, Any]] = []
        diff_previews: List[Dict[str, Any]] = []
        patch_plan = [item for item in (node_run.get("patchPlan") or []) if isinstance(item, dict)]

        for item in list(files or [])[:16]:
            if not isinstance(item, dict):
                continue
            file_mutations.append(
                {
                    "target": str(item.get("target") or ""),
                    "mutationMode": str(item.get("mutationMode") or ""),
                    "syntaxValid": item.get("syntaxValid"),
                    "syntaxError": str(item.get("syntaxError") or ""),
                }
            )

        for idx, item in enumerate(list(patch_rows or [])[:8]):
            if not isinstance(item, dict):
                continue
            patch_rel = str(item.get("patchFile") or "")
            patch_path = run_dir / patch_rel if patch_rel else None
            preview = ""
            if patch_path is not None and patch_path.exists():
                try:
                    preview = self._preview_diff_excerpt(patch_path.read_text(encoding="utf-8"))
                except Exception:
                    preview = ""
            plan = patch_plan[idx] if idx < len(patch_plan) else {}
            diff_previews.append(
                {
                    "patchFile": patch_rel,
                    "targets": list(item.get("resolvedTargets") or []),
                    "mutationKind": str(plan.get("mutationKind") or item.get("mutationKind") or ""),
                    "strategy": str(plan.get("strategy") or ""),
                    "changeSummary": str(plan.get("changeSummary") or ""),
                    "validationCommand": str(plan.get("validationCommand") or ""),
                    "preview": preview,
                }
            )

        return {
            "fileMutations": file_mutations,
            "diffPreviews": diff_previews,
        }

    def _start_node_run(self, state: Dict[str, Any], node: Dict[str, Any]) -> Dict[str, Any]:
        run_id = str(state.get("run_id") or "")
        node_id = str(node.get("node_id") or "")
        node_runs = state.setdefault("node_runs", [])
        node_run_id = f"nr-{len(node_runs) + 1:04d}"
        parent_node_id = str(node.get("parent_id") or "").strip() or None
        parent_node_run_id = self._latest_node_run_id(state, parent_node_id)
        started_at = _now_iso()
        patch_plan = self._derive_node_patch_plan(state, node)
        replay_start_seq = int((state.get("audit_chain") or {}).get("seq") or 0)
        artifact_paths = [
            f"artifacts/node_runs/{node_run_id}/run.json",
            f"artifacts/node_runs/{node_run_id}/patch_plan.json",
        ]
        node_run = {
            "nodeRunId": node_run_id,
            "runId": run_id,
            "nodeId": node_id,
            "parentNodeId": parent_node_id,
            "parentNodeRunId": parent_node_run_id,
            "agent": str(node.get("agent") or "Agent"),
            "title": str(node.get("title") or node_id),
            "status": "RUNNING",
            "startedAt": started_at,
            "finishedAt": None,
            "patchPlan": patch_plan,
            "metrics": {},
            "artifactPaths": artifact_paths,
            "replayRef": {"startSeq": replay_start_seq, "endSeq": replay_start_seq},
            "error": None,
        }
        node_runs.append(node_run)

        run_dir = self._run_dir(run_id)
        node_run_dir = self._node_run_dir(run_id, node_run_id)
        node_run_dir.mkdir(parents=True, exist_ok=True)
        _atomic_write_text(node_run_dir / "run.json", json.dumps(node_run, indent=2, ensure_ascii=False), encoding="utf-8")
        _atomic_write_text(
            node_run_dir / "patch_plan.json",
            json.dumps(patch_plan, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
            node["evidence"] = evidence
        refs = evidence.get("nodeRunIds")
        if not isinstance(refs, list):
            refs = []
            evidence["nodeRunIds"] = refs
        if node_run_id not in refs:
            refs.append(node_run_id)
        evidence["latestNodeRunId"] = node_run_id
        evidence["nodeRunDir"] = str(node_run_dir.relative_to(run_dir))
        return node_run

    def _finalize_node_run(
        self,
        state: Dict[str, Any],
        node: Dict[str, Any],
        node_run: Optional[Dict[str, Any]],
        *,
        status: str,
        error: Optional[str] = None,
    ) -> None:
        if not isinstance(node_run, dict):
            return
        run_id = str(state.get("run_id") or "")
        node_run_id = str(node_run.get("nodeRunId") or "")
        if not run_id or not node_run_id:
            return
        run_dir = self._run_dir(run_id)
        node_run_dir = self._node_run_dir(run_id, node_run_id)
        node_run_dir.mkdir(parents=True, exist_ok=True)
        finished_at = _now_iso()
        replay_end_seq = int((state.get("audit_chain") or {}).get("seq") or 0)
        metrics = self._extract_node_run_metrics(node)
        node_run["status"] = str(status).upper()
        node_run["finishedAt"] = finished_at
        node_run["metrics"] = metrics
        node_run["replayRef"] = {
            "startSeq": int((node_run.get("replayRef") or {}).get("startSeq") or 0),
            "endSeq": replay_end_seq,
            "eventCount": max(
                0,
                replay_end_seq - int((node_run.get("replayRef") or {}).get("startSeq") or 0) + 1,
            ),
        }
        node_run["error"] = str(error) if error else None

        patch_paths, workspace_manifest = self._materialize_node_run_patch_artifacts(
            state=state,
            node=node,
            node_run=node_run,
            node_run_dir=node_run_dir,
        )
        mutation_summary = workspace_manifest.get("summary") if isinstance(workspace_manifest, dict) else {}
        metrics["nodeRunArtifacts"] = {
            "diffFiles": int(mutation_summary.get("diffFiles") or 0),
            "resolvedTargets": int(mutation_summary.get("resolvedTargets") or 0),
            "unresolvedTargets": int(mutation_summary.get("unresolvedTargets") or 0),
            "pythonSyntaxFailed": int(mutation_summary.get("pythonSyntaxFailed") or 0),
        }
        metrics["nodeRunArtifacts"].update(
            self._build_node_run_artifact_evidence(
                node_run=node_run,
                workspace_manifest=workspace_manifest if isinstance(workspace_manifest, dict) else {},
                run_dir=run_dir,
            )
        )
        node_run["metrics"] = metrics

        diff_files = int((metrics.get("nodeRunArtifacts") or {}).get("diffFiles") or 0)
        if diff_files > 0:
            self._append_event(
                state,
                event="code_changed",
                message=f"{node.get('node_id')} produced {diff_files} diff artifact(s)",
                payload={
                    "node_id": node.get("node_id"),
                    "nodeRunId": node_run_id,
                    "diffFiles": diff_files,
                    "resolvedTargets": int((metrics.get("nodeRunArtifacts") or {}).get("resolvedTargets") or 0),
                },
                actor=str(node.get("agent") or "Agent"),
            )

        result_payload = {
            "nodeRunId": node_run_id,
            "runId": run_id,
            "nodeId": str(node.get("node_id") or ""),
            "status": node_run["status"],
            "finishedAt": finished_at,
            "metrics": metrics,
            "error": node_run.get("error"),
            "replayRef": node_run.get("replayRef") or {},
        }
        _atomic_write_text(node_run_dir / "result.json", json.dumps(result_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        _atomic_write_text(
            node_run_dir / "node_evidence.json",
            json.dumps(node.get("evidence") or {}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        artifact_paths = list(node_run.get("artifactPaths") or [])
        artifact_paths.extend(
            [
                str((node_run_dir / "result.json").relative_to(run_dir)),
                str((node_run_dir / "node_evidence.json").relative_to(run_dir)),
            ]
        )
        artifact_paths.extend(patch_paths)
        node_run["artifactPaths"] = list(dict.fromkeys(str(path) for path in artifact_paths if str(path).strip()))
        _atomic_write_text(node_run_dir / "run.json", json.dumps(node_run, indent=2, ensure_ascii=False), encoding="utf-8")

        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
            node["evidence"] = evidence
        evidence["latestNodeRunId"] = node_run_id
        evidence["latestNodeRunStatus"] = node_run.get("status")
        evidence["latestNodeRunArtifacts"] = list(node_run.get("artifactPaths") or [])
        evidence["latestNodeRunWorkspaceSummary"] = workspace_manifest.get("summary") if isinstance(workspace_manifest, dict) else {}

    def _set_node_story(
        self,
        node: Dict[str, Any],
        *,
        why: str,
        analysis: Dict[str, Any],
        changes: Dict[str, Any],
        run: Dict[str, Any],
        decision: Dict[str, Any],
    ) -> None:
        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
            node["evidence"] = evidence
        evidence["story"] = {
            "whyThisStep": _short(why, limit=360),
            "analysis": analysis if isinstance(analysis, dict) else {"summary": str(analysis)},
            "changes": changes if isinstance(changes, dict) else {"summary": str(changes)},
            "run": run if isinstance(run, dict) else {"summary": str(run)},
            "decision": decision if isinstance(decision, dict) else {"summary": str(decision)},
            "updatedAt": _now_iso(),
        }

    def _execute_node(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        run_id = str(state.get("run_id"))
        node_id = str(node.get("node_id"))
        agent = str(node.get("agent") or "Agent")
        title = str(node.get("title") or node_id)
        self._ensure_search_node_state(state, node)
        node["status"] = "RUNNING"
        node_run: Optional[Dict[str, Any]] = None

        self._append_event(
            state,
            event="node_started",
            message=f"{node_id} started",
            payload={"node_id": node_id, "agent": agent, "title": title},
        )
        node_run = self._start_node_run(state, node)

        try:
            if agent == "SafetyAgent":
                self._run_safety_gate(state, node)
            elif agent == "IntegrationAgent":
                self._run_integration_lane(state, node)
            elif title.startswith("Repair Branch"):
                self._run_repair_lane(state, node)
            elif agent == "EvalAgent":
                self._run_eval_lane(state, node)
            elif agent == "ResearchAgent":
                self._run_research_lane(state, node)
            else:
                self._run_ops_lane(state, node)
        except Exception as exc:
            stack = traceback.format_exc(limit=4)
            failure = self._build_failure_report(state, node, exc, stack)
            node["status"] = "FAILED"
            node["evidence"] = {
                **(node.get("evidence") or {}),
                "failure": failure,
            }
            state["failure_reason"] = failure["reason"]
            state.setdefault("failure_history", []).append(failure)
            self._write_error_report(state, failure)
            self._append_event(
                state,
                event="node_failed",
                message=f"{node_id} failed: {failure['reason']}",
                payload={"node_id": node_id, "reason": failure["reason"]},
            )
            self._append_event(
                state,
                event="node_completed",
                message=f"{node_id} completed",
                payload={"node_id": node_id, "agent": agent, "status": "FAILED", "reason": failure["reason"]},
            )
            self._finalize_node_run(state, node, node_run, status="FAILED", error=str(failure["reason"]))
            self._append_log(state, f"[{node_id}] FAILED {failure['reason']}")
            self._record_search_result(state, node, succeeded=False, failure=failure)

            if agent == "IntegrationAgent":
                fix_node = self._create_fix_branch(state, node, failure)
                if fix_node is not None:
                    self._append_event(
                        state,
                        event="fix_branch_created",
                        message=f"Created repair node {fix_node['node_id']}",
                        payload={"from": node_id, "repair_node": fix_node["node_id"]},
                    )
                    # Auto-run repair path in all-mode behavior.
                    if self._can_apply_fix_without_approval(state, failure):
                        fix_node["status"] = "PENDING"
                        self._run_repair_lane(state, fix_node)
                        node["status"] = "RETRY_PENDING"
                        self._append_event(
                            state,
                            event="retry_scheduled",
                            message=f"Retry scheduled for {node_id}",
                            payload={"node_id": node_id},
                        )
                        self._run_integration_lane(state, node, retry=True)
            return

        if str(node.get("status") or "").upper() == "BLOCKED":
            self._record_search_result(state, node, succeeded=False, failure={"reason": "blocked"})
            self._append_event(
                state,
                event="node_blocked",
                message=f"{node_id} blocked",
                payload={"node_id": node_id, "agent": agent},
            )
            self._append_event(
                state,
                event="node_completed",
                message=f"{node_id} completed",
                payload={"node_id": node_id, "agent": agent, "status": "BLOCKED"},
            )
            self._finalize_node_run(state, node, node_run, status="BLOCKED", error="blocked")
            self._append_log(state, f"[{node_id}] BLOCKED")
            return

        self._record_search_result(state, node, succeeded=True, failure=None)
        self._maybe_expand_search_frontier(state, node)
        self._append_event(
            state,
            event="node_succeeded",
            message=f"{node_id} succeeded",
            payload={"node_id": node_id, "agent": agent},
        )
        self._append_event(
            state,
            event="node_completed",
            message=f"{node_id} completed",
            payload={"node_id": node_id, "agent": agent, "status": "SUCCEEDED"},
        )
        self._finalize_node_run(state, node, node_run, status="SUCCEEDED")

    def _run_research_lane(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        plans = self._runtime_lane_plans(state, lane="research", node=node)
        sub_agents = self._spawn_sub_agents(state, node, plans=plans, depth=1)
        metric_key = next(iter((state.get("research_spec", {}).get("successMetrics") or {"winRate": ">=0.55"}).keys()))
        mutation_templates = self._runtime_code_mutation_templates(state, node)[:3]
        retrieval = self.retrieve_context(f"research hypothesis {state.get('research_spec', {}).get('taskGoal')}", k=3)
        mutation_candidates = [
            {
                "strategy": str(item.get("strategy") or "mutation"),
                "mutationKind": str(item.get("mutationKind") or "code"),
                "changeSummary": str(item.get("changeSummary") or ""),
                "targetFiles": self._normalize_target_files(item.get("targetFiles") or []),
                "validationCommand": str(item.get("validationCommand") or ""),
            }
            for item in mutation_templates
        ]
        node["status"] = "SUCCEEDED"
        node["sub_agents"] = sub_agents
        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
        evidence.update(
            {
            "candidateAlgorithms": ["mappo", "qmix"],
            "selected": "mappo",
            "expectedLift": {metric_key: 0.05},
            "mutationFocus": ["architecture", "loss", "objective"],
            "retrieval": retrieval,
            "codeMutationCandidates": mutation_candidates,
            "subAgents": sub_agents,
            }
        )
        node["evidence"] = evidence
        self._set_node_story(
            node,
            why=str(node.get("rationale") or "Generate executable code-mutation hypotheses before running experiments."),
            analysis={
                "metric": metric_key,
                "retrievalContext": retrieval,
                "lanePlans": plans,
                "subAgentCount": len(sub_agents),
                "llmEnabled": self._is_node_llm_enabled(state, node),
            },
            changes={
                "mutationCandidates": mutation_candidates,
                "candidateCount": len(mutation_candidates),
            },
            run={
                "status": "not_executed",
                "notExecuted": True,
                "reason": "planning_lane_only",
            },
            decision={
                "nextStep": "integration_check",
                "reason": "Validate adapter compatibility before launching execution node.",
            },
        )
        node["next_suggestions"] = [
            "Run integration compatibility check",
            "Preserve baseline control arm",
        ]
        self._append_timeline(state, node, "research_completed", cost=0.4)
        self._append_log(state, f"[{node['node_id']}] Research hypotheses generated")

    def _run_integration_lane(self, state: Dict[str, Any], node: Dict[str, Any], retry: bool = False) -> None:
        if bool(state.get("induce_failure")) and not bool(state.get("failure_injected")):
            state["failure_injected"] = True
            raise ModuleNotFoundError("No module named 'pettingzoo'")

        plans = self._runtime_lane_plans(state, lane="integration_base", node=node)
        if not retry:
            plans.extend(self._runtime_lane_plans(state, lane="integration_fresh_only", node=node))
        sub_agents = self._spawn_sub_agents(state, node, plans=plans, depth=1)
        adapter_mode = self._execution_adapter_mode(state)
        mutation_templates = self._runtime_code_mutation_templates(state, node)[:2]
        retrieval = self.retrieve_context("adapter generation runner contract", k=3)
        node["status"] = "SUCCEEDED"
        node["sub_agents"] = sub_agents
        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
        adapter_candidates = [
            {
                "strategy": str(item.get("strategy") or "adapter_patch"),
                "changeSummary": str(item.get("changeSummary") or ""),
                "targetFiles": self._normalize_target_files(item.get("targetFiles") or []),
                "validationCommand": str(item.get("validationCommand") or ""),
            }
            for item in mutation_templates
        ]
        evidence.update(
            {
            "adapterMode": adapter_mode,
            "runnerContract": "train(config, metrics_path, checkpoint_dir, run_id)",
            "retrieval": retrieval,
            "retry": retry,
            "adapterPatchCandidates": adapter_candidates,
            "subAgents": sub_agents,
            }
        )
        node["evidence"] = evidence
        self._set_node_story(
            node,
            why=str(node.get("rationale") or "Integration lane must ensure executable adapter compatibility."),
            analysis={
                "adapterMode": adapter_mode,
                "retrievalContext": retrieval,
                "lanePlans": plans,
                "retry": retry,
                "llmEnabled": self._is_node_llm_enabled(state, node),
            },
            changes={
                "adapterPatchCandidates": adapter_candidates,
                "candidateCount": len(adapter_candidates),
            },
            run={
                "status": "not_executed",
                "notExecuted": True,
                "reason": "integration_validation_only",
            },
            decision={
                "nextStep": "execute_candidate_run",
                "reason": "Adapter contract is ready, continue to experiment execution.",
            },
        )
        node["next_suggestions"] = ["Proceed to execution node", "Record adapter provenance"]
        self._append_timeline(state, node, "integration_completed", cost=0.6)
        self._append_log(state, f"[{node['node_id']}] Integration lane completed (retry={retry})")

    def _run_ops_lane(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        title_lower = str(node.get("title") or "").strip().lower()
        if "execute candidate" in title_lower and "run" in title_lower:
            self._run_execution_lane(state, node)
            return

        plans = self._runtime_lane_plans(state, lane="ops_budget_guard", node=node)
        sub_agents = self._spawn_sub_agents(state, node, plans=plans, depth=1) if plans else []
        budget_used = {
            "gpuHours": min(1.5, float(state.get("research_spec", {}).get("budget", {}).get("gpuHours") or 0)),
            "wallclockMinutes": min(45, int(state.get("research_spec", {}).get("budget", {}).get("wallclockMinutes") or 60)),
        }
        node["status"] = "SUCCEEDED"
        node["sub_agents"] = sub_agents
        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
        evidence.update(
            {
            "budgetUsed": budget_used,
            "fallback": "offline_stub",
            "resourceHints": ["limit totalEnvSteps on low budget", "prefer local executor"],
            "subAgents": sub_agents,
            }
        )
        node["evidence"] = evidence
        self._set_node_story(
            node,
            why=str(node.get("rationale") or "Budget guard sets safe runtime bounds before experiments."),
            analysis={
                "budgetUsed": budget_used,
                "lanePlans": plans,
                "subAgentCount": len(sub_agents),
                "llmEnabled": self._is_node_llm_enabled(state, node),
            },
            changes={
                "resourceHints": ["limit totalEnvSteps on low budget", "prefer local executor"],
                "fallback": "offline_stub",
            },
            run={
                "status": "not_executed",
                "notExecuted": True,
                "reason": "ops_planning_lane_only",
            },
            decision={
                "nextStep": "execute_candidate_run",
                "reason": "Budget and fallback policy set; experiment run can start.",
            },
        )
        self._append_timeline(state, node, "ops_completed", cost=0.3)
        self._append_log(state, f"[{node['node_id']}] Ops lane applied budgets and fallback")

    def _run_execution_lane(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        run_id = str(state.get("run_id") or "")
        run_dir = self._run_dir(run_id)
        run_dir.mkdir(parents=True, exist_ok=True)
        runtime_path = run_dir / "artifacts" / "runtime_execution.json"
        adapter_mode = self._execution_adapter_mode(state)
        constraints = (state.get("research_spec") or {}).get("constraints") or {}
        approval_policy = self._approval_policy(state)
        approved = set(state.get("approved_actions") or [])

        self._append_event(
            state,
            event="experiment_started",
            message=f"{node.get('node_id')} experiment started",
            payload={
                "node_id": node.get("node_id"),
                "mode": adapter_mode,
                "executionMode": adapter_mode,
            },
            actor=str(node.get("agent") or "OpsAgent"),
        )

        if adapter_mode == "local_shell":
            gate = self._evaluate_action_policy(
                "unknown_script_execution",
                constraints,
                approved,
                approval_policy=approval_policy,
            )
            if gate.get("pendingApproval"):
                self._ensure_pending_approval(
                    state=state,
                    node_id=str(node.get("node_id") or ""),
                    action="unknown_script_execution",
                    reason=str(gate.get("reasonCode") or "approval_required"),
                    prompt="Approve local shell execution adapter?",
                    required_roles=[str(v) for v in (gate.get("requiredRoles") or [])],
                    required_approvals=int(gate.get("requiredApprovals") or 1),
                    require_distinct_roles=bool(gate.get("requireDistinctRoles") or False),
                    ttl_minutes=int(gate.get("approvalTtlMinutes") or 120),
                )
                node["status"] = "BLOCKED"
                evidence = node.get("evidence")
                if not isinstance(evidence, dict):
                    evidence = {}
                evidence.update(
                    {
                    "execution": {"mode": adapter_mode, "status": "blocked"},
                    "blockedActions": ["unknown_script_execution"] if gate.get("blockedByPolicy") else [],
                    "requiredApprovals": ["unknown_script_execution"],
                    "actionPolicy": gate,
                    }
                )
                node["evidence"] = evidence
                runtime_path.parent.mkdir(parents=True, exist_ok=True)
                _atomic_write_text(
                    runtime_path,
                    json.dumps(
                        {
                            "status": "BLOCKED",
                            "mode": adapter_mode,
                            "reason": str(gate.get("reasonCode") or "approval_required"),
                            "generatedAt": _now_iso(),
                        },
                        indent=2,
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                self._set_node_story(
                    node,
                    why="Execution node requires approval before local shell command can run.",
                    analysis={
                        "adapterMode": adapter_mode,
                        "actionPolicy": gate,
                        "approvedActions": sorted(approved),
                    },
                    changes={
                        "mutationApplied": False,
                    },
                    run={
                        "status": "blocked",
                        "mode": adapter_mode,
                        "notExecuted": True,
                        "reason": str(gate.get("reasonCode") or "approval_required"),
                    },
                    decision={
                        "nextStep": "wait_for_approval",
                        "reason": "Approval required before command execution.",
                    },
                )
                self._append_event(
                    state,
                    event="experiment_finished",
                    message=f"{node.get('node_id')} experiment blocked",
                    payload={
                        "node_id": node.get("node_id"),
                        "mode": adapter_mode,
                        "status": "BLOCKED",
                        "notExecuted": True,
                    },
                    actor=str(node.get("agent") or "OpsAgent"),
                )
                self._append_timeline(state, node, "execution_blocked", cost=0.05)
                self._append_log(state, f"[{node['node_id']}] Execution blocked by approval policy")
                return

        if adapter_mode == "local_shell":
            command = self._resolve_local_shell_command(state)
            timeout_seconds = self._execution_timeout_seconds(state)
            policy = self._local_shell_policy()
            max_output_chars = int(policy.get("maxOutputChars") or 2400)
            started_at = _now_iso()
            proc = subprocess.run(
                command,
                cwd=str(self.workspace_root),
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
            stdout_tail = _short(proc.stdout, limit=max_output_chars)
            stderr_tail = _short(proc.stderr, limit=max_output_chars)
            command_hash = _stable_hash({"command": command})
            runtime_report = {
                "mode": adapter_mode,
                "status": "SUCCEEDED" if proc.returncode == 0 else "FAILED",
                "command": command,
                "commandHash": command_hash,
                "returnCode": int(proc.returncode),
                "stdoutTail": stdout_tail,
                "stderrTail": stderr_tail,
                "timeoutSeconds": timeout_seconds,
                "policy": {
                    "allowedCommands": list(policy.get("allowedCommands") or []),
                    "blockedTokens": list(policy.get("blockedTokens") or []),
                },
                "startedAt": started_at,
                "finishedAt": _now_iso(),
            }
            runtime_path.parent.mkdir(parents=True, exist_ok=True)
            _atomic_write_text(runtime_path, json.dumps(runtime_report, indent=2, ensure_ascii=False), encoding="utf-8")
            if proc.returncode != 0:
                raise RuntimeError(f"local_shell_command_failed rc={proc.returncode}")
            outcome = {
                "mode": adapter_mode,
                "runtime": runtime_report,
                "newCheckpoint": self._emit_runtime_checkpoint(run_dir, state, source="local_shell"),
            }
        elif adapter_mode == "mle_runner":
            runtime_report = self._run_mle_runner_adapter(state=state, run_dir=run_dir)
            runtime_path.parent.mkdir(parents=True, exist_ok=True)
            _atomic_write_text(runtime_path, json.dumps(runtime_report, indent=2, ensure_ascii=False), encoding="utf-8")
            outcome = {
                "mode": adapter_mode,
                "runtime": runtime_report,
                "newCheckpoint": self._emit_runtime_checkpoint(run_dir, state, source="mle_runner"),
            }
        else:
            synthetic = {
                "winRate": round(0.55 + (int(hashlib.sha256(run_id.encode("utf-8")).hexdigest()[:4], 16) % 8) / 100.0, 4),
                "eloLift": int(20 + (int(hashlib.sha256(f"{run_id}:elo".encode('utf-8')).hexdigest()[:4], 16) % 25)),
            }
            runtime_report = {
                "mode": adapter_mode,
                "status": "NOT_EXECUTED",
                "simulated": True,
                "notExecuted": True,
                "metrics": synthetic,
                "commandHash": None,
                "reason": "offline_stub",
                "generatedAt": _now_iso(),
            }
            runtime_path.parent.mkdir(parents=True, exist_ok=True)
            _atomic_write_text(runtime_path, json.dumps(runtime_report, indent=2, ensure_ascii=False), encoding="utf-8")
            outcome = {
                "mode": adapter_mode,
                "runtime": runtime_report,
                "newCheckpoint": self._emit_runtime_checkpoint(run_dir, state, source="offline_stub", not_executed=True),
            }

        self._append_event(
            state,
            event="experiment_finished",
            message=f"{node.get('node_id')} experiment finished",
            payload={
                "node_id": node.get("node_id"),
                "mode": adapter_mode,
                "status": str((runtime_report or {}).get("status") or "UNKNOWN"),
                "returnCode": int((runtime_report or {}).get("returnCode") or 0),
                "notExecuted": bool((runtime_report or {}).get("notExecuted") or False),
            },
            actor=str(node.get("agent") or "OpsAgent"),
        )

        expansion = ((node.get("evidence") or {}).get("expansion") or {}) if isinstance(node.get("evidence"), dict) else {}
        mutation_plan = expansion.get("mutationPlan") if isinstance(expansion, dict) else None
        if not isinstance(mutation_plan, dict) or not mutation_plan:
            patch_candidates = self._runtime_code_mutation_templates(state, node)
            if patch_candidates:
                first = patch_candidates[0]
                mutation_plan = {
                    "strategy": str(first.get("strategy") or "execution_mutation"),
                    "mutationKind": str(first.get("mutationKind") or "code"),
                    "changeSummary": str(first.get("changeSummary") or ""),
                    "targetFiles": [str(v) for v in (first.get("targetFiles") or []) if str(v).strip()],
                    "validationCommand": str(first.get("validationCommand") or ""),
                }
            else:
                mutation_plan = {}

        node["status"] = "SUCCEEDED"
        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
        evidence.update(
            {
            "execution": outcome,
            "adapterMode": adapter_mode,
            "approvedActions": sorted(approved),
            "appliedMutationPlan": mutation_plan,
            "runtimeArtifact": "artifacts/runtime_execution.json",
            }
        )
        node["evidence"] = evidence
        self._set_node_story(
            node,
            why=str(node.get("rationale") or "Execution lane validates whether selected branch works in runtime."),
            analysis={
                "adapterMode": adapter_mode,
                "approvedActions": sorted(approved),
                "llmEnabled": self._is_node_llm_enabled(state, node),
            },
            changes={
                "appliedMutationPlan": mutation_plan,
            },
            run={
                "status": str((runtime_report or {}).get("status") or "UNKNOWN"),
                "mode": adapter_mode,
                "command": (runtime_report or {}).get("command"),
                "returnCode": int((runtime_report or {}).get("returnCode") or 0),
                "stdoutTail": str((runtime_report or {}).get("stdoutTail") or ""),
                "stderrTail": str((runtime_report or {}).get("stderrTail") or ""),
                "startedAt": str((runtime_report or {}).get("startedAt") or (runtime_report or {}).get("generatedAt") or ""),
                "finishedAt": str((runtime_report or {}).get("finishedAt") or (runtime_report or {}).get("generatedAt") or ""),
                "notExecuted": bool((runtime_report or {}).get("notExecuted") or False),
                "checkpoint": (outcome or {}).get("newCheckpoint") if isinstance(outcome, dict) else None,
            },
            decision={
                "nextStep": "build_matrix_or_export_repro",
                "reason": "Execution completed; move to comparison and reporting.",
            },
        )
        node["next_suggestions"] = ["Generate matrix league", "Export reproducibility bundle"]
        self._append_timeline(state, node, "execution_completed", cost=0.9)
        self._append_log(state, f"[{node['node_id']}] Execution lane completed mode={adapter_mode}")

    def _run_eval_lane(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        protocol = state.get("eval_protocol_draft") or {}
        plans = self._runtime_lane_plans(state, lane="eval", node=node)
        sub_agents = self._spawn_sub_agents(state, node, plans=plans, depth=1)
        mutation_templates = self._runtime_code_mutation_templates(state, node)[:2]
        retrieval = self.retrieve_context("evaluation protocol matrix confidence", k=3)
        eval_mutations = [
            {
                "strategy": str(item.get("strategy") or "eval_mutation"),
                "changeSummary": str(item.get("changeSummary") or ""),
                "targetFiles": self._normalize_target_files(item.get("targetFiles") or []),
                "validationCommand": str(item.get("validationCommand") or ""),
            }
            for item in mutation_templates
        ]
        node["status"] = "SUCCEEDED"
        node["sub_agents"] = sub_agents
        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
        evidence.update(
            {
            "protocol": protocol,
            "matrixPlan": protocol.get("matrixPlan", {}),
            "retrieval": retrieval,
            "evalMutationCandidates": eval_mutations,
            "subAgents": sub_agents,
            }
        )
        node["evidence"] = evidence
        self._set_node_story(
            node,
            why=str(node.get("rationale") or "Evaluation lane defines how to judge branch outcomes reliably."),
            analysis={
                "protocol": protocol,
                "retrievalContext": retrieval,
                "lanePlans": plans,
                "llmEnabled": self._is_node_llm_enabled(state, node),
            },
            changes={
                "evalMutationCandidates": eval_mutations,
                "candidateCount": len(eval_mutations),
            },
            run={
                "status": "not_executed",
                "notExecuted": True,
                "reason": "evaluation_planning_only",
            },
            decision={
                "nextStep": "execute_or_matrix",
                "reason": "Protocol ready for experiment outputs and matrix generation.",
            },
        )
        self._append_timeline(state, node, "eval_protocol_ready", cost=0.2)
        self._append_log(state, f"[{node['node_id']}] Eval protocol prepared")

    def _run_safety_gate(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        spec = state.get("research_spec") or {}
        constraints = spec.get("constraints") or {}
        approval_policy = self._approval_policy(state)
        requested = list(spec.get("requestedActions") or [])
        approved = set(state.get("approved_actions") or [])
        decisions = [self._evaluate_action_policy(action, constraints, approved, approval_policy=approval_policy) for action in requested]
        pending_actions = [row["action"] for row in decisions if row["pendingApproval"]]
        blocked_actions = [row["action"] for row in decisions if row["pendingApproval"] and row["blockedByPolicy"]]
        required_approvals = [row["action"] for row in decisions if row["pendingApproval"] and not row["blockedByPolicy"]]

        if pending_actions:
            node["status"] = "BLOCKED"
            for item in decisions:
                if not item["pendingApproval"]:
                    continue
                self._ensure_pending_approval(
                    state=state,
                    node_id=str(node.get("node_id")),
                    action=str(item["action"]),
                    reason=str(item["reasonCode"]),
                    prompt=str(item["prompt"]),
                    required_roles=[str(v) for v in (item.get("requiredRoles") or [])],
                    required_approvals=int(item.get("requiredApprovals") or 1),
                    require_distinct_roles=bool(item.get("requireDistinctRoles") or False),
                    ttl_minutes=int(item.get("approvalTtlMinutes") or 120),
                )

            evidence = node.get("evidence")
            if not isinstance(evidence, dict):
                evidence = {}
            evidence.update(
                {
                "blockedActions": blocked_actions,
                "requiredApprovals": required_approvals,
                "approvedActions": sorted(approved),
                "policy": {
                    "forbiddenActions": sorted(set(constraints.get("forbiddenActions") or [])),
                    "highRiskActions": list(approval_policy.get("highRiskActions") or []),
                    "allowNetwork": bool(constraints.get("allowNetwork")),
                    "allowDependencyInstall": bool(constraints.get("allowDependencyInstall")),
                    "approvalMode": approval_policy.get("mode"),
                    "requireApprovalForUnknownActions": bool(approval_policy.get("requireApprovalForUnknownActions")),
                    "minApprovals": int(approval_policy.get("minApprovals") or 1),
                    "requireDistinctRoles": bool(approval_policy.get("requireDistinctRoles")),
                    "approvalTtlMinutes": int(approval_policy.get("approvalTtlMinutes") or 120),
                },
                "actionPolicy": decisions,
                }
            )
            node["evidence"] = evidence
            self._set_node_story(
                node,
                why=str(node.get("rationale") or "Safety gate evaluates requested actions before execution."),
                analysis={
                    "requestedActions": requested,
                    "policyDecisions": decisions,
                    "approvalMode": approval_policy.get("mode"),
                },
                changes={
                    "blockedActions": blocked_actions,
                    "requiredApprovals": required_approvals,
                },
                run={
                    "status": "blocked",
                    "notExecuted": True,
                    "reason": "approval_required",
                },
                decision={
                    "nextStep": "wait_for_approval",
                    "reason": "Pending approvals must be resolved before execution continues.",
                },
            )
            self._append_timeline(state, node, "safety_blocked", cost=0.1)
            self._append_log(state, f"[{node['node_id']}] Safety blocked actions: {pending_actions}")
            return

        node["status"] = "SUCCEEDED"
        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
        evidence.update(
            {
            "blockedActions": [],
            "requiredApprovals": [],
            "approvedActions": sorted(approved),
            "policy": {
                "forbiddenActions": sorted(set(constraints.get("forbiddenActions") or [])),
                "highRiskActions": list(approval_policy.get("highRiskActions") or []),
                "allowNetwork": bool(constraints.get("allowNetwork")),
                "allowDependencyInstall": bool(constraints.get("allowDependencyInstall")),
                "approvalMode": approval_policy.get("mode"),
                "requireApprovalForUnknownActions": bool(approval_policy.get("requireApprovalForUnknownActions")),
                "minApprovals": int(approval_policy.get("minApprovals") or 1),
                "requireDistinctRoles": bool(approval_policy.get("requireDistinctRoles")),
                "approvalTtlMinutes": int(approval_policy.get("approvalTtlMinutes") or 120),
            },
            "actionPolicy": decisions,
            }
        )
        node["evidence"] = evidence
        self._set_node_story(
            node,
            why=str(node.get("rationale") or "Safety checks must pass before autonomous execution."),
            analysis={
                "requestedActions": requested,
                "policyDecisions": decisions,
                "approvalMode": approval_policy.get("mode"),
            },
            changes={
                "blockedActions": [],
                "requiredApprovals": [],
            },
            run={
                "status": "not_executed",
                "notExecuted": True,
                "reason": "safety_validation_only",
            },
            decision={
                "nextStep": "continue_execution",
                "reason": "No pending approvals; run can proceed.",
            },
        )
        self._append_timeline(state, node, "safety_passed", cost=0.1)
        self._append_log(state, f"[{node['node_id']}] Safety gate passed")

    def _run_repair_lane(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        fix_payload = (node.get("evidence") or {}).get("fixPayload") or {}
        action = str(fix_payload.get("action") or "switch_offline_stub")
        constraints = state.get("research_spec", {}).get("constraints", {})
        approval_policy = self._approval_policy(state)
        approved = set(state.get("approved_actions") or [])
        decision = self._evaluate_action_policy(action, constraints, approved, approval_policy=approval_policy)
        if decision["pendingApproval"]:
            self._ensure_pending_approval(
                state=state,
                node_id=str(node.get("node_id")),
                action=action,
                reason=str(decision["reasonCode"]),
                prompt=f"Approve repair action '{action}'?",
                required_roles=[str(v) for v in (decision.get("requiredRoles") or [])],
                required_approvals=int(decision.get("requiredApprovals") or 1),
                require_distinct_roles=bool(decision.get("requireDistinctRoles") or False),
                ttl_minutes=int(decision.get("approvalTtlMinutes") or 120),
            )
            node["status"] = "BLOCKED"
            evidence = node.get("evidence")
            if not isinstance(evidence, dict):
                evidence = {}
            evidence.update(
                {
                "blockedActions": [action] if decision["blockedByPolicy"] else [],
                "requiredApprovals": [action],
                "actionPolicy": decision,
                }
            )
            node["evidence"] = evidence
            self._set_node_story(
                node,
                why="Repair action requires explicit approval before it can be applied.",
                analysis={
                    "repairAction": action,
                    "policyDecision": decision,
                },
                changes={
                    "repairApplied": False,
                },
                run={
                    "status": "blocked",
                    "notExecuted": True,
                    "reason": str(decision.get("reasonCode") or "approval_required"),
                },
                decision={
                    "nextStep": "wait_for_approval",
                    "reason": "Repair action is gated by approval policy.",
                },
            )
            self._append_timeline(state, node, "repair_blocked", cost=0.05)
            self._append_log(state, f"[{node['node_id']}] Repair blocked for action {action}")
            return

        node["status"] = "SUCCEEDED"
        sub_agents = self._spawn_sub_agents(state, node, plans=self._runtime_lane_plans(state, lane="repair", node=node), depth=1)
        node["sub_agents"] = sub_agents
        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
        evidence.update(
            {
            "applied": True,
            "appliedAt": _now_iso(),
            "subAgents": sub_agents,
            }
        )
        node["evidence"] = evidence
        self._set_node_story(
            node,
            why="Repair lane applies the selected mitigation to recover failed branch execution.",
            analysis={
                "repairAction": action,
                "policyDecision": decision,
                "subAgentCount": len(sub_agents),
            },
            changes={
                "repairApplied": True,
                "action": action,
            },
            run={
                "status": "not_executed",
                "notExecuted": True,
                "reason": "repair_preparation_only",
            },
            decision={
                "nextStep": "retry_parent_node",
                "reason": "Repair action applied; upstream branch can retry.",
            },
        )
        self._append_timeline(state, node, "repair_applied", cost=0.15)
        self._append_log(state, f"[{node['node_id']}] Repair action applied: {action}")

    def _spawn_sub_agents(
        self,
        state: Dict[str, Any],
        node: Dict[str, Any],
        plans: List[Dict[str, str]],
        depth: int,
        parent_sub_agent_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        policy = self._sub_agent_policy(state)
        if not bool(policy.get("enabled")):
            self._append_event(
                state,
                event="sub_agent_skipped",
                message="Sub-agent spawning disabled by policy",
                payload={"node_id": str(node.get("node_id") or ""), "reason": "policy_disabled"},
                actor=str(node.get("agent") or "Agent"),
            )
            return []

        if not plans or depth > int(policy.get("maxDepth") or self.MAX_SUB_AGENT_DEPTH):
            return []

        spawned: List[Dict[str, Any]] = []
        node_id = str(node.get("node_id") or "")
        owner_agent = str(node.get("agent") or "Agent")
        max_per_node = int(policy.get("maxPerNode") or 3)
        max_total = int(policy.get("maxTotal") or 24)
        timeout_ms = int(policy.get("timeoutMs") or 1500)

        for plan in plans:
            if len(spawned) >= max_per_node:
                self._append_event(
                    state,
                    event="sub_agent_skipped",
                    message="Per-node sub-agent cap reached",
                    payload={
                        "node_id": node_id,
                        "parent_sub_agent_id": parent_sub_agent_id,
                        "reason": "max_per_node_reached",
                        "maxPerNode": max_per_node,
                    },
                    actor=owner_agent,
                )
                break

            if len(state.setdefault("sub_agents", [])) >= max_total:
                self._append_event(
                    state,
                    event="sub_agent_skipped",
                    message="Global sub-agent cap reached",
                    payload={
                        "node_id": node_id,
                        "parent_sub_agent_id": parent_sub_agent_id,
                        "reason": "max_total_reached",
                        "maxTotal": max_total,
                    },
                    actor=owner_agent,
                )
                break

            sub_agent_id = f"sa-{len(state.setdefault('sub_agents', [])) + 1:04d}"
            role = str(plan.get("role") or "GenericSubAgent")
            objective = str(plan.get("objective") or "Assist parent agent execution.")
            sub_agent: Dict[str, Any] = {
                "subAgentId": sub_agent_id,
                "parentNodeId": node_id,
                "parentSubAgentId": parent_sub_agent_id,
                "ownerAgent": owner_agent,
                "role": role,
                "objective": objective,
                "depth": depth,
                "status": "RUNNING",
                "startedAt": _now_iso(),
                "finishedAt": None,
                "evidence": {},
                "children": [],
            }
            state.setdefault("sub_agents", []).append(sub_agent)
            spawned.append(sub_agent)
            self._append_event(
                state,
                event="sub_agent_started",
                message=f"{sub_agent_id} started",
                payload={
                    "node_id": node_id,
                    "sub_agent_id": sub_agent_id,
                    "parent_sub_agent_id": parent_sub_agent_id,
                    "role": role,
                    "depth": depth,
                },
                actor=owner_agent,
            )

            try:
                evidence = self._execute_sub_agent_logic(state, node, sub_agent, plan)
                nested_plans = []
                if isinstance(evidence, dict):
                    nested_plans = list(evidence.pop("__spawn_plans__", []) or [])
                    estimated_ms = int(evidence.get("estimatedLatencyMs") or 0)
                    if estimated_ms > timeout_ms:
                        raise TimeoutError(f"sub_agent_timeout budget={timeout_ms}ms observed={estimated_ms}ms")
                sub_agent["status"] = "SUCCEEDED"
                sub_agent["evidence"] = evidence if isinstance(evidence, dict) else {"result": evidence}
                sub_agent["finishedAt"] = _now_iso()

                if nested_plans and depth < int(policy.get("maxDepth") or self.MAX_SUB_AGENT_DEPTH):
                    children = self._spawn_sub_agents(
                        state,
                        node,
                        plans=[p for p in nested_plans if isinstance(p, dict)],
                        depth=depth + 1,
                        parent_sub_agent_id=sub_agent_id,
                    )
                    sub_agent["children"] = [str(child.get("subAgentId")) for child in children]

                self._append_event(
                    state,
                    event="sub_agent_succeeded",
                    message=f"{sub_agent_id} succeeded",
                    payload={
                        "node_id": node_id,
                        "sub_agent_id": sub_agent_id,
                        "role": role,
                        "depth": depth,
                        "children": sub_agent.get("children") or [],
                    },
                    actor=owner_agent,
                )
            except Exception as exc:
                sub_agent["status"] = "FAILED"
                sub_agent["finishedAt"] = _now_iso()
                sub_agent["evidence"] = {"reason": str(exc), "timedOut": isinstance(exc, TimeoutError)}
                self._append_event(
                    state,
                    event="sub_agent_failed",
                    message=f"{sub_agent_id} failed: {exc}",
                    payload={
                        "node_id": node_id,
                        "sub_agent_id": sub_agent_id,
                        "role": role,
                        "depth": depth,
                        "reason": str(exc),
                    },
                    actor=owner_agent,
                )

        return spawned

    def _sub_agent_policy(self, state: Dict[str, Any]) -> Dict[str, Any]:
        policy = (state.get("research_spec") or {}).get("subAgentPolicy") or {}
        return {
            "enabled": bool(policy.get("enabled", True)),
            "maxDepth": int(max(1, min(4, int(policy.get("maxDepth") or self.MAX_SUB_AGENT_DEPTH)))),
            "maxPerNode": int(max(1, min(8, int(policy.get("maxPerNode") or 3)))),
            "maxTotal": int(max(1, min(64, int(policy.get("maxTotal") or 24)))),
            "timeoutMs": int(max(50, min(10000, int(policy.get("timeoutMs") or 1500)))),
        }

    def _default_spec_generation_rules(self) -> Dict[str, Any]:
        return {
            "version": "1.0",
            "stepHeuristics": {
                "stepsPerMinute": 150,
                "minTotalEnvSteps": 1000,
                "maxTotalEnvSteps": 50000,
                "gpuThresholdToEnable": 0.25,
                "defaultRolloutLen": 128,
                "defaultBatchSize": 2048,
                "defaultLr": 0.0003,
            },
            "profiles": {
                "offline_safe": {
                    "priority": 90,
                    "match": {
                        "executionModes": ["offline_stub"],
                        "allowNetwork": False,
                        "allowDependencyInstall": False,
                    },
                    "rootConfig": {
                        "algo": {"family": "mappo", "entrypoint": "algorithms.simple_train:train"},
                        "train": {"stepsPerMinute": 140, "rolloutLen": 128, "batchSize": 2048, "lr": 0.0003},
                        "resources": {"gpuThresholdToEnable": 0.5},
                    },
                    "evalProtocol": {
                        "gamesPerPair": 8,
                        "seeds": [1, 2, 3],
                        "confidenceLevel": 0.95,
                        "matrixPlan": {"mode": "NxN", "checkpointSelection": "best_k", "k": 4},
                    },
                    "riskHints": ["offline_first", "dependency_install_disabled"],
                },
                "online_guarded": {
                    "priority": 80,
                    "match": {"allowNetwork": True},
                    "rootConfig": {
                        "algo": {"family": "mappo", "entrypoint": "algorithms.simple_train:train"},
                        "train": {"stepsPerMinute": 160, "rolloutLen": 128, "batchSize": 2048, "lr": 0.00025},
                        "resources": {"gpuThresholdToEnable": 0.1},
                    },
                    "evalProtocol": {
                        "gamesPerPair": 10,
                        "seeds": [1, 2, 3, 4],
                        "confidenceLevel": 0.95,
                        "matrixPlan": {"mode": "NxN", "checkpointSelection": "best_k", "k": 5},
                    },
                    "riskHints": ["network_enabled_requires_gate"],
                },
                "high_budget_search": {
                    "priority": 70,
                    "match": {
                        "minGpuHours": 4,
                        "minWallclockMinutes": 180,
                        "minMetricCount": 2,
                    },
                    "rootConfig": {
                        "algo": {"family": "mappo", "entrypoint": "algorithms.simple_train:train"},
                        "train": {"stepsPerMinute": 200, "rolloutLen": 256, "batchSize": 4096, "lr": 0.0002},
                        "resources": {"gpuThresholdToEnable": 0.0, "minGpus": 1, "maxGpus": 1},
                    },
                    "evalProtocol": {
                        "gamesPerPair": 12,
                        "seeds": [1, 2, 3, 4],
                        "confidenceLevel": 0.97,
                        "matrixPlan": {"mode": "NxN", "checkpointSelection": "best_k", "k": 6},
                    },
                    "riskHints": ["high_budget_observability_required"],
                },
                "balanced_default": {
                    "priority": 10,
                    "match": {},
                    "rootConfig": {
                        "algo": {"family": "mappo", "entrypoint": "algorithms.simple_train:train"},
                        "train": {"stepsPerMinute": 150, "rolloutLen": 128, "batchSize": 2048, "lr": 0.0003},
                        "resources": {"gpuThresholdToEnable": 0.25},
                    },
                    "evalProtocol": {
                        "gamesPerPair": 8,
                        "seeds": [1, 2, 3],
                        "confidenceLevel": 0.95,
                        "matrixPlan": {"mode": "NxN", "checkpointSelection": "best_k", "k": 4},
                    },
                    "riskHints": ["balanced_default_profile"],
                },
            },
        }

    def _load_spec_generation_rules(self) -> Dict[str, Any]:
        path = self.spec_generation_rules_path
        fallback = self._default_spec_generation_rules()
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(yaml.safe_dump(fallback, sort_keys=False, allow_unicode=True), encoding="utf-8")
            return fallback
        try:
            payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            payload = None
        if not isinstance(payload, dict):
            return fallback

        merged = copy.deepcopy(fallback)
        merged["version"] = str(payload.get("version") or fallback.get("version") or "1.0")

        payload_step = payload.get("stepHeuristics")
        if isinstance(payload_step, dict):
            step = dict(merged.get("stepHeuristics") or {})
            for key, value in payload_step.items():
                if value is None:
                    continue
                step[str(key)] = value
            merged["stepHeuristics"] = step

        payload_profiles = payload.get("profiles")
        profiles = dict(merged.get("profiles") or {})
        if isinstance(payload_profiles, dict):
            for profile_id, row in payload_profiles.items():
                if not isinstance(row, dict):
                    continue
                pid = str(profile_id)
                base = copy.deepcopy(profiles.get(pid) if isinstance(profiles.get(pid), dict) else {})
                for key, value in row.items():
                    if value is None:
                        continue
                    if key in {"match", "rootConfig", "evalProtocol"} and isinstance(value, dict):
                        existing = base.get(key) if isinstance(base.get(key), dict) else {}
                        merged_obj = dict(existing)
                        merged_obj.update(value)
                        base[key] = merged_obj
                    elif key == "riskHints" and isinstance(value, list):
                        base[key] = [str(v).strip() for v in value if str(v).strip()]
                    else:
                        base[key] = value
                profiles[pid] = base
        merged["profiles"] = profiles
        return merged

    def _default_approval_policy_rules(self) -> Dict[str, Any]:
        return {
            "version": "1.0",
            "baselineHighRiskActions": list(self.HIGH_RISK_ACTIONS),
            "riskWeights": {
                "forbiddenAction": 2,
                "blockedRequestedAction": 4,
                "requestedHighRiskAction": 3,
                "requestedUnknownAction": 2,
                "complianceNoExternalPush": 3,
                "complianceNoPII": 1,
                "allowNetwork": 2,
                "allowDependencyInstall": 1,
            },
            "templates": {
                "strict": {
                    "label": "Strict",
                    "description": "Unknown actions and blocked actions require stricter approval gates.",
                    "mode": "strict",
                    "minRiskScore": 8,
                    "minApprovals": 1,
                    "requireDistinctRoles": True,
                    "approvalTtlMinutes": 120,
                    "blockedActionRoles": ["security"],
                    "highRiskActionRoles": ["admin", "security"],
                    "requireApprovalForUnknownActions": True,
                },
                "balanced": {
                    "label": "Balanced",
                    "description": "Default production profile balancing safety and execution throughput.",
                    "mode": "balanced",
                    "minRiskScore": 3,
                    "minApprovals": 1,
                    "requireDistinctRoles": False,
                    "approvalTtlMinutes": 120,
                    "blockedActionRoles": ["admin", "security"],
                    "highRiskActionRoles": ["admin", "ops", "security"],
                    "requireApprovalForUnknownActions": True,
                },
                "permissive": {
                    "label": "Permissive",
                    "description": "Allows faster local iteration while keeping explicit high-risk approvals.",
                    "mode": "permissive",
                    "minRiskScore": 0,
                    "minApprovals": 1,
                    "requireDistinctRoles": False,
                    "approvalTtlMinutes": 180,
                    "blockedActionRoles": ["admin"],
                    "highRiskActionRoles": ["admin", "ops", "security"],
                    "requireApprovalForUnknownActions": False,
                },
            },
        }

    def _default_execution_policy_rules(self) -> Dict[str, Any]:
        return {
            "version": "1.0",
            "localShell": {
                "enabled": True,
                "allowedCommands": ["python", "python3", "echo"],
                "blockedTokens": [
                    ";",
                    "&&",
                    "||",
                    "|",
                    ">",
                    "<",
                    "$(",
                    "`",
                    "..",
                ],
                "blockedCommandNames": [
                    "rm",
                    "curl",
                    "wget",
                    "nc",
                    "ncat",
                    "ssh",
                    "scp",
                    "bash",
                    "sh",
                    "zsh",
                    "fish",
                    "powershell",
                    "pwsh",
                ],
                "maxArgs": 20,
                "maxCommandLength": 280,
                "maxArgLength": 160,
                "defaultTimeoutSeconds": 30,
                "minTimeoutSeconds": 5,
                "maxTimeoutSeconds": 120,
                "maxOutputChars": 2400,
            },
            "mleRunner": {
                "enabled": True,
                "pythonBinary": "python",
                "modulePath": "toto.run",
                "mode": "search",
                "task": "tabular",
                "dataPath": "examples/tabular",
                "recipesPath": "examples/recipes/tabular.yaml",
                "maxBudget": 2,
                "launcher": "local",
                "dryRunOnly": True,
                "disableLlm": True,
                "defaultTimeoutSeconds": 90,
                "minTimeoutSeconds": 20,
                "maxTimeoutSeconds": 300,
                "maxOutputChars": 4000,
            },
        }

    def _default_runtime_rules(self) -> Dict[str, Any]:
        return {
            "version": "1.0",
            "lanes": {
                "research": [
                    {
                        "role": "HypothesisCriticSubAgent",
                        "objective": "Critique assumptions and identify weak hypotheses before expensive execution.",
                        "when": "always",
                    },
                    {
                        "role": "DataScoutSubAgent",
                        "objective": "Inspect multi-source data readiness and integration risks.",
                        "when": "multi_source",
                    },
                ],
                "integration_base": [
                    {
                        "role": "ContractProbeSubAgent",
                        "objective": "Validate adapter entrypoint and runner contract compatibility.",
                        "when": "always",
                    }
                ],
                "integration_fresh_only": [
                    {
                        "role": "DependencyProbeSubAgent",
                        "objective": "Detect runtime dependency gaps and fallback necessity.",
                        "when": "always",
                    }
                ],
                "ops_budget_guard": [
                    {
                        "role": "BudgetGuardSubAgent",
                        "objective": "Stress-check budget plan and fallback thresholds before execution.",
                        "when": "budget_risky",
                    }
                ],
                "eval": [
                    {
                        "role": "ConfidenceCheckSubAgent",
                        "objective": "Verify confidence settings and matrix sampling adequacy.",
                        "when": "always",
                    }
                ],
                "repair": [
                    {
                        "role": "RootCauseSubAgent",
                        "objective": "Summarize failure root cause and validate chosen repair action.",
                        "when": "always",
                    }
                ],
            },
            "fixStrategies": {
                "missing_dependency": {
                    "preferredWhenInstallAllowed": "external_dependency_install",
                    "preferredWhenInstallBlocked": "switch_offline_stub",
                    "alternatives": ["switch_offline_stub", "external_dependency_install"],
                    "rationaleInstallAllowed": "Install missing dependency under controlled runtime package policy.",
                    "rationaleInstallBlocked": "Dependency install is blocked or disabled; switch to offline adapter for deterministic fallback.",
                },
                "generic_failure": {
                    "action": "reduce_scope",
                    "alternatives": ["reduce_scope", "retry_with_debug"],
                    "rationale": "Unknown failure type; reduce run scope and retry with verbose diagnostics.",
                },
            },
            "codeMutationTemplates": {
                "research": [
                    {
                        "strategy": "architecture_residual_encoder",
                        "mutationKind": "architecture",
                        "title": "{nodeId} Architecture Branch",
                        "hypothesis": "Residual shared encoder improves representation quality for {metric}.",
                        "executionPlan": "Patch policy encoder and rerun ablation to compare uplift and stability.",
                        "targetFiles": [
                            "apps/portal-backend/runner/algorithms/simple_train.py",
                            "MLE/src/toto/engine/runner.py",
                        ],
                        "changeSummary": "Introduce residual encoder block and gated layer norm before policy/value heads.",
                        "validationCommand": "python -m pytest apps/portal-backend/tests -k agentic -q",
                        "risk": "medium",
                    },
                    {
                        "strategy": "loss_advantage_clip_balance",
                        "mutationKind": "loss",
                        "title": "{nodeId} Loss Branch",
                        "hypothesis": "Balanced policy/value loss with adaptive entropy schedule improves {metric}.",
                        "executionPlan": "Patch objective weighting and entropy schedule; run controlled comparison against parent.",
                        "targetFiles": [
                            "apps/portal-backend/runner/algorithms/simple_train.py",
                        ],
                        "changeSummary": "Add adaptive entropy decay and clipped value loss coefficient schedule.",
                        "validationCommand": "python -m pytest apps/portal-backend/tests -k agentic -q",
                        "risk": "medium",
                    },
                    {
                        "strategy": "credit_assignment_temporal",
                        "mutationKind": "objective",
                        "title": "{nodeId} Credit Assignment Branch",
                        "hypothesis": "Temporal credit assignment regularizer reduces variance and improves {metric}.",
                        "executionPlan": "Patch advantage estimator and add regularizer term to stabilize policy updates.",
                        "targetFiles": [
                            "apps/portal-backend/runner/algorithms/simple_train.py",
                        ],
                        "changeSummary": "Enable temporal-difference regularizer on advantage targets.",
                        "validationCommand": "python -m pytest apps/portal-backend/tests -k agentic -q",
                        "risk": "high",
                    },
                ],
                "integration": [
                    {
                        "strategy": "adapter_contract_guard",
                        "mutationKind": "integration",
                        "title": "{nodeId} Contract Guard Branch",
                        "hypothesis": "Tighter adapter contract guards reduce runtime breakages before training.",
                        "executionPlan": "Patch adapter validation layer and fail-fast checks for required runner outputs.",
                        "targetFiles": [
                            "apps/portal-backend/app/services/agentic_os.py",
                            "apps/portal-backend/runner/runner_main.py",
                        ],
                        "changeSummary": "Add strict schema validation for checkpoint/metrics artifact contract.",
                        "validationCommand": "python -m pytest apps/portal-backend/tests -k contract -q",
                        "risk": "medium",
                    },
                    {
                        "strategy": "adapter_dependency_fallback",
                        "mutationKind": "integration",
                        "title": "{nodeId} Dependency Fallback Branch",
                        "hypothesis": "Dependency-aware adapter fallback keeps pipeline alive under missing packages.",
                        "executionPlan": "Patch adapter resolver with graceful fallback to offline execution path.",
                        "targetFiles": [
                            "apps/portal-backend/app/services/agentic_os.py",
                        ],
                        "changeSummary": "Add deterministic fallback path and explicit reason codes in runtime report.",
                        "validationCommand": "python -m pytest apps/portal-backend/tests -k failure -q",
                        "risk": "low",
                    },
                    {
                        "strategy": "minimal_patch_adapter",
                        "mutationKind": "integration",
                        "title": "{nodeId} Minimal Adapter Patch Branch",
                        "hypothesis": "Minimal patch surface can preserve compatibility while reducing churn.",
                        "executionPlan": "Patch only adapter interface boundaries and replay smoke checks.",
                        "targetFiles": [
                            "apps/portal-backend/runner/runner_main.py",
                        ],
                        "changeSummary": "Constrain changes to adapter interface and config translation layer.",
                        "validationCommand": "python -m pytest apps/portal-backend/tests -k smoke -q",
                        "risk": "low",
                    },
                ],
                "evaluation": [
                    {
                        "strategy": "league_confidence_calibration",
                        "mutationKind": "evaluation",
                        "title": "{nodeId} Confidence Calibration Branch",
                        "hypothesis": "Bootstrap confidence calibration improves trust in {metric} ranking.",
                        "executionPlan": "Patch evaluation protocol to compute calibrated confidence intervals per matrix cell.",
                        "targetFiles": [
                            "apps/portal-backend/app/services/eval_matrix.py",
                        ],
                        "changeSummary": "Add bootstrap CI computation and low-confidence highlighting.",
                        "validationCommand": "python -m pytest apps/portal-backend/tests -k matrix -q",
                        "risk": "low",
                    },
                    {
                        "strategy": "adversarial_eval_slice",
                        "mutationKind": "evaluation",
                        "title": "{nodeId} Adversarial Slice Branch",
                        "hypothesis": "Adversarial slice reveals hidden weaknesses missed by average win-rate.",
                        "executionPlan": "Patch eval protocol with adversarial opponent subset and stratified reporting.",
                        "targetFiles": [
                            "apps/portal-backend/app/services/eval_matrix.py",
                        ],
                        "changeSummary": "Add stratified adversarial group metrics and verdict rationale fields.",
                        "validationCommand": "python -m pytest apps/portal-backend/tests -k matrix -q",
                        "risk": "medium",
                    },
                ],
                "execution": [
                    {
                        "strategy": "runtime_observability_patch",
                        "mutationKind": "ops",
                        "title": "{nodeId} Runtime Observability Branch",
                        "hypothesis": "Richer runtime observability improves root-cause speed under failures.",
                        "executionPlan": "Patch runtime execution report with phase timings and error taxonomy.",
                        "targetFiles": [
                            "apps/portal-backend/app/services/agentic_os.py",
                        ],
                        "changeSummary": "Emit per-phase timing and normalized failure classification.",
                        "validationCommand": "python -m pytest apps/portal-backend/tests -k audit -q",
                        "risk": "low",
                    }
                ],
            },
            "roleStrategies": {
                "HypothesisCriticSubAgent": {
                    "template": {
                        "weakAssumptions": ["reward shaping sensitivity"],
                        "recommendedControl": "preserve baseline branch",
                        "metricCoverage": "$metricKeys",
                        "estimatedLatencyMs": 210,
                    }
                },
                "DataScoutSubAgent": {
                    "template": {
                        "sourceCount": "$dataSourceCount",
                        "sources": "$dataSources",
                        "riskFlag": "$dataRiskFlag",
                        "estimatedLatencyMs": 240,
                    },
                    "spawnWhen": {"minDataSourceCount": 2, "maxDepthExclusive": "$maxDepth"},
                    "spawnPlans": [
                        {
                            "role": "SchemaProbeSubAgent",
                            "objective": "Probe schema compatibility across multiple data sources.",
                        }
                    ],
                },
                "SchemaProbeSubAgent": {
                    "template": {
                        "compatibility": "compatible",
                        "checkedFields": ["obs", "action", "reward", "done"],
                        "estimatedLatencyMs": 180,
                    }
                },
                "ContractProbeSubAgent": {
                    "template": {
                        "runnerContract": "train(config, metrics_path, checkpoint_dir, run_id)",
                        "contractCompatible": True,
                        "estimatedLatencyMs": 220,
                    }
                },
                "DependencyProbeSubAgent": {
                    "template": {
                        "dependencyInstallAllowed": "$allowDependencyInstall",
                        "recommendedFallback": "$dependencyFallback",
                        "estimatedLatencyMs": 260,
                    }
                },
                "BudgetGuardSubAgent": {
                    "template": {
                        "gpuHours": "$gpuHours",
                        "wallclockMinutes": "$wallclockMinutes",
                        "budgetRisk": "$budgetRisk",
                        "estimatedLatencyMs": 180,
                    }
                },
                "ConfidenceCheckSubAgent": {
                    "template": {
                        "confidenceLevel": "$confidenceLevel",
                        "gamesPerPair": "$gamesPerPair",
                        "matrixMode": "$matrixMode",
                        "estimatedLatencyMs": 170,
                    }
                },
                "RootCauseSubAgent": {
                    "template": {
                        "latestFailureReason": "$latestFailureReason",
                        "repairValidated": True,
                        "estimatedLatencyMs": 200,
                    }
                },
                "default": {
                    "template": {
                        "note": "$defaultNote",
                        "objective": "$objective",
                        "estimatedLatencyMs": 120,
                    }
                },
            },
        }

    def _load_approval_policy_rules(self) -> Dict[str, Any]:
        path = self.approval_policy_rules_path
        fallback = self._default_approval_policy_rules()
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(yaml.safe_dump(fallback, sort_keys=False, allow_unicode=True), encoding="utf-8")
            return fallback
        try:
            payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            payload = None
        if not isinstance(payload, dict):
            return fallback
        merged = dict(fallback)
        merged.update({k: v for k, v in payload.items() if v is not None})

        risk_weights = merged.get("riskWeights")
        if not isinstance(risk_weights, dict):
            merged["riskWeights"] = dict(fallback["riskWeights"])
        else:
            resolved_weights = dict(fallback["riskWeights"])
            for key, value in risk_weights.items():
                try:
                    resolved_weights[str(key)] = int(value)
                except Exception:
                    continue
            merged["riskWeights"] = resolved_weights

        baseline_actions = merged.get("baselineHighRiskActions")
        if not isinstance(baseline_actions, list):
            merged["baselineHighRiskActions"] = list(fallback["baselineHighRiskActions"])
        else:
            rows = [str(v).strip() for v in baseline_actions if str(v).strip()]
            merged["baselineHighRiskActions"] = rows or list(fallback["baselineHighRiskActions"])

        payload_templates = payload.get("templates")
        if not isinstance(payload_templates, dict):
            merged["templates"] = dict(fallback["templates"])
            return merged

        resolved_templates: Dict[str, Dict[str, Any]] = {}
        for template_id, default_row in fallback["templates"].items():
            custom_row = payload_templates.get(template_id)
            if isinstance(custom_row, dict):
                combined = dict(default_row)
                combined.update({k: v for k, v in custom_row.items() if v is not None})
                resolved_templates[template_id] = combined
            else:
                resolved_templates[template_id] = dict(default_row)

        for template_id, template_row in payload_templates.items():
            if template_id in resolved_templates or not isinstance(template_row, dict):
                continue
            resolved_templates[str(template_id)] = dict(template_row)

        merged["templates"] = resolved_templates
        return merged

    def _load_execution_policy_rules(self) -> Dict[str, Any]:
        path = self.execution_policy_rules_path
        fallback = self._default_execution_policy_rules()
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(yaml.safe_dump(fallback, sort_keys=False, allow_unicode=True), encoding="utf-8")
            return fallback
        try:
            payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            payload = None
        if not isinstance(payload, dict):
            return fallback

        local_shell = payload.get("localShell")
        merged_local_shell = dict(fallback["localShell"])
        if isinstance(local_shell, dict):
            merged_local_shell.update({k: v for k, v in local_shell.items() if v is not None})

        merged: Dict[str, Any] = {"version": str(payload.get("version") or fallback["version"]), "localShell": merged_local_shell}

        list_fields = ("allowedCommands", "blockedTokens", "blockedCommandNames")
        for field in list_fields:
            rows = merged_local_shell.get(field)
            if not isinstance(rows, list):
                merged_local_shell[field] = list(fallback["localShell"][field])
            else:
                merged_local_shell[field] = [str(v).strip() for v in rows if str(v).strip()]

        int_fields = (
            "maxArgs",
            "maxCommandLength",
            "maxArgLength",
            "defaultTimeoutSeconds",
            "minTimeoutSeconds",
            "maxTimeoutSeconds",
            "maxOutputChars",
        )
        for field in int_fields:
            try:
                merged_local_shell[field] = int(merged_local_shell.get(field))
            except Exception:
                merged_local_shell[field] = int(fallback["localShell"][field])

        merged_local_shell["enabled"] = bool(merged_local_shell.get("enabled"))
        merged_local_shell["minTimeoutSeconds"] = max(1, merged_local_shell["minTimeoutSeconds"])
        merged_local_shell["maxTimeoutSeconds"] = max(merged_local_shell["minTimeoutSeconds"], merged_local_shell["maxTimeoutSeconds"])
        merged_local_shell["defaultTimeoutSeconds"] = max(
            merged_local_shell["minTimeoutSeconds"],
            min(merged_local_shell["maxTimeoutSeconds"], merged_local_shell["defaultTimeoutSeconds"]),
        )
        merged_local_shell["maxOutputChars"] = max(256, merged_local_shell["maxOutputChars"])
        merged_local_shell["maxCommandLength"] = max(32, merged_local_shell["maxCommandLength"])
        merged_local_shell["maxArgLength"] = max(8, merged_local_shell["maxArgLength"])
        merged_local_shell["maxArgs"] = max(1, merged_local_shell["maxArgs"])

        mle_runner = payload.get("mleRunner")
        merged_mle_runner = dict(fallback["mleRunner"])
        if isinstance(mle_runner, dict):
            merged_mle_runner.update({k: v for k, v in mle_runner.items() if v is not None})

        int_fields_mle = ("maxBudget", "defaultTimeoutSeconds", "minTimeoutSeconds", "maxTimeoutSeconds", "maxOutputChars")
        for field in int_fields_mle:
            try:
                merged_mle_runner[field] = int(merged_mle_runner.get(field))
            except Exception:
                merged_mle_runner[field] = int(fallback["mleRunner"][field])

        str_fields_mle = ("pythonBinary", "modulePath", "mode", "task", "dataPath", "recipesPath", "launcher")
        for field in str_fields_mle:
            value = str(merged_mle_runner.get(field) or "").strip()
            merged_mle_runner[field] = value or str(fallback["mleRunner"][field])

        merged_mle_runner["enabled"] = bool(merged_mle_runner.get("enabled", True))
        merged_mle_runner["dryRunOnly"] = bool(merged_mle_runner.get("dryRunOnly", True))
        merged_mle_runner["disableLlm"] = bool(merged_mle_runner.get("disableLlm", True))
        merged_mle_runner["maxBudget"] = max(1, min(32, int(merged_mle_runner["maxBudget"])))
        merged_mle_runner["minTimeoutSeconds"] = max(5, int(merged_mle_runner["minTimeoutSeconds"]))
        merged_mle_runner["maxTimeoutSeconds"] = max(
            int(merged_mle_runner["minTimeoutSeconds"]),
            int(merged_mle_runner["maxTimeoutSeconds"]),
        )
        merged_mle_runner["defaultTimeoutSeconds"] = max(
            int(merged_mle_runner["minTimeoutSeconds"]),
            min(int(merged_mle_runner["maxTimeoutSeconds"]), int(merged_mle_runner["defaultTimeoutSeconds"])),
        )
        merged_mle_runner["maxOutputChars"] = max(512, int(merged_mle_runner["maxOutputChars"]))
        if merged_mle_runner["mode"] not in {"search"}:
            merged_mle_runner["mode"] = str(fallback["mleRunner"]["mode"])
        merged["mleRunner"] = merged_mle_runner
        return merged

    def _load_runtime_rules(self) -> Dict[str, Any]:
        path = self.runtime_rules_path
        fallback = self._default_runtime_rules()
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(yaml.safe_dump(fallback, sort_keys=False, allow_unicode=True), encoding="utf-8")
            return fallback
        try:
            payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            payload = None
        if not isinstance(payload, dict):
            return fallback
        merged: Dict[str, Any] = {"version": str(payload.get("version") or fallback["version"])}
        lanes = payload.get("lanes")
        merged_lanes = dict(fallback["lanes"])
        if isinstance(lanes, dict):
            for key, value in lanes.items():
                if isinstance(value, list):
                    merged_lanes[str(key)] = [item for item in value if isinstance(item, dict)]
        merged["lanes"] = merged_lanes

        fix = payload.get("fixStrategies")
        merged_fix = dict(fallback["fixStrategies"])
        if isinstance(fix, dict):
            for key, value in fix.items():
                if not isinstance(value, dict):
                    continue
                base = dict(merged_fix.get(str(key), {}))
                base.update({k: v for k, v in value.items() if v is not None})
                merged_fix[str(key)] = base
        merged["fixStrategies"] = merged_fix

        mutation_templates = payload.get("codeMutationTemplates")
        merged_templates = copy.deepcopy(fallback.get("codeMutationTemplates") or {})
        if isinstance(mutation_templates, dict):
            for lane, rows in mutation_templates.items():
                if not isinstance(rows, list):
                    continue
                merged_templates[str(lane)] = [copy.deepcopy(item) for item in rows if isinstance(item, dict)]
        merged["codeMutationTemplates"] = merged_templates

        strategies = payload.get("roleStrategies")
        merged_strategies = dict(fallback.get("roleStrategies") or {})
        if isinstance(strategies, dict):
            for role, row in strategies.items():
                if not isinstance(row, dict):
                    continue
                base = dict(merged_strategies.get(str(role), {}))
                base.update({k: v for k, v in row.items() if v is not None})
                merged_strategies[str(role)] = base
        merged["roleStrategies"] = merged_strategies
        return merged

    def _default_approver_registry(self) -> Dict[str, Any]:
        return {
            "version": "1.0",
            "strictMode": True,
            "approvers": [
                {"actorId": "ui:local_admin", "roles": ["admin"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True, "note": "local UI default admin"},
                {"actorId": "ui:local_ops", "roles": ["ops"], "scopes": ["*"], "actionAllowlist": ["switch_offline_stub", "reduce_scope", "retry_with_debug"], "active": True, "note": "local UI ops"},
                {"actorId": "ui:local_security", "roles": ["security"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True, "note": "local UI security"},
                {"actorId": "cli:local_admin", "roles": ["admin"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True, "note": "local CLI admin"},
                {"actorId": "ui:admin_reviewer", "roles": ["admin"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True},
                {"actorId": "ui:ops_reviewer", "roles": ["ops"], "scopes": ["*"], "actionAllowlist": ["switch_offline_stub", "reduce_scope", "retry_with_debug"], "active": True},
                {"actorId": "ui:security_reviewer", "roles": ["security"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True},
                {"actorId": "test_admin", "roles": ["admin"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True},
                {"actorId": "admin_user", "roles": ["admin"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True},
                {"actorId": "admin_1", "roles": ["admin"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True},
                {"actorId": "admin_2", "roles": ["admin"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True},
                {"actorId": "security_user", "roles": ["security"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True},
                {"actorId": "security_1", "roles": ["security"], "scopes": ["*"], "actionAllowlist": ["*"], "active": True},
                {"actorId": "ops_user", "roles": ["ops"], "scopes": ["*"], "actionAllowlist": ["switch_offline_stub", "reduce_scope", "retry_with_debug"], "active": True},
                {"actorId": "test_ops", "roles": ["ops"], "scopes": ["*"], "actionAllowlist": ["switch_offline_stub", "reduce_scope", "retry_with_debug"], "active": True},
            ],
        }

    def _load_approver_registry(self) -> Dict[str, Any]:
        path = self.approver_registry_path
        fallback = self._default_approver_registry()
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(yaml.safe_dump(fallback, sort_keys=False, allow_unicode=True), encoding="utf-8")
            return {
                "strictMode": bool(fallback.get("strictMode", True)),
                "items": [self._normalize_approver_row(item) for item in (fallback.get("approvers") or [])],
            }

        try:
            payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            payload = None

        if not isinstance(payload, dict):
            payload = fallback

        strict_mode = bool(payload.get("strictMode", fallback.get("strictMode", True)))
        source_rows = payload.get("approvers")
        if not isinstance(source_rows, list):
            source_rows = fallback.get("approvers") or []

        merged_rows: Dict[str, Dict[str, Any]] = {}
        for row in (fallback.get("approvers") or []):
            normalized = self._normalize_approver_row(row)
            actor_id = str(normalized.get("actorId") or "").strip()
            if not actor_id:
                continue
            merged_rows[actor_id] = normalized

        for row in source_rows:
            normalized = self._normalize_approver_row(row)
            actor_id = str(normalized.get("actorId") or "").strip()
            if not actor_id:
                continue
            merged_rows[actor_id] = normalized

        return {
            "strictMode": strict_mode,
            "items": list(merged_rows.values()),
        }

    def _normalize_approver_row(self, row: Any) -> Dict[str, Any]:
        if not isinstance(row, dict):
            return {
                "actorId": "",
                "roles": [],
                "scopes": ["*"],
                "actionAllowlist": ["*"],
                "actionDenylist": [],
                "active": False,
                "note": "",
            }
        actor_id = str(row.get("actorId") or row.get("actor_id") or "").strip()
        roles_raw = row.get("roles")
        if not isinstance(roles_raw, list):
            roles_raw = []
        roles = [str(role).strip().lower() for role in roles_raw if str(role).strip()]
        roles = [role for role in roles if role in set(self.APPROVER_ROLES)]
        scopes_raw = row.get("scopes")
        if not isinstance(scopes_raw, list):
            scopes_raw = ["*"]
        scopes = [str(scope).strip() for scope in scopes_raw if str(scope).strip()]
        if not scopes:
            scopes = ["*"]
        allow_raw = row.get("actionAllowlist")
        if not isinstance(allow_raw, list):
            allow_raw = row.get("action_allowlist")
        if not isinstance(allow_raw, list):
            allow_raw = ["*"]
        action_allowlist = [str(item).strip() for item in allow_raw if str(item).strip()]
        if not action_allowlist:
            action_allowlist = ["*"]
        deny_raw = row.get("actionDenylist")
        if not isinstance(deny_raw, list):
            deny_raw = row.get("action_denylist")
        if not isinstance(deny_raw, list):
            deny_raw = []
        action_denylist = [str(item).strip() for item in deny_raw if str(item).strip()]
        active = bool(row.get("active", True))
        note = str(row.get("note") or "").strip()
        return {
            "actorId": actor_id,
            "roles": sorted(set(roles)),
            "scopes": scopes,
            "actionAllowlist": sorted(set(action_allowlist)),
            "actionDenylist": sorted(set(action_denylist)),
            "active": active,
            "note": note,
        }

    def _match_policy_pattern(self, value: str, pattern: str) -> bool:
        token = str(pattern or "").strip()
        target = str(value or "").strip()
        if not token:
            return False
        if token == "*":
            return True
        return fnmatch.fnmatchcase(target, token)

    def _matches_any_policy_pattern(self, value: str, patterns: Sequence[str]) -> bool:
        return any(self._match_policy_pattern(value, pattern) for pattern in patterns if str(pattern).strip())

    def _validate_approval_actor(
        self,
        actor_id: str,
        actor_role: str,
        run_id: Optional[str] = None,
        actions: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        registry = self._load_approver_registry()
        strict_mode = bool(registry.get("strictMode"))
        items = list(registry.get("items") or [])
        matched = next((row for row in items if str(row.get("actorId") or "") == actor_id), None)
        if matched is None:
            if strict_mode:
                return {"ok": False, "reason": "approval_actor_not_registered"}
            return {"ok": True, "reason": None}

        if not bool(matched.get("active", True)):
            return {"ok": False, "reason": "approval_actor_inactive"}

        allowed_roles = set(str(role).strip().lower() for role in (matched.get("roles") or []) if str(role).strip())
        if actor_role not in allowed_roles:
            return {"ok": False, "reason": "approval_actor_role_mismatch"}

        scopes = [str(scope).strip() for scope in (matched.get("scopes") or []) if str(scope).strip()]
        if run_id and scopes and not self._matches_any_policy_pattern(str(run_id), scopes):
            return {"ok": False, "reason": "approval_actor_scope_denied"}

        normalized_actions = sorted(set(str(action).strip() for action in (actions or []) if str(action).strip()))
        if normalized_actions:
            allowlist = [str(item).strip() for item in (matched.get("actionAllowlist") or []) if str(item).strip()]
            denylist = [str(item).strip() for item in (matched.get("actionDenylist") or []) if str(item).strip()]
            for action in normalized_actions:
                if denylist and self._matches_any_policy_pattern(action, denylist):
                    return {"ok": False, "reason": "approval_actor_action_scope_denied"}
                if allowlist and not self._matches_any_policy_pattern(action, allowlist):
                    return {"ok": False, "reason": "approval_actor_action_scope_denied"}

        return {"ok": True, "reason": None}

    def _approval_context_from_idea(
        self,
        idea: Optional[AgenticIdeaInput],
        baseline_high_risk: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        if idea is None:
            constraints: Dict[str, Any] = {}
            requested_actions: List[str] = []
        else:
            constraints = {
                "compliance": list(idea.constraints.compliance),
                "forbiddenActions": list(idea.constraints.forbidden_actions),
                "allowNetwork": bool(idea.constraints.allow_network),
                "allowDependencyInstall": bool(idea.constraints.allow_dependency_install),
            }
            requested_actions = [str(v).strip() for v in list(idea.requested_actions) if str(v).strip()]

        forbidden = set(str(v).strip() for v in (constraints.get("forbiddenActions") or []) if str(v).strip())
        requested = [str(v).strip() for v in requested_actions if str(v).strip()]
        baseline_set = set(str(v).strip() for v in (baseline_high_risk or list(self.HIGH_RISK_ACTIONS)) if str(v).strip())
        requested_high_risk = sorted([action for action in requested if action in baseline_set])
        blocked_requested = sorted([action for action in requested if action in forbidden])
        known_actions = set(self.KNOWN_ACTIONS) | baseline_set
        unknown_actions = sorted([action for action in requested if action not in known_actions])
        compliance = set(str(v).strip() for v in (constraints.get("compliance") or []) if str(v).strip())

        return {
            "requestedActions": requested,
            "requestedHighRiskActions": requested_high_risk,
            "blockedRequestedActions": blocked_requested,
            "unknownActions": unknown_actions,
            "forbiddenActions": sorted(forbidden),
            "compliance": sorted(compliance),
            "allowNetwork": bool(constraints.get("allowNetwork")),
            "allowDependencyInstall": bool(constraints.get("allowDependencyInstall")),
        }

    def _approval_risk_score(self, context: Dict[str, Any], weights: Dict[str, Any]) -> int:
        def w(name: str, default: int = 0) -> int:
            try:
                return int(weights.get(name, default))
            except Exception:
                return default

        score = 0
        score += len(context.get("forbiddenActions") or []) * w("forbiddenAction", 2)
        score += len(context.get("blockedRequestedActions") or []) * w("blockedRequestedAction", 4)
        score += len(context.get("requestedHighRiskActions") or []) * w("requestedHighRiskAction", 3)
        score += len(context.get("unknownActions") or []) * w("requestedUnknownAction", 2)
        compliance = set(context.get("compliance") or [])
        if "no_external_data_push" in compliance:
            score += w("complianceNoExternalPush", 3)
        if "no_pii" in compliance:
            score += w("complianceNoPII", 1)
        if bool(context.get("allowNetwork")):
            score += w("allowNetwork", 2)
        if bool(context.get("allowDependencyInstall")):
            score += w("allowDependencyInstall", 1)
        return max(0, score)

    def _build_template_rationale(self, template_id: str, context: Dict[str, Any], score: int, min_score: int) -> str:
        unknown = len(context.get("unknownActions") or [])
        blocked = len(context.get("blockedRequestedActions") or [])
        if template_id == "strict":
            return f"riskScore={score} (threshold={min_score}); blocked={blocked}, unknown={unknown}. Strict gate reduces unsafe overrides."
        if template_id == "permissive":
            return f"riskScore={score} (threshold={min_score}); blocked={blocked}, unknown={unknown}. Permissive profile favors speed with explicit high-risk controls."
        return f"riskScore={score} (threshold={min_score}); blocked={blocked}, unknown={unknown}. Balanced profile fits mixed workloads."

    def _normalize_execution_mode(self, raw_mode: Any) -> str:
        mode = str(raw_mode or "offline_stub").strip().lower()
        if mode == "local_shell":
            return "local_shell"
        if mode == "mle_runner":
            return "mle_runner"
        return "offline_stub"

    def _execution_adapter_mode(self, state: Dict[str, Any]) -> str:
        algo = (state.get("root_config_draft") or {}).get("algo") or {}
        return self._normalize_execution_mode(algo.get("adapterMode"))

    def _local_shell_policy(self) -> Dict[str, Any]:
        return (self._load_execution_policy_rules().get("localShell") or {})

    def _mle_runner_policy(self) -> Dict[str, Any]:
        return (self._load_execution_policy_rules().get("mleRunner") or {})

    def _policy_timeout_seconds(self, state: Dict[str, Any], policy: Dict[str, Any], fallback_default: int = 60) -> int:
        resources = (state.get("root_config_draft") or {}).get("resources") or {}
        wallclock = int(resources.get("maxWallclockMinutes") or 60)
        derived = int(max(5, min(600, wallclock * 2)))
        default_timeout = int(policy.get("defaultTimeoutSeconds") or fallback_default or derived)
        min_timeout = int(policy.get("minTimeoutSeconds") or 5)
        max_timeout = int(policy.get("maxTimeoutSeconds") or max(120, derived))
        effective = default_timeout if default_timeout > 0 else derived
        return int(max(min_timeout, min(max_timeout, effective)))

    def _execution_timeout_seconds(self, state: Dict[str, Any]) -> int:
        return self._policy_timeout_seconds(state=state, policy=self._local_shell_policy(), fallback_default=30)

    def _mle_runner_timeout_seconds(self, state: Dict[str, Any]) -> int:
        return self._policy_timeout_seconds(state=state, policy=self._mle_runner_policy(), fallback_default=90)

    def _resolve_local_shell_command(self, state: Dict[str, Any]) -> List[str]:
        algo = (state.get("root_config_draft") or {}).get("algo") or {}
        raw = algo.get("localCommand")
        policy = self._local_shell_policy()
        if not bool(policy.get("enabled", True)):
            raise PermissionError("local_shell_disabled_by_policy")
        if isinstance(raw, list):
            command = [str(item).strip() for item in raw if str(item).strip()]
            raw_text = " ".join(command)
        else:
            text = str(raw or "").strip()
            raw_text = text
            command = shlex.split(text) if text else []
        if not command:
            command = ["python", "-c", "print('agentic_local_shell_ok')"]
            raw_text = "python -c \"print('agentic_local_shell_ok')\""
        self._validate_local_shell_command(command, raw_text, policy)
        return command

    def _validate_local_shell_command(self, command: List[str], raw_text: str, policy: Dict[str, Any]) -> None:
        max_cmd_len = int(policy.get("maxCommandLength") or 280)
        max_arg_len = int(policy.get("maxArgLength") or 160)
        max_args = int(policy.get("maxArgs") or 20)
        blocked_tokens = [str(v) for v in (policy.get("blockedTokens") or []) if str(v)]
        blocked_names = set(str(v).strip().lower() for v in (policy.get("blockedCommandNames") or []) if str(v).strip())
        allowed_names = set(str(v).strip().lower() for v in (policy.get("allowedCommands") or []) if str(v).strip())

        if len(raw_text) > max_cmd_len:
            raise PermissionError("local_shell_command_too_long")
        if len(command) > max_args:
            raise PermissionError("local_shell_too_many_args")
        if not command:
            raise PermissionError("local_shell_empty_command")

        executable = Path(command[0]).name.lower()
        if blocked_names and executable in blocked_names:
            raise PermissionError("local_shell_command_blocked")
        if allowed_names and executable not in allowed_names:
            raise PermissionError("local_shell_command_not_allowed")

        lowered_raw = raw_text.lower()
        for token in blocked_tokens:
            if token and token.lower() in lowered_raw:
                raise PermissionError("local_shell_blocked_token")

        for arg in command:
            if len(arg) > max_arg_len:
                raise PermissionError("local_shell_arg_too_long")
            lowered_arg = str(arg).lower()
            for token in blocked_tokens:
                if token and token.lower() in lowered_arg:
                    raise PermissionError("local_shell_blocked_token")

    def _resolve_mle_runner_path(self, mle_root: Path, raw_path: str) -> Path:
        text = str(raw_path or "").strip()
        if not text:
            raise ValueError("mle_runner_path_empty")
        candidate = Path(text)
        resolved = candidate.resolve() if candidate.is_absolute() else (mle_root / candidate).resolve()
        try:
            resolved.relative_to(mle_root)
        except Exception:
            raise PermissionError("mle_runner_path_outside_workspace")
        return resolved

    def _resolve_mle_runner_invocation(self, state: Dict[str, Any], run_dir: Path) -> Dict[str, Any]:
        policy = self._mle_runner_policy()
        if not bool(policy.get("enabled", True)):
            raise PermissionError("mle_runner_disabled_by_policy")

        mle_root = (self.workspace_root / "MLE").resolve()
        if not mle_root.exists():
            raise FileNotFoundError("mle_workspace_not_found")

        mode = str(policy.get("mode") or "search").strip().lower()
        if mode != "search":
            raise ValueError("mle_runner_mode_not_supported")

        task = str(policy.get("task") or "tabular").strip() or "tabular"
        data_path = self._resolve_mle_runner_path(mle_root, str(policy.get("dataPath") or "examples/tabular"))
        recipes_path = self._resolve_mle_runner_path(mle_root, str(policy.get("recipesPath") or "examples/recipes/tabular.yaml"))
        if not data_path.exists():
            raise FileNotFoundError("mle_runner_data_path_not_found")
        if not recipes_path.exists():
            raise FileNotFoundError("mle_runner_recipes_path_not_found")

        python_bin = str(policy.get("pythonBinary") or "python").strip() or "python"
        module_path = str(policy.get("modulePath") or "toto.run").strip() or "toto.run"
        launcher = str(policy.get("launcher") or "local").strip() or "local"
        max_budget = max(1, int(policy.get("maxBudget") or 2))
        dry_run_only = bool(policy.get("dryRunOnly", True))

        mle_artifacts_root = run_dir / "artifacts" / "mle_kernel"
        mle_artifacts_root.mkdir(parents=True, exist_ok=True)
        mle_registry = mle_artifacts_root / "runs.jsonl"

        cmd = [python_bin, "-m", module_path]
        if dry_run_only:
            cmd.append("--dry-run")
        cmd.extend(
            [
                "search",
            "--task",
            task,
            "--data",
            str(data_path.relative_to(mle_root)),
            "--recipes",
            str(recipes_path.relative_to(mle_root)),
            "--max-budget",
            str(max_budget),
            "--artifacts",
            str(mle_artifacts_root),
            "--registry",
            str(mle_registry),
            "--launcher",
            launcher,
            ]
        )

        env = dict(os.environ)
        py_path = str(env.get("PYTHONPATH") or "").strip()
        py_parts = [part for part in py_path.split(os.pathsep) if part]
        if "src" not in py_parts:
            py_parts.insert(0, "src")
        env["PYTHONPATH"] = os.pathsep.join(py_parts)
        env.setdefault("PYTHONUNBUFFERED", "1")
        env["MPLCONFIGDIR"] = str((mle_artifacts_root / ".mplconfig").resolve())
        if bool(policy.get("disableLlm", True)):
            env["LLM_OFFLINE_STUB"] = "1"
            env["TOTO_LLM_REQUIRE_REAL"] = "0"

        return {
            "command": cmd,
            "cwd": str(mle_root),
            "env": env,
            "timeoutSeconds": self._mle_runner_timeout_seconds(state),
            "maxOutputChars": int(policy.get("maxOutputChars") or 4000),
            "mleArtifactsRoot": str(mle_artifacts_root),
            "mleRegistryPath": str(mle_registry),
            "dryRun": dry_run_only,
            "policy": {
                "task": task,
                "mode": mode,
                "launcher": launcher,
                "maxBudget": max_budget,
                "dryRunOnly": dry_run_only,
                "disableLlm": bool(policy.get("disableLlm", True)),
                "dataPath": str(data_path.relative_to(mle_root)),
                "recipesPath": str(recipes_path.relative_to(mle_root)),
            },
        }

    def _run_mle_runner_adapter(self, state: Dict[str, Any], run_dir: Path) -> Dict[str, Any]:
        invocation = self._resolve_mle_runner_invocation(state=state, run_dir=run_dir)
        started_at = _now_iso()
        proc = subprocess.run(
            invocation["command"],
            cwd=str(invocation["cwd"]),
            env=invocation["env"],
            capture_output=True,
            text=True,
            timeout=int(invocation["timeoutSeconds"]),
            check=False,
        )

        max_output_chars = int(invocation.get("maxOutputChars") or 4000)
        stdout_tail = _short(proc.stdout, limit=max_output_chars)
        stderr_tail = _short(proc.stderr, limit=max_output_chars)
        command_hash = _stable_hash({"command": invocation["command"]})
        mle_artifacts_root = Path(str(invocation["mleArtifactsRoot"]))
        summary_path = mle_artifacts_root / "search_summary.json"
        summary: Dict[str, Any] = {}
        if summary_path.exists():
            try:
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
            except Exception:
                summary = {}

        summary_payload = {
            "mleArtifactsRoot": str(mle_artifacts_root),
            "mleRegistryPath": str(invocation["mleRegistryPath"]),
            "summaryPath": str(summary_path) if summary_path.exists() else None,
            "summary": {
                "bestRunId": summary.get("best_run_id"),
                "bestScore": summary.get("best_score"),
                "runCount": len(summary.get("runs") or []) if isinstance(summary.get("runs"), list) else None,
            },
        }
        _atomic_write_text(
            run_dir / "artifacts" / "mle_runner_summary.json",
            json.dumps(summary_payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        runtime_report = {
            "mode": "mle_runner",
            "status": "SUCCEEDED" if proc.returncode == 0 else "FAILED",
            "command": invocation["command"],
            "commandHash": command_hash,
            "returnCode": int(proc.returncode),
            "stdoutTail": stdout_tail,
            "stderrTail": stderr_tail,
            "timeoutSeconds": int(invocation["timeoutSeconds"]),
            "startedAt": started_at,
            "finishedAt": _now_iso(),
            "mle": summary_payload,
            "policy": invocation["policy"],
        }
        if proc.returncode != 0:
            raise RuntimeError(f"mle_runner_command_failed rc={proc.returncode}")
        return runtime_report

    def _emit_runtime_checkpoint(
        self,
        run_dir: Path,
        state: Dict[str, Any],
        source: str,
        not_executed: bool = False,
    ) -> Dict[str, Any]:
        ckpt_dir = run_dir / "artifacts" / "ckpt"
        ckpt_dir.mkdir(parents=True, exist_ok=True)
        existing = sorted(ckpt_dir.glob("ckpt_runtime_*.json"))
        next_idx = len(existing) + 1
        checkpoint_id = f"ckpt_runtime_{next_idx}"
        payload = {
            "checkpointId": checkpoint_id,
            "source": source,
            "createdAt": _now_iso(),
            "runId": str(state.get("run_id") or ""),
            "status": str(state.get("status") or "RUNNING"),
            "notExecuted": bool(not_executed),
        }
        (ckpt_dir / f"{checkpoint_id}.json").write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return payload

    def _default_approval_policy(self, mode: str) -> Dict[str, Any]:
        normalized_mode = mode if mode in self.APPROVAL_MODES else "balanced"
        if normalized_mode == "strict":
            return {
                "mode": "strict",
                "blockedActionRoles": ["security"],
                "highRiskActionRoles": ["admin", "security"],
                "highRiskActions": list(self.HIGH_RISK_ACTIONS),
                "requireApprovalForUnknownActions": True,
                "minApprovals": 1,
                "requireDistinctRoles": True,
                "approvalTtlMinutes": 120,
            }
        if normalized_mode == "permissive":
            return {
                "mode": "permissive",
                "blockedActionRoles": ["admin"],
                "highRiskActionRoles": ["admin", "ops", "security"],
                "highRiskActions": list(self.HIGH_RISK_ACTIONS),
                "requireApprovalForUnknownActions": False,
                "minApprovals": 1,
                "requireDistinctRoles": False,
                "approvalTtlMinutes": 180,
            }
        return {
            "mode": "balanced",
            "blockedActionRoles": ["admin", "security"],
            "highRiskActionRoles": ["admin", "ops", "security"],
            "highRiskActions": list(self.HIGH_RISK_ACTIONS),
            "requireApprovalForUnknownActions": True,
            "minApprovals": 1,
            "requireDistinctRoles": False,
            "approvalTtlMinutes": 120,
        }

    def _normalize_roles(self, values: Any, fallback: List[str]) -> List[str]:
        allowed = set(self.APPROVER_ROLES)
        rows: List[str] = []
        if isinstance(values, list):
            rows = [str(item).lower().strip() for item in values if str(item).strip()]
        filtered = [role for role in rows if role in allowed]
        if filtered:
            return list(dict.fromkeys(filtered))
        return list(fallback)

    def _normalize_approval_policy(self, raw_policy: Dict[str, Any]) -> Dict[str, Any]:
        mode = str(raw_policy.get("mode") or "balanced").lower().strip()
        if mode not in self.APPROVAL_MODES:
            mode = "balanced"
        defaults = self._default_approval_policy(mode)
        high_risk_actions = [str(v).strip() for v in (raw_policy.get("highRiskActions") or []) if str(v).strip()]
        high_risk_actions = list(dict.fromkeys(list(defaults["highRiskActions"]) + high_risk_actions))
        require_unknown = raw_policy.get("requireApprovalForUnknownActions")
        if require_unknown is None:
            require_unknown = defaults["requireApprovalForUnknownActions"]
        min_approvals = raw_policy.get("minApprovals")
        if min_approvals is None:
            min_approvals = defaults.get("minApprovals", 1)
        try:
            min_approvals_int = int(min_approvals)
        except Exception:
            min_approvals_int = int(defaults.get("minApprovals", 1))
        min_approvals_int = max(1, min(3, min_approvals_int))
        require_distinct_roles = raw_policy.get("requireDistinctRoles")
        if require_distinct_roles is None:
            require_distinct_roles = defaults.get("requireDistinctRoles", False)
        approval_ttl = raw_policy.get("approvalTtlMinutes")
        if approval_ttl is None:
            approval_ttl = defaults.get("approvalTtlMinutes", 120)
        try:
            approval_ttl_minutes = int(approval_ttl)
        except Exception:
            approval_ttl_minutes = int(defaults.get("approvalTtlMinutes", 120))
        approval_ttl_minutes = max(5, min(10080, approval_ttl_minutes))
        return {
            "mode": mode,
            "blockedActionRoles": self._normalize_roles(raw_policy.get("blockedActionRoles"), list(defaults["blockedActionRoles"])),
            "highRiskActionRoles": self._normalize_roles(raw_policy.get("highRiskActionRoles"), list(defaults["highRiskActionRoles"])),
            "highRiskActions": high_risk_actions,
            "requireApprovalForUnknownActions": bool(require_unknown),
            "minApprovals": min_approvals_int,
            "requireDistinctRoles": bool(require_distinct_roles),
            "approvalTtlMinutes": approval_ttl_minutes,
        }

    def _approval_policy_snapshot(
        self,
        policy: Optional[Dict[str, Any]] = None,
        rules: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        normalized_policy = self._normalize_approval_policy(policy or {})
        resolved_rules = rules if isinstance(rules, dict) else self._load_approval_policy_rules()
        templates = resolved_rules.get("templates") or {}
        mode = str(normalized_policy.get("mode") or "").lower().strip()
        matched_templates: List[str] = []
        if isinstance(templates, dict):
            for template_id, template_row in templates.items():
                if not isinstance(template_row, dict):
                    continue
                template_mode = str(template_row.get("mode") or template_id).lower().strip()
                if template_mode == mode:
                    matched_templates.append(str(template_id))
        matched_templates.sort()
        return {
            "rulesVersion": str(resolved_rules.get("version") or "1.0"),
            "rulesHash": _stable_hash(resolved_rules),
            "policyHash": _stable_hash(normalized_policy),
            "mode": mode,
            "matchedTemplates": matched_templates,
            "highRiskActionCount": len(normalized_policy.get("highRiskActions") or []),
            "minApprovals": int(normalized_policy.get("minApprovals") or 1),
            "requireDistinctRoles": bool(normalized_policy.get("requireDistinctRoles")),
        }

    def _approval_policy(self, state: Dict[str, Any]) -> Dict[str, Any]:
        raw = (state.get("research_spec") or {}).get("approvalPolicy") or {}
        if not isinstance(raw, dict):
            raw = {}
        return self._normalize_approval_policy(raw)

    def _llm_lane_plan_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "required": ["plans"],
            "properties": {
                "plans": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 6,
                    "items": {
                        "type": "object",
                        "required": ["role", "objective"],
                        "properties": {
                            "role": {"type": "string"},
                            "objective": {"type": "string"},
                        },
                    },
                }
            },
        }

    def _fallback_lane_plans(self, lane: str) -> List[Dict[str, str]]:
        mapping: Dict[str, List[Dict[str, str]]] = {
            "research": [
                {"role": "BaselineScoutSubAgent", "objective": "Review baseline traces and identify bottlenecks."},
                {"role": "MutationCriticSubAgent", "objective": "Stress-test planned code mutations against target metrics."},
            ],
            "integration_base": [
                {"role": "ContractProbeSubAgent", "objective": "Verify adapter and runner contract compatibility."},
            ],
            "integration_fresh_only": [
                {"role": "DependencyProbeSubAgent", "objective": "Check missing package and import risks before execution."},
            ],
            "ops_budget_guard": [
                {"role": "BudgetGuardSubAgent", "objective": "Clamp runtime budget and suggest rollback triggers."},
            ],
            "eval": [
                {"role": "EvalProtocolSubAgent", "objective": "Validate protocol fairness and confidence settings."},
            ],
            "repair": [
                {"role": "RootCauseSubAgent", "objective": "Summarize failure root cause and validate repair path."},
            ],
        }
        return mapping.get(lane) or [{"role": "GeneralSubAgent", "objective": "Analyze current node and propose next action."}]

    def _runtime_lane_plans(
        self,
        state: Dict[str, Any],
        lane: str,
        node: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, str]]:
        if isinstance(node, dict) and not self._is_node_llm_enabled(state, node):
            self._append_event(
                state,
                event="llm_skipped",
                message=f"LLM disabled for node {node.get('node_id')} lane planner",
                payload={
                    "node_id": node.get("node_id"),
                    "task": f"lane_plans_{lane}",
                    "lane": lane,
                    "reason": "node_llm_disabled",
                },
                actor=str(node.get("agent") or "Agent"),
            )
            return self._fallback_lane_plans(lane)

        spec = state.get("research_spec") or {}
        retrieval = self.retrieve_context(query=f"sub-agent planning lane={lane} {spec.get('taskGoal')}", k=3)
        try:
            payload = self._invoke_llm_json(
                state=state,
                node=node,
                task=f"lane_plans_{lane}",
                system_prompt=(
                    "You are the sub-agent planner for Agentic MARL Research OS. "
                    "Return strict JSON with specialized sub-agent roles and objectives only."
                ),
                user_prompt=json.dumps(
                    {
                        "task": "lane_sub_agent_plans",
                        "lane": lane,
                        "runId": str(state.get("run_id") or ""),
                        "executionMode": self._execution_adapter_mode(state),
                        "taskGoal": spec.get("taskGoal"),
                        "environment": (spec.get("environment") or {}).get("name"),
                        "successMetrics": list((spec.get("successMetrics") or {}).keys()),
                        "budget": spec.get("budget") or {},
                        "constraints": spec.get("constraints") or {},
                        "retrieval": retrieval,
                    },
                    ensure_ascii=False,
                ),
                schema=self._llm_lane_plan_schema(),
                temperature=0.25,
                role=f"lane_planner:{lane}",
            )
            rows = payload.get("plans") or []
            if not isinstance(rows, list):
                raise RuntimeError(f"llm_required_invalid_lane_plans lane={lane}")
            plans: List[Dict[str, str]] = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                role = str(row.get("role") or "").strip()
                objective = str(row.get("objective") or "").strip()
                if not role or not objective:
                    continue
                plans.append({"role": role, "objective": objective})
            if not plans:
                raise RuntimeError(f"llm_required_empty_lane_plans lane={lane}")
            return plans
        except Exception as exc:
            self._append_event(
                state,
                event="llm_fallback",
                message=f"LLM lane planner failed for lane={lane}; using fallback plans",
                payload={
                    "node_id": (node or {}).get("node_id") if isinstance(node, dict) else None,
                    "task": f"lane_plans_{lane}",
                    "lane": lane,
                    "reason": str(exc),
                },
                actor=str((node or {}).get("agent") or "lane_planner"),
            )
            return self._fallback_lane_plans(lane)

    def _lane_condition_matches(self, state: Dict[str, Any], condition: str) -> bool:
        tag = str(condition or "always").strip().lower()
        if tag in {"", "always"}:
            return True
        spec = state.get("research_spec") or {}
        data_sources = list(((spec.get("environment") or {}).get("dataSources") or []))
        budget = spec.get("budget") or {}
        gpu_hours = float(budget.get("gpuHours") or 0)
        wallclock = int(budget.get("wallclockMinutes") or 0)
        if tag == "multi_source":
            return len(data_sources) > 1
        if tag == "budget_risky":
            return gpu_hours >= 1.0 or wallclock >= 60
        if tag == "local_shell":
            return self._execution_adapter_mode(state) == "local_shell"
        if tag == "offline_stub":
            return self._execution_adapter_mode(state) == "offline_stub"
        return False

    def _sub_agent_strategy_context(
        self,
        state: Dict[str, Any],
        node: Dict[str, Any],
        sub_agent: Dict[str, Any],
        plan: Dict[str, str],
    ) -> Dict[str, Any]:
        spec = state.get("research_spec") or {}
        env = spec.get("environment") or {}
        constraints = spec.get("constraints") or {}
        budget = spec.get("budget") or {}
        protocol = state.get("eval_protocol_draft") or {}
        data_sources = list(env.get("dataSources") or [])
        metric_keys = list((spec.get("successMetrics") or {}).keys())
        depth = int(sub_agent.get("depth") or 1)
        max_depth = int(self._sub_agent_policy(state).get("maxDepth") or self.MAX_SUB_AGENT_DEPTH)
        gpu_hours = float(budget.get("gpuHours") or 0)
        wallclock_minutes = int(budget.get("wallclockMinutes") or 0)
        failure_history = list(state.get("failure_history") or [])
        latest_failure_reason = ""
        if failure_history:
            latest_failure_reason = str((failure_history[-1] or {}).get("reason") or "")

        return {
            "runId": str(state.get("run_id") or ""),
            "nodeId": str(node.get("node_id") or ""),
            "nodeTitle": str(node.get("title") or ""),
            "ownerAgent": str(node.get("agent") or ""),
            "role": str(plan.get("role") or "GenericSubAgent"),
            "objective": str(plan.get("objective") or ""),
            "executionMode": self._execution_adapter_mode(state),
            "allowDependencyInstall": bool(constraints.get("allowDependencyInstall")),
            "allowNetwork": bool(constraints.get("allowNetwork")),
            "dataSources": data_sources,
            "dataSourceCount": len(data_sources),
            "dataRiskFlag": "multi_source" if len(data_sources) > 1 else "single_source",
            "metricKeys": metric_keys,
            "metricCount": len(metric_keys),
            "gpuHours": gpu_hours,
            "wallclockMinutes": wallclock_minutes,
            "budgetRisk": "high" if gpu_hours > 4 or wallclock_minutes > 240 else "moderate",
            "depth": depth,
            "maxDepth": max_depth,
            "gamesPerPair": protocol.get("gamesPerPair"),
            "confidenceLevel": protocol.get("confidenceLevel"),
            "matrixMode": (protocol.get("matrixPlan") or {}).get("mode"),
            "latestFailureReason": latest_failure_reason,
            "dependencyFallback": "runtime_install" if bool(constraints.get("allowDependencyInstall")) else "offline_stub",
            "defaultNote": f"{str(plan.get('role') or 'GenericSubAgent')} executed with rule-driven fallback.",
        }

    def _render_sub_agent_template(self, value: Any, context: Dict[str, Any]) -> Any:
        if isinstance(value, dict):
            return {str(k): self._render_sub_agent_template(v, context) for k, v in value.items()}
        if isinstance(value, list):
            return [self._render_sub_agent_template(item, context) for item in value]
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("$") and len(text) > 1:
                return copy.deepcopy(context.get(text[1:], None))
            return value
        return value

    def _resolve_strategy_int(self, raw: Any, context: Dict[str, Any], fallback: int) -> int:
        if isinstance(raw, str) and raw.strip().startswith("$"):
            ref = context.get(raw.strip()[1:])
            try:
                return int(ref)
            except Exception:
                return int(fallback)
        try:
            return int(raw)
        except Exception:
            return int(fallback)

    def _sub_agent_strategy(self, role: str) -> Dict[str, Any]:
        rules = self._load_runtime_rules()
        strategies = (rules.get("roleStrategies") or {})
        if not isinstance(strategies, dict):
            return {}
        row = strategies.get(role)
        if isinstance(row, dict):
            return row
        default_row = strategies.get("default")
        if isinstance(default_row, dict):
            return default_row
        return {}

    def _sub_agent_strategy_allows_spawn(self, strategy: Dict[str, Any], context: Dict[str, Any]) -> bool:
        gate = strategy.get("spawnWhen") or {}
        if not isinstance(gate, dict):
            return True
        if "minDataSourceCount" in gate:
            threshold = self._resolve_strategy_int(gate.get("minDataSourceCount"), context, fallback=0)
            if int(context.get("dataSourceCount") or 0) < threshold:
                return False
        if "maxDepthExclusive" in gate:
            threshold = self._resolve_strategy_int(gate.get("maxDepthExclusive"), context, fallback=int(context.get("maxDepth") or 1))
            if int(context.get("depth") or 1) >= threshold:
                return False
        if "executionModes" in gate and isinstance(gate.get("executionModes"), list):
            allowed = {str(v).strip().lower() for v in gate.get("executionModes") if str(v).strip()}
            if allowed and str(context.get("executionMode") or "").strip().lower() not in allowed:
                return False
        return True

    def _llm_sub_agent_execution_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "required": ["analysis", "actions", "confidence", "estimatedLatencyMs", "spawnPlans"],
            "properties": {
                "analysis": {"type": "string"},
                "actions": {"type": "array", "minItems": 1, "maxItems": 6, "items": {"type": "string"}},
                "confidence": {"type": "number"},
                "estimatedLatencyMs": {"type": "integer"},
                "spawnPlans": {
                    "type": "array",
                    "maxItems": 4,
                    "items": {
                        "type": "object",
                        "required": ["role", "objective"],
                        "properties": {
                            "role": {"type": "string"},
                            "objective": {"type": "string"},
                        },
                    },
                },
            },
        }

    def _execute_sub_agent_logic(
        self,
        state: Dict[str, Any],
        node: Dict[str, Any],
        sub_agent: Dict[str, Any],
        plan: Dict[str, str],
    ) -> Dict[str, Any]:
        role = str(plan.get("role") or "GenericSubAgent")
        context = self._sub_agent_strategy_context(state, node, sub_agent, plan)

        if not self._is_node_llm_enabled(state, node):
            self._append_event(
                state,
                event="llm_skipped",
                message=f"LLM disabled for node {node.get('node_id')} sub-agent {role}",
                payload={
                    "node_id": node.get("node_id"),
                    "task": "sub_agent_execution",
                    "role": role,
                    "reason": "node_llm_disabled",
                },
                actor=str(node.get("agent") or "Agent"),
            )
            actions = [
                f"rule::{role}::collect_context",
                f"rule::{role}::propose_next_step",
            ]
            evidence: Dict[str, Any] = {
                "analysis": str(context.get("defaultNote") or f"Rule-based execution for role {role}."),
                "actions": actions,
                "confidence": 0.58,
                "estimatedLatencyMs": 120,
                "strategySource": "rule_fallback",
                "strategyRole": role,
            }
            if int(context.get("dataSourceCount") or 0) > 1 and int(context.get("depth") or 1) < int(context.get("maxDepth") or 1):
                evidence["__spawn_plans__"] = [
                    {"role": "SchemaProbeSubAgent", "objective": "Probe schema consistency across multiple data sources."}
                ]
            return evidence

        retrieval = self.retrieve_context(
            query=f"sub-agent execution role={role} objective={plan.get('objective')} node={node.get('node_id')}",
            k=3,
        )
        try:
            payload = self._invoke_llm_json(
                state=state,
                node=node,
                task="sub_agent_execution",
                system_prompt=(
                    "You are a specialized sub-agent executor in Agentic MARL Research OS. "
                    "Return strict JSON with analysis, actions, confidence, latency estimate, and optional child spawn plans."
                ),
                user_prompt=json.dumps(
                    {
                        "task": "sub_agent_execution",
                        "runId": str(state.get("run_id") or ""),
                        "nodeId": str(node.get("node_id") or ""),
                        "role": role,
                        "objective": str(plan.get("objective") or ""),
                        "context": context,
                        "retrieval": retrieval,
                    },
                    ensure_ascii=False,
                ),
                schema=self._llm_sub_agent_execution_schema(),
                temperature=0.25,
                role=role,
            )
            confidence = float(payload.get("confidence") or 0.0)
            confidence = max(0.0, min(1.0, confidence))
            estimated_latency_ms = int(payload.get("estimatedLatencyMs") or 120)
            estimated_latency_ms = max(1, min(10000, estimated_latency_ms))
            actions = [str(item).strip() for item in (payload.get("actions") or []) if str(item).strip()]
            if not actions:
                raise RuntimeError(f"llm_required_invalid_sub_agent_actions role={role}")

            spawn_rows = payload.get("spawnPlans") or []
            normalized_spawns: List[Dict[str, str]] = []
            for row in spawn_rows:
                if not isinstance(row, dict):
                    continue
                spawn_role = str(row.get("role") or "").strip()
                spawn_objective = str(row.get("objective") or "").strip()
                if not spawn_role or not spawn_objective:
                    continue
                normalized_spawns.append({"role": spawn_role, "objective": spawn_objective})

            evidence: Dict[str, Any] = {
                "analysis": str(payload.get("analysis") or "").strip(),
                "actions": actions,
                "confidence": round(confidence, 4),
                "estimatedLatencyMs": estimated_latency_ms,
                "strategySource": "llm",
                "strategyRole": role,
            }
            if normalized_spawns:
                evidence["__spawn_plans__"] = normalized_spawns
            return evidence
        except Exception as exc:
            self._append_event(
                state,
                event="llm_fallback",
                message=f"LLM sub-agent execution failed for role={role}; using fallback actions",
                payload={
                    "node_id": node.get("node_id"),
                    "task": "sub_agent_execution",
                    "role": role,
                    "reason": str(exc),
                },
                actor=str(node.get("agent") or "Agent"),
            )
            actions = [
                f"rule::{role}::collect_context",
                f"rule::{role}::propose_next_step",
            ]
            evidence: Dict[str, Any] = {
                "analysis": str(context.get("defaultNote") or f"Rule-based execution for role {role}."),
                "actions": actions,
                "confidence": 0.52,
                "estimatedLatencyMs": 120,
                "strategySource": "rule_fallback_llm_error",
                "strategyRole": role,
                "fallbackReason": str(exc),
            }
            if int(context.get("dataSourceCount") or 0) > 1 and int(context.get("depth") or 1) < int(context.get("maxDepth") or 1):
                evidence["__spawn_plans__"] = [
                    {"role": "SchemaProbeSubAgent", "objective": "Probe schema consistency across multiple data sources."}
                ]
            return evidence

    def _build_failure_report(
        self,
        state: Dict[str, Any],
        node: Dict[str, Any],
        exc: Exception,
        stack: str,
    ) -> Dict[str, Any]:
        message = str(exc)
        fix = self._suggest_fix(state, message)
        retrieval = self.retrieve_context(
            query=f"failure localization {node.get('agent')} {node.get('title')} {message}",
            k=4,
        )
        return {
            "nodeId": node.get("node_id"),
            "agent": node.get("agent"),
            "reason": message,
            "stackSummary": _short(stack, limit=360),
            "fixSuggestion": fix,
            "selectionRationale": fix.get("rationale"),
            "retrievalContext": retrieval,
            "occurredAt": _now_iso(),
        }

    def _suggest_fix(self, state: Dict[str, Any], message: str) -> Dict[str, Any]:
        msg_lower = message.lower()
        constraints = state.get("research_spec", {}).get("constraints", {})
        forbidden = set(constraints.get("forbiddenActions") or [])
        runtime_rules = self._load_runtime_rules()
        fix_rules = (runtime_rules.get("fixStrategies") or {})
        missing_dep_rule = fix_rules.get("missing_dependency") if isinstance(fix_rules, dict) else {}
        generic_rule = fix_rules.get("generic_failure") if isinstance(fix_rules, dict) else {}

        if "no module named" in msg_lower or "importerror" in msg_lower or "modulenotfounderror" in msg_lower:
            preferred = str((missing_dep_rule or {}).get("preferredWhenInstallAllowed") or "external_dependency_install")
            if preferred in forbidden or not constraints.get("allowDependencyInstall", False):
                preferred = str((missing_dep_rule or {}).get("preferredWhenInstallBlocked") or "switch_offline_stub")
                rationale = str((missing_dep_rule or {}).get("rationaleInstallBlocked") or "")
            else:
                rationale = str((missing_dep_rule or {}).get("rationaleInstallAllowed") or "")
            if not rationale:
                rationale = "Dependency issue detected; choose safest available recovery action."
            return {
                "action": preferred,
                "reason": "missing_dependency",
                "rationale": rationale,
                "alternatives": list((missing_dep_rule or {}).get("alternatives") or ["switch_offline_stub", "external_dependency_install"]),
            }

        return {
            "action": str((generic_rule or {}).get("action") or "reduce_scope"),
            "reason": "generic_failure",
            "rationale": str((generic_rule or {}).get("rationale") or "Unknown failure type; reduce run scope and retry with verbose diagnostics."),
            "alternatives": list((generic_rule or {}).get("alternatives") or ["reduce_scope", "retry_with_debug"]),
        }

    def _create_fix_branch(self, state: Dict[str, Any], failed_node: Dict[str, Any], failure: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        new_id = self._next_node_id(state)
        fix = failure.get("fixSuggestion") or {}
        node = {
            "node_id": new_id,
            "parent_id": failed_node.get("node_id"),
            "agent": "IntegrationAgent",
            "title": f"Repair Branch for {failed_node.get('node_id')}",
            "hypothesis": "Applying targeted repair can recover the failed branch.",
            "execution_plan": f"Apply fix action {fix.get('action')} and retry upstream node.",
            "expected_metrics": {"recoveryRate": ">=0.8"},
            "budget": {"gpuHours": 0.1, "wallclockMinutes": 10},
            "node_function": "coding",
            "llm_enabled": bool(self._llm_policy(state).get("coding", True)),
            "risk": "medium",
            "status": "PENDING",
            "rationale": str(fix.get("rationale") or "Auto-generated repair branch"),
            "evidence": {"fixPayload": fix, "fromFailure": failure},
            "sub_agents": [],
            "next_suggestions": ["Execute repair", "Retry failed node"],
            "children": [],
        }
        state.setdefault("tot_tree", []).append(node)
        failed_node.setdefault("children", []).append(new_id)
        return node

    def _can_apply_fix_without_approval(self, state: Dict[str, Any], failure: Dict[str, Any]) -> bool:
        fix = failure.get("fixSuggestion") or {}
        action = str(fix.get("action") or "")
        if not action:
            return False
        constraints = state.get("research_spec", {}).get("constraints", {})
        approval_policy = self._approval_policy(state)
        approved = set(state.get("approved_actions") or [])
        decision = self._evaluate_action_policy(action, constraints, approved, approval_policy=approval_policy)
        return not bool(decision["pendingApproval"])

    def _write_run_report(self, state: Dict[str, Any]) -> Dict[str, Any]:
        run_id = str(state.get("run_id") or "")
        run_dir = self._run_dir(run_id)
        run_dir.mkdir(parents=True, exist_ok=True)

        contract = self._validate_contract(run_id)
        registry_record = self._registry_record(run_id)
        report = self._build_run_report_payload(state=state, contract=contract, registry_record=registry_record)
        markdown = self._render_run_report_markdown(report)

        report_json_path = run_dir / "artifacts" / "run_report.json"
        report_md_path = run_dir / "artifacts" / "run_report.md"
        _atomic_write_text(
            report_json_path,
            json.dumps(report, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        _atomic_write_text(
            report_md_path,
            markdown if markdown.endswith("\n") else markdown + "\n",
            encoding="utf-8",
        )

        contract_after = self._validate_contract(run_id)
        contract_changed = (
            round(float(report.get("contractPassRate") or 0.0), 2) != round(float(contract_after.pass_rate), 2)
            or list(report.get("contractMissing") or []) != list(contract_after.missing)
        )
        if contract_changed:
            report = self._build_run_report_payload(state=state, contract=contract_after, registry_record=registry_record)
            markdown = self._render_run_report_markdown(report)
            _atomic_write_text(
                report_json_path,
                json.dumps(report, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            _atomic_write_text(
                report_md_path,
                markdown if markdown.endswith("\n") else markdown + "\n",
                encoding="utf-8",
            )

        return {
            "runId": run_id,
            "generatedAt": str(report.get("generatedAt") or _now_iso()),
            "report": report,
            "markdown": markdown,
            "artifactJsonPath": str(report_json_path),
            "artifactMarkdownPath": str(report_md_path),
        }

    def _build_run_report_payload(
        self,
        state: Dict[str, Any],
        contract: AgenticContractReport,
        registry_record: Dict[str, Any],
    ) -> Dict[str, Any]:
        run_id = str(state.get("run_id") or "")
        idea = state.get("idea") or {}
        spec = state.get("research_spec") or {}
        approval_policy_meta = spec.get("approvalPolicyMeta") or {}
        status = str(state.get("status") or "UNKNOWN")
        tot_tree = list(state.get("tot_tree") or [])
        timeline = list(state.get("timeline") or [])
        events = list(state.get("events") or [])
        approvals = list(state.get("pending_approvals") or [])
        sub_agents = list(state.get("sub_agents") or [])
        node_runs = list(state.get("node_runs") or [])
        llm_traces = self._load_llm_traces(run_id, limit=100000)
        matrix = state.get("matrix") or {}

        node_counts = {
            "pending": 0,
            "running": 0,
            "blocked": 0,
            "failed": 0,
            "succeeded": 0,
        }
        for node in tot_tree:
            node_status = str(node.get("status") or "").upper()
            if node_status in {"PENDING", "RETRY_PENDING"}:
                node_counts["pending"] += 1
            elif node_status == "RUNNING":
                node_counts["running"] += 1
            elif node_status == "BLOCKED":
                node_counts["blocked"] += 1
            elif node_status == "FAILED":
                node_counts["failed"] += 1
            elif node_status == "SUCCEEDED":
                node_counts["succeeded"] += 1

        approval_counts = {
            "pending": 0,
            "approved": 0,
            "rejected": 0,
            "expired": 0,
            "reopened": 0,
        }
        for item in approvals:
            approval_status = str(item.get("status") or "").upper()
            if approval_status == "PENDING":
                approval_counts["pending"] += 1
            elif approval_status == "APPROVED":
                approval_counts["approved"] += 1
            elif approval_status == "REJECTED":
                approval_counts["rejected"] += 1
            elif approval_status == "EXPIRED":
                approval_counts["expired"] += 1
            elif approval_status == "REOPENED":
                approval_counts["reopened"] += 1

        sub_agent_counts = {
            "total": len(sub_agents),
            "running": 0,
            "succeeded": 0,
            "failed": 0,
        }
        role_counts: Dict[str, int] = {}
        for item in sub_agents:
            sub_status = str(item.get("status") or "").upper()
            if sub_status == "RUNNING":
                sub_agent_counts["running"] += 1
            elif sub_status == "SUCCEEDED":
                sub_agent_counts["succeeded"] += 1
            elif sub_status == "FAILED":
                sub_agent_counts["failed"] += 1
            role = str(item.get("role") or "SubAgent")
            role_counts[role] = int(role_counts.get(role, 0)) + 1
        top_roles = [{"role": role, "count": count} for role, count in role_counts.items()]
        top_roles.sort(key=lambda row: (-int(row.get("count") or 0), str(row.get("role") or "")))
        top_roles = top_roles[:6]

        node_run_counts = {
            "total": len(node_runs),
            "running": 0,
            "succeeded": 0,
            "failed": 0,
        }
        for item in node_runs:
            status = str(item.get("status") or "").upper()
            if status == "RUNNING":
                node_run_counts["running"] += 1
            elif status == "SUCCEEDED":
                node_run_counts["succeeded"] += 1
            elif status == "FAILED":
                node_run_counts["failed"] += 1

        llm_counts = {
            "total": len(llm_traces),
            "succeeded": 0,
            "failed": 0,
        }
        for item in llm_traces:
            row_status = str(item.get("status") or "").upper()
            if row_status == "SUCCEEDED":
                llm_counts["succeeded"] += 1
            elif row_status == "FAILED":
                llm_counts["failed"] += 1

        failures = 0
        recoveries = 0
        safety_events = 0
        league_events = 0
        for row in timeline:
            blob = f"{row.get('phase', '')} {row.get('status', '')}".lower()
            if any(token in blob for token in ("fail", "blocked", "error")):
                failures += 1
            if any(token in blob for token in ("repair", "retry", "recover", "reopen")):
                recoveries += 1
            if any(token in blob for token in ("approval", "safety", "policy", "audit")):
                safety_events += 1
            if any(token in blob for token in ("matrix", "league", "ranking")):
                league_events += 1
        for row in events:
            blob = f"{row.get('event', '')} {row.get('message', '')}".lower()
            if any(token in blob for token in ("fail", "blocked", "error")):
                failures += 1
            if any(token in blob for token in ("repair", "retry", "recover", "reopen")):
                recoveries += 1
            if any(token in blob for token in ("approval", "safety", "policy", "audit")):
                safety_events += 1
            if any(token in blob for token in ("matrix", "league", "ranking")):
                league_events += 1

        ranking = list(matrix.get("ranking") or [])
        top_ranking: List[Dict[str, Any]] = []
        for idx, row in enumerate(ranking[:5], start=1):
            score_raw = row.get("score")
            try:
                score = float(score_raw)
            except Exception:
                score = 0.0
            top_ranking.append(
                {
                    "rank": idx,
                    "id": str(row.get("id") or f"ckpt_{idx}"),
                    "score": score,
                }
            )

        title = str(spec.get("title") or idea.get("title") or "Agentic Run")
        objective = str(spec.get("taskGoal") or idea.get("taskGoal") or "")
        run_rel_dir = f".local/agentic_os/runs/{run_id}"
        report = {
            "runId": run_id,
            "title": title,
            "status": status,
            "generatedAt": _now_iso(),
            "objective": objective,
            "contractPassRate": float(contract.pass_rate),
            "contractMissing": list(contract.missing),
            "totNodes": len(tot_tree),
            "timelineEvents": len(timeline) + len(events),
            "failureEvents": failures,
            "recoveryEvents": recoveries,
            "safetyEvents": safety_events,
            "leagueEvents": league_events,
            "approvals": approval_counts,
            "subAgents": {
                **sub_agent_counts,
                "topRoles": top_roles,
            },
            "nodeRuns": node_run_counts,
            "llmCalls": llm_counts,
            "matrix": {
                "labels": len(matrix.get("labels") or []),
                "topRanking": top_ranking,
            },
            "reproScript": f"{run_rel_dir}/repro_bundle/reproduce.sh",
            "replayCommand": f"python scripts/agentic_marl_os.py replay --run-id {run_id}",
            "nodeStatus": node_counts,
            "registryRecord": registry_record or {},
            "approvalPolicyMeta": approval_policy_meta,
        }
        return report

    def _render_run_report_markdown(self, report: Dict[str, Any]) -> str:
        approvals = report.get("approvals") or {}
        sub_agents = report.get("subAgents") or {}
        node_runs = report.get("nodeRuns") or {}
        matrix = report.get("matrix") or {}
        top_roles = list(sub_agents.get("topRoles") or [])
        top_ranking = list(matrix.get("topRanking") or [])
        missing = list(report.get("contractMissing") or [])

        lines = [
            f"# Agentic Run Report - {report.get('runId')}",
            "",
            f"- generated_at: {report.get('generatedAt')}",
            f"- title: {report.get('title')}",
            f"- status: {report.get('status')}",
            f"- objective: {report.get('objective')}",
            f"- contract_pass_rate: {float(report.get('contractPassRate') or 0.0):.2f}%",
            "",
            "## Execution Overview",
            f"- ToT nodes: {int(report.get('totNodes') or 0)}",
            f"- timeline events: {int(report.get('timelineEvents') or 0)}",
            f"- failure events: {int(report.get('failureEvents') or 0)}",
            f"- recovery events: {int(report.get('recoveryEvents') or 0)}",
            f"- safety events: {int(report.get('safetyEvents') or 0)}",
            f"- league events: {int(report.get('leagueEvents') or 0)}",
            "",
            "## Safety & Approval",
            f"- pending: {int(approvals.get('pending') or 0)}",
            f"- approved: {int(approvals.get('approved') or 0)}",
            f"- rejected: {int(approvals.get('rejected') or 0)}",
            f"- expired: {int(approvals.get('expired') or 0)}",
            f"- reopened: {int(approvals.get('reopened') or 0)}",
            "",
            "## Sub-Agent Orchestration",
            f"- total: {int(sub_agents.get('total') or 0)}",
            f"- running: {int(sub_agents.get('running') or 0)}",
            f"- succeeded: {int(sub_agents.get('succeeded') or 0)}",
            f"- failed: {int(sub_agents.get('failed') or 0)}",
            "- top roles:",
        ]
        if top_roles:
            lines.extend([f"  - {row.get('role')}: {int(row.get('count') or 0)}" for row in top_roles])
        else:
            lines.append("  - none")

        lines.extend(
            [
                "",
                "## Node Runs",
                f"- total: {int(node_runs.get('total') or 0)}",
                f"- running: {int(node_runs.get('running') or 0)}",
                f"- succeeded: {int(node_runs.get('succeeded') or 0)}",
                f"- failed: {int(node_runs.get('failed') or 0)}",
            ]
        )

        lines.extend(
            [
                "",
                "## League Matrix",
                f"- labels: {int(matrix.get('labels') or 0)}",
                "- top ranking:",
            ]
        )
        if top_ranking:
            lines.extend(
                [
                    f"  - #{int(row.get('rank') or 0)} {row.get('id')}: {float(row.get('score') or 0.0):.3f}"
                    for row in top_ranking
                ]
            )
        else:
            lines.append("  - none")

        lines.extend(["", "## Contract Missing"])
        if missing:
            lines.extend([f"- {item}" for item in missing])
        else:
            lines.append("- none")

        lines.extend(
            [
                "",
                "## Repro & Replay",
                f"- reproduce_script: {report.get('reproScript')}",
                f"- replay_command: {report.get('replayCommand')}",
                "",
            ]
        )
        return "\n".join(lines)

    def _write_error_report(self, state: Dict[str, Any], failure: Dict[str, Any]) -> None:
        run_dir = self._run_dir(str(state.get("run_id")))
        (run_dir / "artifacts" / "error_report.json").write_text(
            json.dumps(failure, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def _append_event(self, state: Dict[str, Any], event: str, message: str, payload: Dict[str, Any], actor: str = "system") -> None:
        chain = state.setdefault("audit_chain", {"seq": 0, "last_hash": "GENESIS"})
        prev_hash = str(chain.get("last_hash") or "GENESIS")
        seq = int(chain.get("seq") or 0) + 1
        ts = _now_iso()
        event_hash = self._calc_event_hash(
            seq=seq,
            ts=ts,
            event=event,
            message=message,
            payload=payload,
            prev_hash=prev_hash,
            actor=actor,
        )
        entry = {
            "seq": seq,
            "ts": ts,
            "event": event,
            "message": message,
            "payload": payload,
            "actor": actor,
            "prevHash": prev_hash,
            "eventHash": event_hash,
        }
        state.setdefault("events", []).append(entry)
        chain["seq"] = seq
        chain["last_hash"] = event_hash

    def _append_timeline(self, state: Dict[str, Any], node: Dict[str, Any], phase: str, cost: float) -> None:
        state.setdefault("timeline", []).append(
            {
                "ts": _now_iso(),
                "nodeId": node.get("node_id"),
                "agent": node.get("agent"),
                "phase": phase,
                "status": node.get("status"),
                "cost": round(cost, 4),
            }
        )

    def _append_log(self, state: Dict[str, Any], line: str) -> None:
        run_dir = self._run_dir(str(state.get("run_id")))
        log_path = run_dir / "artifacts" / "log.txt"
        self._rotate_log_if_needed(log_path)
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(f"{_now_iso()} {line}\n")

    def _select_pending_node_for_search(self, state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        rows: List[Tuple[float, int, str, Dict[str, Any]]] = []
        for node in state.get("tot_tree", []):
            status = str(node.get("status") or "").upper()
            if status not in {"PENDING", "RETRY_PENDING", "RUNNING"}:
                continue
            self._ensure_search_node_state(state, node)
            depth = self._node_depth(state, node)
            score = self._frontier_score(state, node, depth=depth)
            rows.append((score, depth, str(node.get("node_id") or ""), node))

        if not rows:
            return None

        rows.sort(key=lambda row: (-row[0], row[1], row[2]))
        score, depth, node_id, selected = rows[0]
        search = self._ensure_search_node_state(state, selected)
        search["frontierScore"] = round(score, 4)
        search["depth"] = depth
        search["selectedCount"] = int(search.get("selectedCount") or 0) + 1
        search["selectedAt"] = _now_iso()
        self._append_event(
            state,
            event="search_node_selected",
            message=f"Selected frontier node {node_id}",
            payload={"node_id": node_id, "score": round(score, 4), "depth": depth},
        )
        return selected

    def _ensure_search_node_state(self, state: Dict[str, Any], node: Dict[str, Any]) -> Dict[str, Any]:
        evidence = node.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
            node["evidence"] = evidence
        search = evidence.get("search")
        if not isinstance(search, dict):
            search = {}
            evidence["search"] = search
        search.setdefault("visits", 0)
        search.setdefault("value", 0.0)
        search.setdefault("expanded", False)
        search.setdefault("selectedCount", 0)
        search.setdefault("frontierScore", 0.0)
        search.setdefault("depth", self._node_depth(state, node))
        return search

    def _node_depth(self, state: Dict[str, Any], node: Dict[str, Any]) -> int:
        by_id = {str(item.get("node_id") or ""): item for item in state.get("tot_tree", [])}
        depth = 0
        cursor = node
        seen: set[str] = set()
        while True:
            parent_id = str(cursor.get("parent_id") or "")
            if not parent_id:
                break
            if parent_id in seen:
                break
            seen.add(parent_id)
            parent = by_id.get(parent_id)
            if not isinstance(parent, dict):
                break
            depth += 1
            cursor = parent
        return depth

    def _frontier_score(self, state: Dict[str, Any], node: Dict[str, Any], *, depth: Optional[int] = None) -> float:
        search = self._ensure_search_node_state(state, node)
        visits = float(search.get("visits") or 0.0)
        value = float(search.get("value") or 0.0)
        depth_v = depth if depth is not None else self._node_depth(state, node)
        metric_signal = self._metric_signal(node)
        risk = str(node.get("risk") or "medium").lower()
        risk_penalty = 0.2 if risk == "high" else 0.1 if risk == "medium" else 0.03

        parent_visits = 1.0
        parent_id = str(node.get("parent_id") or "")
        if parent_id:
            parent = self._find_node(state, parent_id)
            if isinstance(parent, dict):
                parent_search = self._ensure_search_node_state(state, parent)
                parent_visits = float(parent_search.get("visits") or 1.0)
        exploration = math.sqrt(max(0.0, math.log(parent_visits + 2.0) / (visits + 1.0)))
        depth_penalty = min(0.2, max(0.0, (depth_v - 1) * 0.05))
        status = str(node.get("status") or "").upper()
        status_bonus = 0.03 if status == "RETRY_PENDING" else 0.0
        score = metric_signal * 0.52 + value * 0.28 + exploration * 0.24 + status_bonus - risk_penalty - depth_penalty
        return max(0.0, min(1.5, score))

    def _metric_signal(self, node: Dict[str, Any]) -> float:
        metrics = node.get("expected_metrics")
        if not isinstance(metrics, dict):
            return 0.5
        values = list(metrics.values())
        if not values:
            return 0.5
        blob = " ".join(str(v) for v in values)
        match = re.search(r"[-+]?\d*\.?\d+", blob)
        if not match:
            return 0.5
        try:
            number = float(match.group(0))
        except Exception:
            return 0.5
        if number > 1.0:
            number = number / 100.0
        return max(0.0, min(1.0, number))

    def _record_search_result(
        self,
        state: Dict[str, Any],
        node: Dict[str, Any],
        *,
        succeeded: bool,
        failure: Optional[Dict[str, Any]],
    ) -> None:
        reward = self._search_reward(node=node, succeeded=succeeded, failure=failure)
        by_id = {str(item.get("node_id") or ""): item for item in state.get("tot_tree", [])}
        cursor = node
        discount = 1.0
        seen: set[str] = set()
        while isinstance(cursor, dict):
            node_id = str(cursor.get("node_id") or "")
            if not node_id or node_id in seen:
                break
            seen.add(node_id)
            search = self._ensure_search_node_state(state, cursor)
            visits_prev = int(search.get("visits") or 0)
            value_prev = float(search.get("value") or 0.0)
            visits_new = visits_prev + 1
            local_reward = max(0.0, min(1.0, reward * discount))
            value_new = ((value_prev * visits_prev) + local_reward) / max(1, visits_new)
            search["visits"] = visits_new
            search["value"] = round(value_new, 4)
            search["lastReward"] = round(local_reward, 4)
            search["lastResult"] = "SUCCEEDED" if succeeded else "FAILED"
            search["updatedAt"] = _now_iso()
            parent_id = str(cursor.get("parent_id") or "")
            if not parent_id:
                break
            cursor = by_id.get(parent_id)
            discount *= 0.9

    def _search_reward(self, node: Dict[str, Any], *, succeeded: bool, failure: Optional[Dict[str, Any]]) -> float:
        metric_signal = self._metric_signal(node)
        risk = str(node.get("risk") or "medium").lower()
        risk_penalty = 0.12 if risk == "high" else 0.07 if risk == "medium" else 0.03
        if succeeded:
            reward = 0.55 + metric_signal * 0.35 - risk_penalty
        else:
            reward = 0.12 + metric_signal * 0.1 - risk_penalty
            reason = str((failure or {}).get("reason") or "").lower()
            if "blocked" in reason:
                reward *= 0.6
        return max(0.0, min(1.0, reward))

    def _search_plan(self, state: Dict[str, Any]) -> Dict[str, int]:
        spec = state.get("research_spec") or {}
        budget = spec.get("budget") or {}
        try:
            gpu_hours = float(budget.get("gpuHours") or 0.0)
        except Exception:
            gpu_hours = 0.0
        try:
            wallclock = int(budget.get("wallclockMinutes") or 60)
        except Exception:
            wallclock = 60

        max_depth = 3
        if wallclock >= 180 or gpu_hours >= 6:
            max_depth = 4
        elif wallclock <= 45 and gpu_hours <= 1:
            max_depth = 2
        branch_factor = 2 if gpu_hours < 4 else 3
        max_nodes = max(18, min(72, 12 + branch_factor * max_depth * 6))

        env_depth = os.getenv("AGENTIC_SEARCH_MAX_DEPTH")
        env_branch = os.getenv("AGENTIC_SEARCH_BRANCH_FACTOR")
        env_nodes = os.getenv("AGENTIC_SEARCH_MAX_NODES")
        try:
            if env_depth:
                max_depth = max(2, min(5, int(env_depth)))
        except Exception:
            pass
        try:
            if env_branch:
                branch_factor = max(1, min(4, int(env_branch)))
        except Exception:
            pass
        try:
            if env_nodes:
                max_nodes = max(12, min(120, int(env_nodes)))
        except Exception:
            pass
        return {"maxDepth": max_depth, "branchFactor": branch_factor, "maxNodes": max_nodes}

    def _maybe_expand_search_frontier(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        if str(node.get("status") or "").upper() != "SUCCEEDED":
            return
        agent = str(node.get("agent") or "")
        title = str(node.get("title") or "")
        if agent not in {"ResearchAgent", "IntegrationAgent", "EvalAgent"}:
            return
        if title.lower().startswith("repair branch"):
            return

        search = self._ensure_search_node_state(state, node)
        if bool(search.get("expanded")):
            return

        plan = self._search_plan(state)
        depth = self._node_depth(state, node)
        if depth >= int(plan.get("maxDepth") or 3):
            search["expanded"] = True
            search["expandedReason"] = "depth_cap"
            return

        if len(state.get("tot_tree") or []) >= int(plan.get("maxNodes") or 32):
            search["expanded"] = True
            search["expandedReason"] = "node_cap"
            return

        candidates = self._search_expansion_candidates(state, node, branch_factor=int(plan.get("branchFactor") or 2))
        if not candidates:
            search["expanded"] = True
            search["expandedReason"] = "no_candidates"
            return

        created_ids: List[str] = []
        created_mutations: List[Dict[str, Any]] = []
        for idx, candidate in enumerate(candidates, start=1):
            if len(state.get("tot_tree") or []) >= int(plan.get("maxNodes") or 32):
                break
            new_id = self._next_node_id(state)
            mutation_plan = candidate.get("mutation_plan") if isinstance(candidate.get("mutation_plan"), dict) else {}
            child = {
                "node_id": new_id,
                "parent_id": node.get("node_id"),
                "agent": candidate.get("agent") or agent,
                "title": candidate.get("title") or f"{title} / Branch {idx}",
                "hypothesis": candidate.get("hypothesis") or "Branch exploration",
                "execution_plan": candidate.get("execution_plan") or "Execute branch hypothesis and collect evidence.",
                "expected_metrics": candidate.get("expected_metrics") or node.get("expected_metrics") or {},
                "budget": candidate.get("budget") or self._child_budget_from_parent(node=node, branch_index=idx),
                "node_function": str(candidate.get("node_function") or "coding"),
                "llm_enabled": bool(
                    candidate.get("llm_enabled")
                    if candidate.get("llm_enabled") is not None
                    else self._is_node_llm_enabled(state, node)
                ),
                "risk": candidate.get("risk") or "medium",
                "status": "PENDING",
                "rationale": f"Search expansion from {node.get('node_id')}",
                "evidence": {
                    "search": {
                        "visits": 0,
                        "value": 0.0,
                        "expanded": False,
                        "depth": depth + 1,
                        "frontierScore": 0.0,
                        "generatedFrom": str(node.get("node_id") or ""),
                    },
                    "expansion": {
                        "strategy": candidate.get("strategy") or "llm_code_branch",
                        "mutationPlan": mutation_plan,
                        "createdAt": _now_iso(),
                    },
                },
                "sub_agents": [],
                "next_suggestions": ["Execute this branch", "Compare with sibling branches"],
                "children": [],
            }
            state.setdefault("tot_tree", []).append(child)
            node.setdefault("children", []).append(new_id)
            created_ids.append(new_id)
            created_mutations.append(
                {
                    "nodeId": new_id,
                    "strategy": str(mutation_plan.get("strategy") or ""),
                    "mutationKind": str(mutation_plan.get("mutationKind") or ""),
                    "targetFiles": self._normalize_target_files(mutation_plan.get("targetFiles") or []),
                }
            )

        search["expanded"] = True
        search["expandedAt"] = _now_iso()
        if created_ids:
            self._append_event(
                state,
                event="tot_node_expanded",
                message=f"Expanded {node.get('node_id')} with {len(created_ids)} child nodes",
                payload={
                    "node_id": node.get("node_id"),
                    "nodeId": node.get("node_id"),
                    "created_node_ids": created_ids,
                    "createdNodeIds": created_ids,
                    "childIds": created_ids,
                    "mutations": created_mutations,
                    "depth": depth + 1,
                    "branch_factor": int(plan.get("branchFactor") or 2),
                },
            )
            self._append_timeline(state, node, "search_expanded", cost=0.08)
            self._append_log(state, f"[{node.get('node_id')}] Search expanded with children={created_ids}")

    def _search_expansion_candidates(self, state: Dict[str, Any], node: Dict[str, Any], *, branch_factor: int) -> List[Dict[str, Any]]:
        agent = str(node.get("agent") or "")
        node_id = str(node.get("node_id") or "")
        base_metric = node.get("expected_metrics") if isinstance(node.get("expected_metrics"), dict) else {}
        templates = self._runtime_code_mutation_templates(state, node)
        if not templates:
            raise RuntimeError("llm_required_empty_mutation_templates")
        capped = max(1, min(len(templates), branch_factor))
        rows = []
        primary_metric = self._primary_metric_key(state)
        for idx, item in enumerate(templates[:capped], start=1):
            expected = dict(base_metric) if base_metric else {"winRate": ">=0.55"}
            budget = self._child_budget_from_parent(node=node, branch_index=idx)
            mutation_plan = {
                "strategy": str(item.get("strategy") or "code_mutation"),
                "mutationKind": str(item.get("mutationKind") or "code"),
                "changeSummary": str(item.get("changeSummary") or "Code-level mutation proposal."),
                "targetFiles": self._normalize_target_files(item.get("targetFiles") or []),
                "validationCommand": str(item.get("validationCommand") or "python -m pytest apps/portal-backend/tests -q"),
            }
            mutation_kind = str(mutation_plan.get("mutationKind") or "code").strip().lower() or "code"
            title_raw = str(item.get("title") or f"{node_id} Code Branch {idx}").strip()
            title = title_raw if title_raw.lower().startswith(f"[{mutation_kind}]") else f"[{mutation_kind.upper()}] {title_raw}"
            targets = [str(v) for v in (mutation_plan.get("targetFiles") or []) if str(v).strip()]
            target_hint = ", ".join(Path(path).name for path in targets[:2])
            execution_plan_raw = str(item.get("executionPlan") or "Apply patch proposal and execute branch run.").strip()
            execution_plan = execution_plan_raw
            if targets and "patch files:" not in execution_plan_raw.lower():
                execution_plan = f"{execution_plan_raw} Patch files: {target_hint}."
            hypothesis = str(item.get("hypothesis") or f"Code-level mutation can improve {primary_metric}.").strip()
            if "code" not in hypothesis.lower() and mutation_kind not in hypothesis.lower():
                hypothesis = f"{hypothesis} This branch changes source code ({mutation_kind})."
            rows.append(
                {
                    "title": title,
                    "hypothesis": hypothesis,
                    "execution_plan": execution_plan,
                    "agent": agent,
                    "expected_metrics": expected,
                    "budget": budget,
                    "risk": str(item.get("risk") or "medium"),
                    "strategy": str(item.get("strategy") or "code_mutation"),
                    "mutation_plan": mutation_plan,
                }
            )
        return rows

    def _child_budget_from_parent(self, node: Dict[str, Any], branch_index: int) -> Dict[str, Any]:
        parent_budget = node.get("budget") if isinstance(node.get("budget"), dict) else {}
        try:
            parent_gpu = float(parent_budget.get("gpuHours") or 0.2)
        except Exception:
            parent_gpu = 0.2
        try:
            parent_wallclock = int(parent_budget.get("wallclockMinutes") or 20)
        except Exception:
            parent_wallclock = 20
        ratio = 0.45 if branch_index == 1 else 0.35 if branch_index == 2 else 0.3
        gpu = max(0.05, round(parent_gpu * ratio, 3))
        wallclock = max(5, int(parent_wallclock * ratio))
        return {"gpuHours": gpu, "wallclockMinutes": wallclock}

    def _rotate_log_if_needed(self, log_path: Path) -> None:
        max_bytes = int(os.getenv("AGENTIC_LOG_MAX_BYTES", str(2 * 1024 * 1024)))
        max_backups = int(os.getenv("AGENTIC_LOG_MAX_BACKUPS", "3"))
        if max_bytes <= 0 or max_backups < 1:
            return
        if not log_path.exists():
            return
        try:
            size = log_path.stat().st_size
        except OSError:
            return
        if size < max_bytes:
            return
        oldest = log_path.with_name(f"{log_path.name}.{max_backups}")
        if oldest.exists():
            oldest.unlink(missing_ok=True)
        for idx in range(max_backups - 1, 0, -1):
            src = log_path.with_name(f"{log_path.name}.{idx}")
            dst = log_path.with_name(f"{log_path.name}.{idx + 1}")
            if src.exists():
                src.rename(dst)
        rotated = log_path.with_name(f"{log_path.name}.1")
        log_path.rename(rotated)

    def _next_node_id(self, state: Dict[str, Any]) -> str:
        indices = []
        for node in state.get("tot_tree", []):
            nid = str(node.get("node_id") or "")
            if nid.startswith("n") and nid[1:].isdigit():
                indices.append(int(nid[1:]))
        next_idx = max(indices) + 1 if indices else 1
        return f"n{next_idx}"

    def _find_node(self, state: Dict[str, Any], node_id: str) -> Optional[Dict[str, Any]]:
        for node in state.get("tot_tree", []):
            if node.get("node_id") == node_id:
                return node
        return None

    def _collect_descendants(self, state: Dict[str, Any], node_id: str) -> List[str]:
        descendants: List[str] = []
        queue = [node_id]
        while queue:
            current = queue.pop(0)
            for node in state.get("tot_tree", []):
                if node.get("parent_id") == current:
                    nid = str(node.get("node_id"))
                    descendants.append(nid)
                    queue.append(nid)
        return descendants

    def _validate_contract(self, run_id: str) -> AgenticContractReport:
        run_dir = self._run_dir(run_id)
        missing: List[str] = []
        for rel in self.REQUIRED_CONTRACT_ITEMS:
            if rel.endswith("/"):
                if not (run_dir / rel.rstrip("/")).exists():
                    missing.append(rel)
            else:
                if not (run_dir / rel).exists():
                    missing.append(rel)
        total = len(self.REQUIRED_CONTRACT_ITEMS)
        present = total - len(missing)
        pass_rate = round((present / total) * 100 if total else 100.0, 2)
        return AgenticContractReport(total_required=total, present=present, pass_rate=pass_rate, missing=missing)

    def _sync_contract_and_registry(self, run_id: str) -> None:
        state = self._load_state(run_id)
        contract = self._validate_contract(run_id)
        audit = self._verify_audit_chain(state.get("events") or [])
        semantic = self._semantic_replay_validation(state.get("events") or [])
        policy_meta = (state.get("research_spec") or {}).get("approvalPolicyMeta") or {}
        compact_policy_meta = {
            "rulesVersion": policy_meta.get("rulesVersion"),
            "rulesHash": policy_meta.get("rulesHash"),
            "policyHash": policy_meta.get("policyHash"),
            "mode": policy_meta.get("mode"),
            "matchedTemplates": list(policy_meta.get("matchedTemplates") or []),
        }
        record = {
            "run_id": run_id,
            "title": (state.get("research_spec") or {}).get("title"),
            "objective": (state.get("research_spec") or {}).get("taskGoal"),
            "status": state.get("status"),
            "created_at": state.get("created_at"),
            "updated_at": state.get("updated_at"),
            "spec_hash": _stable_hash(state.get("research_spec") or {}),
            "specHash": _stable_hash(state.get("research_spec") or {}),
            "config_hash": _stable_hash(state.get("root_config_draft") or {}),
            "configHash": _stable_hash(state.get("root_config_draft") or {}),
            "failure_reason": state.get("failure_reason"),
            "metrics": {
                "events": len(state.get("events") or []),
                "timeline": len(state.get("timeline") or []),
                "matrixGenerated": state.get("matrix") is not None,
                "subAgents": len(state.get("sub_agents") or []),
                "nodeRuns": len(state.get("node_runs") or []),
                "auditVerified": bool(audit.get("valid")),
                "auditCheckedEvents": int(audit.get("checked") or 0),
                "auditSemanticValid": bool(semantic.get("valid")),
            },
            "contract_pass_rate": contract.pass_rate,
            "missing_contract_items": contract.missing,
            "audit_verified": bool(audit.get("valid")),
            "audit_failure_reason": audit.get("reason"),
            "audit_semantic_valid": bool(semantic.get("valid")),
            "audit_semantic_issues": list(semantic.get("issues") or []),
            "git": state.get("git_info"),
            "approval_policy_meta": compact_policy_meta,
            "approvalPolicyMeta": compact_policy_meta,
        }

        with self._file_lock(self._registry_lock_path()):
            rows = _read_jsonl(self.registry_path)
            replaced = False
            for idx, row in enumerate(rows):
                if row.get("run_id") == run_id:
                    rows[idx] = record
                    replaced = True
                    break
            if not replaced:
                rows.append(record)
            _write_jsonl(self.registry_path, rows)

    def _registry_record(self, run_id: str) -> Dict[str, Any]:
        with self._file_lock(self._registry_lock_path()):
            rows = _read_jsonl(self.registry_path)
        for row in rows:
            if row.get("run_id") == run_id:
                return row
        return {}

    def _resolve_git_context(self, spec_git: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if isinstance(spec_git, dict) and any(spec_git.get(k) for k in ("repo", "branch", "commit")):
            return {
                "source": "input",
                "repo": spec_git.get("repo"),
                "branch": spec_git.get("branch"),
                "commit": spec_git.get("commit"),
            }

        repos: List[Dict[str, Any]] = []
        for name in ("rl-research-platform", "MLE"):
            repo_dir = self.workspace_root / name
            if not repo_dir.exists():
                continue
            branch = self._run_git_cmd(repo_dir, ["git", "rev-parse", "--abbrev-ref", "HEAD"])
            commit = self._run_git_cmd(repo_dir, ["git", "rev-parse", "HEAD"])
            remote = self._run_git_cmd(repo_dir, ["git", "config", "--get", "remote.origin.url"])
            repos.append(
                {
                    "name": name,
                    "path": str(repo_dir),
                    "repo": remote,
                    "branch": branch,
                    "commit": commit,
                }
            )

        return {
            "source": "workspace",
            "repos": repos,
        }

    def _run_git_cmd(self, cwd: Path, cmd: List[str]) -> Optional[str]:
        try:
            out = subprocess.check_output(cmd, cwd=str(cwd), stderr=subprocess.DEVNULL)
        except Exception:
            return None
        value = out.decode("utf-8", errors="ignore").strip()
        return value or None

    def _compute_elo(self, labels: List[str], cells: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        ratings = {label: 1000.0 for label in labels}
        k_factor = 24.0
        for cell in cells:
            row = str(cell.get("row"))
            col = str(cell.get("col"))
            if row == col:
                continue
            score = float(cell.get("winRate") or 0.5)
            expected_row = 1.0 / (1.0 + 10 ** ((ratings[col] - ratings[row]) / 400.0))
            expected_col = 1.0 - expected_row
            ratings[row] += k_factor * (score - expected_row)
            ratings[col] += k_factor * ((1.0 - score) - expected_col)
        ranking = [{"id": label, "score": round(ratings[label], 3)} for label in labels]
        ranking.sort(key=lambda item: item["score"], reverse=True)
        return ranking

    def _downsample_labels(self, labels: List[str], max_size: int) -> List[str]:
        if max_size <= 0:
            return labels[:1]
        if len(labels) <= max_size:
            return labels
        if max_size == 1:
            return [labels[0]]

        span = len(labels) - 1
        picks: List[str] = []
        seen: set[str] = set()
        for i in range(max_size):
            idx = int(round(i * span / (max_size - 1)))
            label = labels[idx]
            if label in seen:
                continue
            picks.append(label)
            seen.add(label)

        if len(picks) < max_size:
            for label in labels:
                if label in seen:
                    continue
                picks.append(label)
                seen.add(label)
                if len(picks) >= max_size:
                    break
        return picks[:max_size]

    def _evaluate_action_policy(
        self,
        action: str,
        constraints: Dict[str, Any],
        approved_actions: set[str],
        approval_policy: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        policy = self._normalize_approval_policy(approval_policy or {})
        action_name = str(action or "").strip()
        forbidden = set(constraints.get("forbiddenActions") or [])
        compliance = set(constraints.get("compliance") or [])
        allow_network = bool(constraints.get("allowNetwork"))
        allow_dependency_install = bool(constraints.get("allowDependencyInstall"))
        known_actions = set(self.KNOWN_ACTIONS)
        known_actions.update(str(item).strip() for item in (policy.get("highRiskActions") or []) if str(item).strip())

        reasons: List[str] = []
        if action_name in forbidden:
            reasons.append("forbidden_action")
        if action_name == "external_dependency_install" and not allow_dependency_install:
            reasons.append("dependency_install_disabled")
        if action_name == "data_exfiltration" and (not allow_network or "no_external_data_push" in compliance):
            reasons.append("data_egress_blocked")
        is_unknown_action = bool(action_name) and action_name not in known_actions
        if is_unknown_action and bool(policy.get("requireApprovalForUnknownActions")):
            reasons.append("unknown_action")

        high_risk_actions = set(str(item).strip() for item in (policy.get("highRiskActions") or []) if str(item).strip())
        is_high_risk = action_name in high_risk_actions
        blocked_by_policy = bool([reason for reason in reasons if reason != "unknown_action"])
        requires_approval = is_high_risk or blocked_by_policy or ("unknown_action" in reasons)
        already_approved = action_name in approved_actions
        pending_approval = bool(action_name) and requires_approval and not already_approved

        reason_code = "approval_required"
        if blocked_by_policy:
            reason_code = "policy_blocked"
        elif "unknown_action" in reasons:
            reason_code = "unknown_action_requires_approval"
        elif is_high_risk:
            reason_code = "high_risk_requires_approval"

        required_roles: List[str] = []
        if reason_code == "policy_blocked":
            required_roles = list(policy.get("blockedActionRoles") or [])
        elif reason_code == "unknown_action_requires_approval":
            required_roles = list(policy.get("highRiskActionRoles") or [])
        elif reason_code == "high_risk_requires_approval":
            required_roles = list(policy.get("highRiskActionRoles") or [])
        required_approvals = int(policy.get("minApprovals") or 1)
        required_approvals = max(1, min(3, required_approvals))
        require_distinct_roles = bool(policy.get("requireDistinctRoles"))
        approval_ttl_minutes = int(policy.get("approvalTtlMinutes") or 120)
        approval_ttl_minutes = max(5, min(10080, approval_ttl_minutes))

        prompt = f"Approve action '{action_name}'?"
        if reason_code == "policy_blocked":
            prompt = f"Approve policy-blocked action '{action_name}' with override?"
        elif reason_code == "unknown_action_requires_approval":
            prompt = f"Approve unknown action '{action_name}' under {policy.get('mode')} policy?"

        return {
            "action": action_name,
            "isHighRisk": is_high_risk,
            "isUnknownAction": is_unknown_action,
            "blockedByPolicy": blocked_by_policy,
            "requiresApproval": requires_approval,
            "alreadyApproved": already_approved,
            "pendingApproval": pending_approval,
            "reasonCode": reason_code,
            "reasons": reasons,
            "requiredRoles": required_roles,
            "requiredApprovals": required_approvals if requires_approval else 0,
            "requireDistinctRoles": require_distinct_roles if requires_approval else False,
            "approvalTtlMinutes": approval_ttl_minutes if requires_approval else 0,
            "policyMode": policy.get("mode"),
            "prompt": prompt,
        }

    def _ensure_pending_approval(
        self,
        state: Dict[str, Any],
        node_id: str,
        action: str,
        reason: str,
        prompt: str,
        required_roles: Optional[List[str]] = None,
        required_approvals: int = 1,
        require_distinct_roles: bool = False,
        ttl_minutes: int = 120,
    ) -> None:
        approvals = state.setdefault("pending_approvals", [])
        normalized_required = max(1, min(3, int(required_approvals or 1)))
        ttl_value = max(5, min(10080, int(ttl_minutes or 120)))
        expires_at_value = (_now() + timedelta(minutes=ttl_value)).replace(microsecond=0).isoformat()
        unique_required_roles = list(dict.fromkeys([str(v).strip().lower() for v in (required_roles or []) if str(v).strip()]))
        require_distinct_roles_effective = bool(require_distinct_roles)
        if require_distinct_roles_effective and unique_required_roles and len(unique_required_roles) < normalized_required:
            require_distinct_roles_effective = False
        for item in approvals:
            if item.get("action") != action or item.get("status") != "PENDING":
                continue
            existing_required = int(item.get("required_approvals") or 1)
            item["required_approvals"] = max(existing_required, normalized_required)
            item["require_distinct_roles"] = bool(item.get("require_distinct_roles") or require_distinct_roles_effective)
            existing_roles = [str(v).strip().lower() for v in (item.get("required_roles") or []) if str(v).strip()]
            merged_roles = list(dict.fromkeys(existing_roles + unique_required_roles))
            item["required_roles"] = merged_roles
            item["expires_at"] = item.get("expires_at") or expires_at_value
            return
        approvals.append(
            {
                "id": f"appr-{uuid.uuid4().hex[:8]}",
                "node_id": node_id,
                "action": action,
                "reason": reason,
                "prompt": prompt,
                "required_roles": list(unique_required_roles),
                "required_approvals": normalized_required,
                "require_distinct_roles": bool(require_distinct_roles_effective),
                "approval_ttl_minutes": ttl_value,
                "expires_at": expires_at_value,
                "approvals": [],
                "status": "PENDING",
                "created_at": _now_iso(),
            }
        )

    def _to_csv(self, cells: List[Dict[str, Any]]) -> str:
        rows = ["row,col,win_rate,confidence,verdict,log_uri,replay_uri"]
        for cell in cells:
            rows.append(
                ",".join(
                    [
                        str(cell.get("row")),
                        str(cell.get("col")),
                        str(cell.get("winRate")),
                        str(cell.get("confidence")),
                        str(cell.get("verdict")),
                        str(cell.get("logUri")),
                        str(cell.get("replayUri")),
                    ]
                )
            )
        return "\n".join(rows) + "\n"

    def _is_idempotent_done(self, state: Dict[str, Any], scope: str, key: str) -> bool:
        if not key:
            return False
        idem = state.get("idempotency") or {}
        marker = idem.get(f"{scope}:{key}")
        return bool(marker)

    def _mark_idempotent_done(self, state: Dict[str, Any], scope: str, key: str, status: str) -> None:
        if not key:
            return
        idem = state.setdefault("idempotency", {})
        idem[f"{scope}:{key}"] = {"status": status, "updatedAt": _now_iso()}

    def _calc_event_hash(
        self,
        seq: int,
        ts: str,
        event: str,
        message: str,
        payload: Dict[str, Any],
        prev_hash: str,
        actor: str,
    ) -> str:
        return _stable_hash(
            {
                "seq": int(seq),
                "ts": str(ts),
                "event": str(event),
                "message": str(message),
                "payload": payload,
                "prevHash": str(prev_hash),
                "actor": str(actor),
            }
        )

    def _verify_audit_chain(self, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        prev_hash = "GENESIS"
        checked = 0
        for index, event in enumerate(events, start=1):
            seq = int(event.get("seq") or 0)
            ts = str(event.get("ts") or "")
            event_name = str(event.get("event") or "")
            message = str(event.get("message") or "")
            payload = event.get("payload") or {}
            actor = str(event.get("actor") or "system")
            prev = str(event.get("prevHash") or "")
            event_hash = str(event.get("eventHash") or "")

            if seq != index:
                return {
                    "valid": False,
                    "checked": checked,
                    "reason": f"invalid_sequence_at_index_{index}",
                    "lastHash": prev_hash,
                }
            if prev != prev_hash:
                return {
                    "valid": False,
                    "checked": checked,
                    "reason": f"prev_hash_mismatch_at_seq_{seq}",
                    "lastHash": prev_hash,
                }

            expected_hash = self._calc_event_hash(
                seq=seq,
                ts=ts,
                event=event_name,
                message=message,
                payload=payload,
                prev_hash=prev,
                actor=actor,
            )
            if event_hash != expected_hash:
                return {
                    "valid": False,
                    "checked": checked,
                    "reason": f"event_hash_mismatch_at_seq_{seq}",
                    "lastHash": prev_hash,
                }

            prev_hash = event_hash
            checked += 1

        return {"valid": True, "checked": checked, "reason": None, "lastHash": prev_hash}

    def _semantic_replay_validation(self, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        issues: List[str] = []
        node_states: Dict[str, str] = {}
        sub_states: Dict[str, str] = {}
        for event in events:
            event_name = str(event.get("event") or "")
            payload = event.get("payload") or {}
            node_id = str(payload.get("node_id") or "")
            sub_agent_id = str(payload.get("sub_agent_id") or "")

            if event_name == "node_started":
                if node_id and node_states.get(node_id) == "RUNNING":
                    issues.append(f"node_started_duplicate:{node_id}")
                if node_id:
                    node_states[node_id] = "RUNNING"
            elif event_name == "node_succeeded":
                if node_id and node_states.get(node_id) != "RUNNING":
                    issues.append(f"node_succeeded_without_start:{node_id}")
                if node_id:
                    node_states[node_id] = "SUCCEEDED"
            elif event_name == "node_failed":
                if node_id and node_states.get(node_id) != "RUNNING":
                    issues.append(f"node_failed_without_start:{node_id}")
                if node_id:
                    node_states[node_id] = "FAILED"
            elif event_name == "node_unblocked":
                if node_id and node_states.get(node_id) not in {"BLOCKED", "FAILED", "RUNNING", "RETRY_PENDING", "SUCCEEDED"}:
                    issues.append(f"node_unblocked_unknown_node:{node_id}")
                if node_id:
                    node_states[node_id] = "RETRY_PENDING"
            elif event_name == "sub_agent_started":
                if sub_agent_id and sub_states.get(sub_agent_id) == "RUNNING":
                    issues.append(f"sub_agent_started_duplicate:{sub_agent_id}")
                if sub_agent_id:
                    sub_states[sub_agent_id] = "RUNNING"
            elif event_name in {"sub_agent_succeeded", "sub_agent_failed"}:
                if sub_agent_id and sub_states.get(sub_agent_id) != "RUNNING":
                    issues.append(f"{event_name}_without_start:{sub_agent_id}")
                if sub_agent_id:
                    sub_states[sub_agent_id] = "SUCCEEDED" if event_name == "sub_agent_succeeded" else "FAILED"
            elif event_name == "approval_updated":
                if not isinstance(payload.get("approval_ids"), list):
                    issues.append("approval_updated_missing_ids")

        return {"valid": len(issues) == 0, "issues": issues[:30]}

    def _parse_dt(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value)
            except ValueError:
                pass
        return _now()


agentic_os_service = AgenticOSService()
