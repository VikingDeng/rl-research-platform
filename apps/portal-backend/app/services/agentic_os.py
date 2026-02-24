from __future__ import annotations

import copy
import hashlib
import json
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
    AgenticRunCreateRequest,
    AgenticRunDetail,
    AgenticRunSummary,
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
        validation = self.validate_spec_input(payload.idea)
        run_id = f"agentic-{_now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        run_dir = self.runs_root / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        now_iso = _now_iso()
        nodes = self._build_tot_tree(validation.normalized_spec)
        state: Dict[str, Any] = {
            "run_id": run_id,
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

        pending_nodes = [n for n in state.get("tot_tree", []) if n.get("status") in {"PENDING", "RETRY_PENDING", "RUNNING"}]
        if payload.mode == "next":
            pending_nodes = pending_nodes[:1]

        for node in pending_nodes:
            self._execute_node(state, node)
            self._persist_state(run_id, state)
            self._sync_contract_and_registry(run_id)
            if payload.mode == "next":
                break
            if node.get("status") in {"BLOCKED", "FAILED"}:
                break

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

    def get_run_detail(self, run_id: str) -> AgenticRunDetail:
        state = self._load_state(run_id)
        contract = self._validate_contract(run_id)
        record = self._registry_record(run_id)

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
            contract=contract,
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
                }
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
        ]
        if risk_hints:
            lines.append(f"- Rule hints: {', '.join(risk_hints)}")
        return "\n".join(lines)

    def _build_tot_tree(self, spec: Dict[str, Any]) -> List[Dict[str, Any]]:
        budget = spec.get("budget") or {}
        execution_mode = self._normalize_execution_mode((spec.get("execution") or {}).get("mode"))
        metric = next(iter((spec.get("successMetrics") or {"winRate": ">=0.55"}).keys()))

        nodes: List[Dict[str, Any]] = [
            {
                "node_id": "n0",
                "parent_id": None,
                "agent": "ResearchAgent",
                "title": "Root Spec",
                "hypothesis": "The idea can be transformed into an executable MARL plan.",
                "execution_plan": "Normalize research specification and enforce constraints.",
                "expected_metrics": {metric: "baseline"},
                "budget": {"gpuHours": budget.get("gpuHours", 0), "wallclockMinutes": budget.get("wallclockMinutes", 60)},
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
                "title": "Hypothesis Proposal",
                "hypothesis": "MAPPO + tuned rollout length can improve target metric with bounded cost.",
                "execution_plan": "Generate baseline and challenger hypotheses with expected lift.",
                "expected_metrics": {metric: "improve"},
                "budget": {"gpuHours": 0.7, "wallclockMinutes": 25},
                "risk": "medium",
                "status": "PENDING",
                "rationale": "Research lane creates candidate algorithm family and controls.",
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
                "hypothesis": "Selected configuration can produce reproducible baseline metrics.",
                "execution_plan": f"Run execution adapter ({execution_mode}) and generate checkpoints/metrics artifacts.",
                "expected_metrics": {metric: spec.get("successMetrics", {}).get(metric)},
                "budget": {"gpuHours": 1.8, "wallclockMinutes": 50},
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

    def _state_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / "state.json"

    def _load_state(self, run_id: str) -> Dict[str, Any]:
        state_path = self._state_path(run_id)
        if not state_path.exists():
            raise FileNotFoundError("agentic_run_not_found")
        return json.loads(state_path.read_text(encoding="utf-8"))

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

        for idx in range(3):
            ckpt_payload = {
                "checkpointId": f"ckpt_{idx}",
                "step": (idx + 1) * 1000,
                "winRate": round(0.45 + idx * 0.07, 4),
                "createdAt": _now_iso(),
            }
            (run_dir / "artifacts" / "ckpt" / f"ckpt_{idx}.json").write_text(
                json.dumps(ckpt_payload, indent=2),
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
            "llm_provider=stub",
        ]
        (run_dir / "manifest" / "dependency_summary.txt").write_text("\n".join(dependency_summary) + "\n", encoding="utf-8")

        default_repro = run_dir / "repro_bundle" / "reproduce.sh"
        default_repro.write_text("#!/usr/bin/env bash\necho 'Run export_repro_bundle to generate full bundle.'\n", encoding="utf-8")
        try:
            os.chmod(default_repro, 0o755)
        except OSError:
            pass

    def _execute_node(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        run_id = str(state.get("run_id"))
        node_id = str(node.get("node_id"))
        agent = str(node.get("agent") or "Agent")
        title = str(node.get("title") or node_id)
        node["status"] = "RUNNING"

        self._append_event(
            state,
            event="node_started",
            message=f"{node_id} started",
            payload={"node_id": node_id, "agent": agent, "title": title},
        )

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
            self._append_log(state, f"[{node_id}] FAILED {failure['reason']}")

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

        self._append_event(
            state,
            event="node_succeeded",
            message=f"{node_id} succeeded",
            payload={"node_id": node_id, "agent": agent},
        )

    def _run_research_lane(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        plans = self._runtime_lane_plans(state, lane="research")
        sub_agents = self._spawn_sub_agents(state, node, plans=plans, depth=1)
        metric_key = next(iter((state.get("research_spec", {}).get("successMetrics") or {"winRate": ">=0.55"}).keys()))
        node["status"] = "SUCCEEDED"
        node["sub_agents"] = sub_agents
        node["evidence"] = {
            "candidateAlgorithms": ["mappo", "qmix"],
            "selected": "mappo",
            "expectedLift": {metric_key: 0.05},
            "retrieval": self.retrieve_context(f"research hypothesis {state.get('research_spec', {}).get('taskGoal')}", k=3),
            "subAgents": sub_agents,
        }
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

        plans = self._runtime_lane_plans(state, lane="integration_base")
        if not retry:
            plans.extend(self._runtime_lane_plans(state, lane="integration_fresh_only"))
        sub_agents = self._spawn_sub_agents(state, node, plans=plans, depth=1)
        adapter_mode = self._execution_adapter_mode(state)
        node["status"] = "SUCCEEDED"
        node["sub_agents"] = sub_agents
        node["evidence"] = {
            "adapterMode": adapter_mode,
            "runnerContract": "train(config, metrics_path, checkpoint_dir, run_id)",
            "retrieval": self.retrieve_context("adapter generation runner contract", k=3),
            "retry": retry,
            "subAgents": sub_agents,
        }
        node["next_suggestions"] = ["Proceed to execution node", "Record adapter provenance"]
        self._append_timeline(state, node, "integration_completed", cost=0.6)
        self._append_log(state, f"[{node['node_id']}] Integration lane completed (retry={retry})")

    def _run_ops_lane(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        if str(node.get("title") or "").strip().lower().startswith("execute candidate run"):
            self._run_execution_lane(state, node)
            return

        plans = self._runtime_lane_plans(state, lane="ops_budget_guard")
        sub_agents = self._spawn_sub_agents(state, node, plans=plans, depth=1) if plans else []
        node["status"] = "SUCCEEDED"
        node["sub_agents"] = sub_agents
        node["evidence"] = {
            "budgetUsed": {
                "gpuHours": min(1.5, float(state.get("research_spec", {}).get("budget", {}).get("gpuHours") or 0)),
                "wallclockMinutes": min(45, int(state.get("research_spec", {}).get("budget", {}).get("wallclockMinutes") or 60)),
            },
            "fallback": "offline_stub",
            "resourceHints": ["limit totalEnvSteps on low budget", "prefer local executor"],
            "subAgents": sub_agents,
        }
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
                node["evidence"] = {
                    "execution": {"mode": adapter_mode, "status": "blocked"},
                    "blockedActions": ["unknown_script_execution"] if gate.get("blockedByPolicy") else [],
                    "requiredApprovals": ["unknown_script_execution"],
                    "actionPolicy": gate,
                }
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
                "status": "SUCCEEDED",
                "simulated": True,
                "metrics": synthetic,
                "commandHash": None,
                "generatedAt": _now_iso(),
            }
            runtime_path.parent.mkdir(parents=True, exist_ok=True)
            _atomic_write_text(runtime_path, json.dumps(runtime_report, indent=2, ensure_ascii=False), encoding="utf-8")
            outcome = {
                "mode": adapter_mode,
                "runtime": runtime_report,
                "newCheckpoint": self._emit_runtime_checkpoint(run_dir, state, source="offline_stub"),
            }

        node["status"] = "SUCCEEDED"
        node["evidence"] = {
            "execution": outcome,
            "adapterMode": adapter_mode,
            "approvedActions": sorted(approved),
            "runtimeArtifact": "artifacts/runtime_execution.json",
        }
        node["next_suggestions"] = ["Generate matrix league", "Export reproducibility bundle"]
        self._append_timeline(state, node, "execution_completed", cost=0.9)
        self._append_log(state, f"[{node['node_id']}] Execution lane completed mode={adapter_mode}")

    def _run_eval_lane(self, state: Dict[str, Any], node: Dict[str, Any]) -> None:
        protocol = state.get("eval_protocol_draft") or {}
        plans = self._runtime_lane_plans(state, lane="eval")
        sub_agents = self._spawn_sub_agents(state, node, plans=plans, depth=1)
        node["status"] = "SUCCEEDED"
        node["sub_agents"] = sub_agents
        node["evidence"] = {
            "protocol": protocol,
            "matrixPlan": protocol.get("matrixPlan", {}),
            "retrieval": self.retrieve_context("evaluation protocol matrix confidence", k=3),
            "subAgents": sub_agents,
        }
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

            node["evidence"] = {
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
            self._append_timeline(state, node, "safety_blocked", cost=0.1)
            self._append_log(state, f"[{node['node_id']}] Safety blocked actions: {pending_actions}")
            return

        node["status"] = "SUCCEEDED"
        node["evidence"] = {
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
            node["evidence"] = {
                **(node.get("evidence") or {}),
                "blockedActions": [action] if decision["blockedByPolicy"] else [],
                "requiredApprovals": [action],
                "actionPolicy": decision,
            }
            self._append_timeline(state, node, "repair_blocked", cost=0.05)
            self._append_log(state, f"[{node['node_id']}] Repair blocked for action {action}")
            return

        node["status"] = "SUCCEEDED"
        sub_agents = self._spawn_sub_agents(state, node, plans=self._runtime_lane_plans(state, lane="repair"), depth=1)
        node["sub_agents"] = sub_agents
        node["evidence"] = {
            **(node.get("evidence") or {}),
            "applied": True,
            "appliedAt": _now_iso(),
            "subAgents": sub_agents,
        }
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

    def _emit_runtime_checkpoint(self, run_dir: Path, state: Dict[str, Any], source: str) -> Dict[str, Any]:
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

    def _runtime_lane_plans(self, state: Dict[str, Any], lane: str) -> List[Dict[str, str]]:
        rules = self._load_runtime_rules()
        lane_rows = ((rules.get("lanes") or {}).get(lane) or [])
        if not isinstance(lane_rows, list):
            return []
        plans: List[Dict[str, str]] = []
        for row in lane_rows:
            if not isinstance(row, dict):
                continue
            condition = str(row.get("when") or "always")
            if not self._lane_condition_matches(state, condition):
                continue
            role = str(row.get("role") or "").strip()
            objective = str(row.get("objective") or "").strip()
            if not role or not objective:
                continue
            plans.append({"role": role, "objective": objective})
        return plans

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

    def _execute_sub_agent_logic(
        self,
        state: Dict[str, Any],
        node: Dict[str, Any],
        sub_agent: Dict[str, Any],
        plan: Dict[str, str],
    ) -> Dict[str, Any]:
        role = str(plan.get("role") or "GenericSubAgent")
        context = self._sub_agent_strategy_context(state, node, sub_agent, plan)
        strategy = self._sub_agent_strategy(role)
        if isinstance(strategy, dict) and strategy:
            template = strategy.get("template")
            if isinstance(template, dict):
                rendered = self._render_sub_agent_template(template, context)
                evidence = rendered if isinstance(rendered, dict) else {"result": rendered}
            else:
                evidence = {}
            if "estimatedLatencyMs" not in evidence:
                evidence["estimatedLatencyMs"] = self._resolve_strategy_int(
                    strategy.get("estimatedLatencyMs"),
                    context,
                    fallback=120,
                )
            spawn_rows = strategy.get("spawnPlans")
            if isinstance(spawn_rows, list) and self._sub_agent_strategy_allows_spawn(strategy, context):
                evidence["__spawn_plans__"] = [row for row in spawn_rows if isinstance(row, dict)]
            evidence.setdefault("strategySource", "runtime_rules")
            evidence.setdefault("strategyRole", role)
            return evidence

        spec = state.get("research_spec") or {}
        env = spec.get("environment") or {}
        data_sources = list(env.get("dataSources") or [])
        metrics = list((spec.get("successMetrics") or {}).keys())

        if role == "DataScoutSubAgent":
            evidence: Dict[str, Any] = {
                "sourceCount": len(data_sources),
                "sources": data_sources,
                "riskFlag": "multi_source" if len(data_sources) > 1 else "single_source",
                "estimatedLatencyMs": 240,
            }
            max_depth = int(self._sub_agent_policy(state).get("maxDepth") or self.MAX_SUB_AGENT_DEPTH)
            if len(data_sources) > 1 and int(sub_agent.get("depth") or 1) < max_depth:
                evidence["__spawn_plans__"] = [
                    {
                        "role": "SchemaProbeSubAgent",
                        "objective": "Probe schema compatibility across multiple data sources.",
                    }
                ]
            return evidence

        if role == "SchemaProbeSubAgent":
            return {
                "compatibility": "compatible",
                "checkedFields": ["obs", "action", "reward", "done"],
                "estimatedLatencyMs": 180,
            }

        if role == "HypothesisCriticSubAgent":
            return {
                "weakAssumptions": ["reward shaping sensitivity"],
                "recommendedControl": "preserve baseline branch",
                "metricCoverage": metrics,
                "estimatedLatencyMs": 210,
            }

        if role == "ContractProbeSubAgent":
            return {
                "runnerContract": "train(config, metrics_path, checkpoint_dir, run_id)",
                "contractCompatible": True,
                "estimatedLatencyMs": 220,
            }

        if role == "DependencyProbeSubAgent":
            allow_install = bool((spec.get("constraints") or {}).get("allowDependencyInstall"))
            return {
                "dependencyInstallAllowed": allow_install,
                "recommendedFallback": "offline_stub" if not allow_install else "runtime_install",
                "estimatedLatencyMs": 260,
            }

        if role == "BudgetGuardSubAgent":
            budget = spec.get("budget") or {}
            gpu_hours = float(budget.get("gpuHours") or 0)
            wallclock = int(budget.get("wallclockMinutes") or 0)
            return {
                "gpuHours": gpu_hours,
                "wallclockMinutes": wallclock,
                "budgetRisk": "high" if gpu_hours > 4 or wallclock > 240 else "moderate",
                "estimatedLatencyMs": 180,
            }

        if role == "ConfidenceCheckSubAgent":
            protocol = state.get("eval_protocol_draft") or {}
            return {
                "confidenceLevel": protocol.get("confidenceLevel"),
                "gamesPerPair": protocol.get("gamesPerPair"),
                "matrixMode": (protocol.get("matrixPlan") or {}).get("mode"),
                "estimatedLatencyMs": 170,
            }

        if role == "RootCauseSubAgent":
            failure_history = list(state.get("failure_history") or [])
            latest_reason = ""
            if failure_history:
                latest_reason = str((failure_history[-1] or {}).get("reason") or "")
            return {
                "latestFailureReason": latest_reason,
                "repairValidated": True,
                "estimatedLatencyMs": 200,
            }

        return {
            "note": f"{role} executed with default stub logic.",
            "objective": str(plan.get("objective") or ""),
            "estimatedLatencyMs": 120,
        }

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
