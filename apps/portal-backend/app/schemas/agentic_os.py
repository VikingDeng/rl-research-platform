from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import Field

from app.schemas.base import APIModel


class AgenticBudget(APIModel):
    gpu_hours: float = 0.0
    wallclock_minutes: int = 60


class AgenticConstraints(APIModel):
    compliance: List[str] = Field(default_factory=list)
    forbidden_actions: List[str] = Field(default_factory=list)
    allow_network: bool = False
    allow_dependency_install: bool = False


class AgenticGitContext(APIModel):
    repo: Optional[str] = None
    branch: Optional[str] = None
    commit: Optional[str] = None


class AgenticSubAgentPolicy(APIModel):
    enabled: bool = True
    max_depth: int = 2
    max_per_node: int = 3
    max_total: int = 24
    timeout_ms: int = 1500


class AgenticApprovalPolicy(APIModel):
    mode: str = "balanced"  # strict | balanced | permissive
    high_risk_actions: List[str] = Field(default_factory=list)
    blocked_action_roles: List[str] = Field(default_factory=list)
    high_risk_action_roles: List[str] = Field(default_factory=list)
    require_approval_for_unknown_actions: Optional[bool] = None
    min_approvals: int = 1
    require_distinct_roles: bool = False
    approval_ttl_minutes: int = 120


class AgenticIdeaInput(APIModel):
    title: str
    task_goal: str
    environment: str
    data_sources: List[str] = Field(default_factory=list)
    success_metrics: Dict[str, Any] = Field(default_factory=dict)
    budget: AgenticBudget
    constraints: AgenticConstraints = Field(default_factory=AgenticConstraints)
    execution_mode: str = "offline_stub"  # offline_stub | local_shell | mle_runner
    local_command: Optional[str] = None
    git: Optional[AgenticGitContext] = None
    requested_actions: List[str] = Field(default_factory=list)
    sub_agent_policy: AgenticSubAgentPolicy = Field(default_factory=AgenticSubAgentPolicy)
    approval_policy: AgenticApprovalPolicy = Field(default_factory=AgenticApprovalPolicy)


class AgenticNode(APIModel):
    node_id: str
    parent_id: Optional[str] = None
    agent: str
    title: str
    hypothesis: str
    execution_plan: str
    expected_metrics: Dict[str, Any] = Field(default_factory=dict)
    budget: Dict[str, Any] = Field(default_factory=dict)
    risk: str = "low"
    status: str = "PENDING"
    rationale: Optional[str] = None
    evidence: Dict[str, Any] = Field(default_factory=dict)
    sub_agents: List[Dict[str, Any]] = Field(default_factory=list)
    next_suggestions: List[str] = Field(default_factory=list)
    children: List[str] = Field(default_factory=list)


class AgenticNodeRunRecord(APIModel):
    node_run_id: str
    run_id: str
    node_id: str
    parent_node_id: Optional[str] = None
    parent_node_run_id: Optional[str] = None
    agent: str
    title: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    patch_plan: List[Dict[str, Any]] = Field(default_factory=list)
    metrics: Dict[str, Any] = Field(default_factory=dict)
    artifact_paths: List[str] = Field(default_factory=list)
    replay_ref: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


class AgenticLlmTraceRecord(APIModel):
    ts: datetime
    task: str
    status: str
    model: str
    attempt: int
    latency_ms: int = 0
    node_id: Optional[str] = None
    role: Optional[str] = None
    prompt_hash: str = ""
    response_hash: Optional[str] = None
    schema_valid: bool = False
    error: Optional[str] = None


class AgenticContractReport(APIModel):
    total_required: int
    present: int
    pass_rate: float
    missing: List[str] = Field(default_factory=list)


class AgenticRunCreateRequest(APIModel):
    idea: AgenticIdeaInput
    auto_execute: bool = False
    induce_failure: bool = False


class AgenticExecuteRequest(APIModel):
    mode: str = "all"  # all | next
    idempotency_key: Optional[str] = None


class AgenticApproveRequest(APIModel):
    approval_ids: List[str] = Field(default_factory=list)
    decision: str = "approve"  # approve | reject
    actor_id: Optional[str] = None
    actor_role: Optional[str] = None
    idempotency_key: Optional[str] = None
    comment: Optional[str] = None


class AgenticBranchRequest(APIModel):
    title: str
    hypothesis: str
    execution_plan: str
    expected_metrics: Dict[str, Any] = Field(default_factory=dict)
    budget: Dict[str, Any] = Field(default_factory=dict)
    risk: str = "medium"


class AgenticMatrixRequest(APIModel):
    checkpoint_ids: List[str] = Field(default_factory=list)
    max_size: int = 12
    downsample: bool = True


class AgenticSpecValidationResponse(APIModel):
    valid: bool
    normalized_spec: Dict[str, Any]
    root_config_draft: Dict[str, Any]
    eval_protocol_draft: Dict[str, Any]
    risk_statement: str
    retrieval_context: List[Dict[str, Any]] = Field(default_factory=list)


class AgenticApprovalPolicyTemplate(APIModel):
    template_id: str
    label: str
    description: str
    rationale: str = ""
    policy: Dict[str, Any] = Field(default_factory=dict)
    recommended: bool = False


class AgenticApprovalPolicyTemplateListResponse(APIModel):
    recommended_template_id: Optional[str] = None
    context_summary: Dict[str, Any] = Field(default_factory=dict)
    items: List[AgenticApprovalPolicyTemplate] = Field(default_factory=list)


class AgenticRunSummary(APIModel):
    run_id: str
    title: str
    objective: str
    status: str
    created_at: datetime
    updated_at: datetime
    contract_pass_rate: float
    failure_reason: Optional[str] = None


class AgenticSearchStats(APIModel):
    total_nodes: int = 0
    root_nodes: int = 0
    max_depth: int = 0
    expanded_nodes: int = 0
    visited_nodes: int = 0
    pending_nodes: int = 0
    avg_branching_factor: float = 0.0
    avg_frontier_score: float = 0.0
    avg_value: float = 0.0
    total_visits: int = 0
    selection_events: int = 0
    expansion_events: int = 0
    exploration_coverage: float = 0.0


class AgenticRunDetail(APIModel):
    run_id: str
    status: str
    created_at: datetime
    updated_at: datetime
    idea: Dict[str, Any]
    research_spec: Dict[str, Any]
    root_config_draft: Dict[str, Any]
    eval_protocol_draft: Dict[str, Any]
    risk_statement: str
    tot_tree: List[AgenticNode] = Field(default_factory=list)
    timeline: List[Dict[str, Any]] = Field(default_factory=list)
    events: List[Dict[str, Any]] = Field(default_factory=list)
    pending_approvals: List[Dict[str, Any]] = Field(default_factory=list)
    node_runs: List[AgenticNodeRunRecord] = Field(default_factory=list)
    llm_traces: List[AgenticLlmTraceRecord] = Field(default_factory=list)
    contract: AgenticContractReport
    search_stats: AgenticSearchStats = Field(default_factory=AgenticSearchStats)
    matrix: Optional[Dict[str, Any]] = None
    registry_record: Dict[str, Any] = Field(default_factory=dict)
    repro_bundle: Optional[Dict[str, Any]] = None


class AgenticRunCreateResponse(APIModel):
    run_id: str
    status: str
    detail: AgenticRunDetail


class AgenticListResponse(APIModel):
    page: int
    page_size: int
    total: int
    items: List[AgenticRunSummary]


class AgenticActionResponse(APIModel):
    ok: bool
    message: str
    detail: AgenticRunDetail


class AgenticMatrixResponse(APIModel):
    run_id: str
    matrix: Dict[str, Any]


class AgenticReproResponse(APIModel):
    run_id: str
    bundle_path: str
    manifest: Dict[str, Any]


class AgenticSubAgentRecord(APIModel):
    sub_agent_id: str
    parent_node_id: str
    parent_sub_agent_id: Optional[str] = None
    owner_agent: str
    role: str
    objective: str
    depth: int
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    evidence: Dict[str, Any] = Field(default_factory=dict)
    children: List[str] = Field(default_factory=list)


class AgenticSubAgentListResponse(APIModel):
    run_id: str
    page: int
    page_size: int
    total: int
    items: List[AgenticSubAgentRecord] = Field(default_factory=list)


class AgenticAuditReplayResponse(APIModel):
    run_id: str
    verified: bool
    checked_events: int
    chain_head: Optional[str] = None
    failure_reason: Optional[str] = None
    replay: Dict[str, Any] = Field(default_factory=dict)


class AgenticApproverRecord(APIModel):
    actor_id: str
    roles: List[str] = Field(default_factory=list)
    scopes: List[str] = Field(default_factory=list)
    action_allowlist: List[str] = Field(default_factory=list)
    action_denylist: List[str] = Field(default_factory=list)
    active: bool = True
    note: Optional[str] = None


class AgenticApproverListResponse(APIModel):
    strict_mode: bool = True
    total: int = 0
    items: List[AgenticApproverRecord] = Field(default_factory=list)


class AgenticRunReportResponse(APIModel):
    run_id: str
    generated_at: str
    report: Dict[str, Any] = Field(default_factory=dict)
    markdown: str = ""
    artifact_json_path: str
    artifact_markdown_path: str
