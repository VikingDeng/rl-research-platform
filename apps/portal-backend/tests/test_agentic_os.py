import json
import os
from pathlib import Path
import zipfile
import copy


def _idea_payload(**overrides):
    payload = {
        "title": "Agentic MARL Budgeted Win-Rate Lift",
        "taskGoal": "Increase win rate in SMAC map under bounded budget.",
        "environment": "pettingzoo.smac_v2:3s5z",
        "dataSources": ["registry://baseline_runs"],
        "successMetrics": {"winRate": ">=0.6", "eloLift": ">=25"},
        "budget": {"gpuHours": 2, "wallclockMinutes": 90},
        "constraints": {
            "compliance": ["no_pii"],
            "forbiddenActions": [],
            "allowNetwork": False,
            "allowDependencyInstall": False,
        },
        "requestedActions": [],
    }
    payload.update(overrides)
    return payload


def _create_run(client, *, induce_failure: bool = False, auto_execute: bool = False, idea_overrides=None):
    payload = {
        "idea": _idea_payload(**(idea_overrides or {})),
        "induceFailure": induce_failure,
        "autoExecute": auto_execute,
    }
    res = client.post("/api/v1/agentic/runs", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return body["runId"], body


def _max_depth(nodes):
    by_id = {item["nodeId"]: item for item in nodes}
    best = 0
    for node in nodes:
        depth = 0
        cursor = node
        seen = set()
        while cursor.get("parentId"):
            parent_id = cursor.get("parentId")
            if not parent_id or parent_id in seen:
                break
            seen.add(parent_id)
            parent = by_id.get(parent_id)
            if not parent:
                break
            depth += 1
            cursor = parent
        best = max(best, depth)
    return best


def test_f1_spec_validation_and_drafts(client):
    idea = _idea_payload()
    res = client.post("/api/v1/agentic/specs/validate", json=idea)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["valid"] is True
    assert body["normalizedSpec"]["taskGoal"] == idea["taskGoal"]
    assert "approvalPolicy" in body["normalizedSpec"]
    assert "approvalPolicy" in body["rootConfigDraft"].get("safety", {})
    assert "rootConfigDraft" in body
    assert "evalProtocolDraft" in body
    assert "riskStatement" in body


def test_f1_rule_driven_generation_profile_offline_safe(client):
    idea = _idea_payload()
    res = client.post("/api/v1/agentic/specs/validate", json=idea)
    assert res.status_code == 200, res.text
    body = res.json()

    root = body.get("rootConfigDraft") or {}
    eval_protocol = body.get("evalProtocolDraft") or {}
    generation = root.get("generation") or {}

    assert generation.get("profileId") == "offline_safe"
    assert str(generation.get("rulesVersion") or "").startswith("1.")
    assert int((root.get("train") or {}).get("rolloutLen") or 0) == 128
    assert (eval_protocol.get("generation") or {}).get("profileId") == "offline_safe"
    assert "Generation profile: offline_safe" in str(body.get("riskStatement") or "")


def test_f1_rule_driven_generation_profile_high_budget_search(client):
    idea = _idea_payload(
        budget={"gpuHours": 6, "wallclockMinutes": 240},
        constraints={
            "compliance": ["no_pii"],
            "forbiddenActions": [],
            "allowNetwork": False,
            "allowDependencyInstall": True,
        },
        successMetrics={"winRate": ">=0.6", "eloLift": ">=25"},
    )
    res = client.post("/api/v1/agentic/specs/validate", json=idea)
    assert res.status_code == 200, res.text
    body = res.json()

    root = body.get("rootConfigDraft") or {}
    eval_protocol = body.get("evalProtocolDraft") or {}
    generation = root.get("generation") or {}

    assert generation.get("profileId") == "high_budget_search"
    assert int((root.get("train") or {}).get("rolloutLen") or 0) == 256
    assert int((root.get("resources") or {}).get("gpus") or 0) == 1
    assert int(((eval_protocol.get("matrixPlan") or {}).get("k") or 0)) == 6
    assert "Generation profile: high_budget_search" in str(body.get("riskStatement") or "")


def test_nfr_approval_policy_templates_api(client):
    res = client.get("/api/v1/agentic/approval-policy/templates")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("recommendedTemplateId") == "balanced"
    assert isinstance(body.get("contextSummary"), dict)
    context = body.get("contextSummary") or {}
    assert str(context.get("policyRulesVersion") or "").startswith("1.")
    assert len(str(context.get("policyRulesHash") or "")) == 64
    items = body.get("items") or []
    ids = {str(item.get("templateId")) for item in items}
    assert {"strict", "balanced", "permissive"}.issubset(ids)
    recommended = [item for item in items if item.get("recommended")]
    assert len(recommended) == 1
    assert str(recommended[0].get("templateId")) == "balanced"
    for item in items:
        policy = item.get("policy") or {}
        assert isinstance(item.get("rationale"), str)
        assert isinstance(item.get("recommended"), bool)
        assert "mode" in policy
        assert "highRiskActions" in policy
        assert "blockedActionRoles" in policy
        assert "highRiskActionRoles" in policy
        assert int(policy.get("minApprovals") or 1) >= 1


def test_nfr_approval_policy_template_suggest_context_based(client):
    idea = _idea_payload(
        constraints={
            "compliance": ["no_pii", "no_external_data_push"],
            "forbiddenActions": ["data_exfiltration"],
            "allowNetwork": True,
            "allowDependencyInstall": False,
        },
        requestedActions=["unknown_script_execution", "data_exfiltration", "custom_action_x"],
    )
    res = client.post("/api/v1/agentic/approval-policy/templates/suggest", json=idea)
    assert res.status_code == 200, res.text
    body = res.json()

    assert body.get("recommendedTemplateId") == "strict"
    context = body.get("contextSummary") or {}
    assert int(context.get("riskScore") or 0) >= 8
    assert "custom_action_x" in (context.get("unknownActions") or [])
    assert "data_exfiltration" in (context.get("blockedRequestedActions") or [])

    rows = {str(item.get("templateId")): item for item in (body.get("items") or [])}
    strict_item = rows["strict"]
    assert strict_item.get("recommended") is True
    assert isinstance(strict_item.get("rationale"), str) and strict_item.get("rationale")

    strict_policy = strict_item.get("policy") or {}
    assert "custom_action_x" in (strict_policy.get("highRiskActions") or [])
    assert strict_policy.get("mode") == "strict"
    assert len(str((body.get("contextSummary") or {}).get("policyRulesHash") or "")) == 64


def test_nfr_approval_policy_snapshot_in_spec_registry_and_report(client):
    run_id, _ = _create_run(client)
    detail_res = client.get(f"/api/v1/agentic/runs/{run_id}")
    assert detail_res.status_code == 200, detail_res.text
    detail = detail_res.json()

    spec = detail.get("researchSpec") or {}
    meta = spec.get("approvalPolicyMeta") or {}
    assert str(meta.get("rulesVersion") or "").startswith("1.")
    assert len(str(meta.get("rulesHash") or "")) == 64
    assert len(str(meta.get("policyHash") or "")) == 64
    assert str(meta.get("mode") or "") in {"strict", "balanced", "permissive"}
    assert isinstance(meta.get("matchedTemplates"), list)

    registry = detail.get("registryRecord") or {}
    registry_meta = registry.get("approvalPolicyMeta") or registry.get("approval_policy_meta") or {}
    assert str(registry_meta.get("policyHash") or "") == str(meta.get("policyHash") or "")

    report_res = client.get(f"/api/v1/agentic/runs/{run_id}/report")
    assert report_res.status_code == 200, report_res.text
    report = (report_res.json() or {}).get("report") or {}
    report_meta = report.get("approvalPolicyMeta") or {}
    assert str(report_meta.get("policyHash") or "") == str(meta.get("policyHash") or "")


def test_nfr_approver_registry_endpoint(client):
    res = client.get("/api/v1/agentic/approvers")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("strictMode") is True
    assert int(body.get("total") or 0) >= 1
    items = body.get("items") or []
    assert any(str(item.get("actorId")) == "ui:local_admin" for item in items)
    assert any("admin" in (item.get("roles") or []) for item in items)
    assert all(isinstance(item.get("actionAllowlist"), list) for item in items)


def test_f2_tot_tree_and_node_evidence(client):
    run_id, _ = _create_run(client)
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    detail_res = client.get(f"/api/v1/agentic/runs/{run_id}")
    assert detail_res.status_code == 200
    detail = detail_res.json()

    agents = {node["agent"] for node in detail["totTree"]}
    assert {"ResearchAgent", "IntegrationAgent", "OpsAgent", "EvalAgent", "SafetyAgent"}.issubset(agents)
    assert len(detail["events"]) >= 5
    assert detail["contract"]["passRate"] >= 95


def test_f2_search_expansion_generates_multilevel_tot(client):
    run_id, _ = _create_run(client)

    # Simulate iterative ToT search steps instead of one-shot all-mode execution.
    for _ in range(9):
        exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "next"})
        assert exec_res.status_code == 200, exec_res.text

    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    tot = detail["totTree"]
    assert len(tot) > 7
    assert _max_depth(tot) >= 2
    assert any(evt["event"] == "search_node_selected" for evt in detail["events"])
    assert any(evt["event"] == "tot_node_expanded" for evt in detail["events"])
    search_stats = detail.get("searchStats") or {}
    assert int(search_stats.get("maxDepth") or 0) >= 2
    assert int(search_stats.get("expandedNodes") or 0) >= 1
    assert int(search_stats.get("selectionEvents") or 0) >= 1
    assert float(search_stats.get("explorationCoverage") or 0.0) > 0


def test_f2_sub_agent_spawn_and_nested_chain(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "dataSources": ["registry://baseline_runs", "registry://historical_failures"],
            "successMetrics": {"winRate": ">=0.6", "eloLift": ">=25", "stability": ">=0.9"},
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    research_nodes = [node for node in detail["totTree"] if node["agent"] == "ResearchAgent" and node["nodeId"] != "n0"]
    assert research_nodes
    assert any(node.get("subAgents") for node in research_nodes)

    events = detail["events"]
    assert any(evt["event"] == "sub_agent_started" for evt in events)
    assert any(evt["event"] == "sub_agent_succeeded" for evt in events)
    assert any((evt.get("payload") or {}).get("parent_sub_agent_id") for evt in events if evt["event"] == "sub_agent_started")

    replay_res = client.get(f"/api/v1/agentic/runs/{run_id}/audit-replay")
    assert replay_res.status_code == 200, replay_res.text
    replay = replay_res.json()
    assert int((replay.get("replay") or {}).get("subAgentsStarted") or 0) >= 1


def test_f2_sub_agent_policy_caps_and_timeout(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "dataSources": ["registry://baseline_runs", "registry://extra_a", "registry://extra_b"],
            "subAgentPolicy": {
                "enabled": True,
                "maxDepth": 1,
                "maxPerNode": 1,
                "maxTotal": 2,
                "timeoutMs": 100,
            },
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    sub_agents = [
        sa
        for node in detail["totTree"]
        for sa in (node.get("subAgents") or [])
    ]
    assert len(sub_agents) <= 2
    assert any(str(sa.get("status")) == "FAILED" for sa in sub_agents)
    assert any(evt["event"] == "sub_agent_skipped" for evt in detail["events"])


def test_f2_sub_agent_policy_disabled(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "dataSources": ["registry://baseline_runs", "registry://historical_failures"],
            "subAgentPolicy": {
                "enabled": False,
                "maxDepth": 2,
                "maxPerNode": 3,
                "maxTotal": 24,
                "timeoutMs": 1500,
            },
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    sub_agents = [
        sa
        for node in detail["totTree"]
        for sa in (node.get("subAgents") or [])
    ]
    assert len(sub_agents) == 0
    assert any(
        evt["event"] == "sub_agent_skipped" and str((evt.get("payload") or {}).get("reason") or "") == "policy_disabled"
        for evt in detail["events"]
    )

    list_res = client.get(f"/api/v1/agentic/runs/{run_id}/sub-agents")
    assert list_res.status_code == 200, list_res.text
    assert list_res.json()["total"] == 0


def test_f2_sub_agent_list_api(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "dataSources": ["registry://baseline_runs", "registry://historical_failures"],
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    list_res = client.get(f"/api/v1/agentic/runs/{run_id}/sub-agents?page=1&page_size=2")
    assert list_res.status_code == 200, list_res.text
    payload = list_res.json()
    assert payload["runId"] == run_id
    assert payload["page"] == 1
    assert payload["pageSize"] == 2
    assert payload["total"] >= 1
    assert len(payload["items"]) <= 2

    status_filtered = client.get(f"/api/v1/agentic/runs/{run_id}/sub-agents?status=SUCCEEDED")
    assert status_filtered.status_code == 200, status_filtered.text
    filtered_items = status_filtered.json()["items"]
    assert all(str(item["status"]).upper() == "SUCCEEDED" for item in filtered_items)


def test_f2_sub_agent_runtime_strategy_override(client, monkeypatch):
    import app.api.routes as routes_module

    service = routes_module.agentic_os_service
    custom_rules = copy.deepcopy(service._default_runtime_rules())
    custom_rules["roleStrategies"]["HypothesisCriticSubAgent"] = {
        "template": {
            "strategyTag": "custom_rule_strategy",
            "metricCoverage": "$metricKeys",
            "estimatedLatencyMs": 95,
        }
    }
    monkeypatch.setattr(service, "_load_runtime_rules", lambda: custom_rules)

    run_id, _ = _create_run(
        client,
        idea_overrides={
            "successMetrics": {"winRate": ">=0.6", "eloLift": ">=25"},
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    sub_agents = [
        sa
        for node in detail["totTree"]
        for sa in (node.get("subAgents") or [])
    ]
    critic = next((item for item in sub_agents if str(item.get("role")) == "HypothesisCriticSubAgent"), None)
    assert critic is not None
    evidence = critic.get("evidence") or {}
    assert evidence.get("strategyTag") == "custom_rule_strategy"
    assert evidence.get("strategySource") == "runtime_rules"
    assert isinstance(evidence.get("metricCoverage"), list)


def test_f3_failure_recovery_loop(client):
    run_id, _ = _create_run(client, induce_failure=True)
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    detail_res = client.get(f"/api/v1/agentic/runs/{run_id}")
    detail = detail_res.json()
    statuses = {node["status"] for node in detail["totTree"]}
    assert detail["status"] in {"SUCCEEDED", "RUNNING", "BLOCKED"}
    assert "FAILED" in statuses or any("Repair Branch" in node["title"] for node in detail["totTree"])

    if detail["status"] == "BLOCKED":
        approvals = [item["id"] for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
        if approvals:
            app_res = client.post(
                f"/api/v1/agentic/runs/{run_id}/approvals",
                json={"approvalIds": approvals, "decision": "approve", "actorId": "test_admin", "actorRole": "admin"},
            )
            assert app_res.status_code == 200, app_res.text
            exec_res2 = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
            assert exec_res2.status_code == 200, exec_res2.text

    final_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert any("Repair Branch" in node["title"] for node in final_detail["totTree"])


def test_f4_registry_contract_and_repro_bundle(client):
    run_id, _ = _create_run(client, auto_execute=True)

    bundle_res = client.post(f"/api/v1/agentic/runs/{run_id}/repro-bundle")
    assert bundle_res.status_code == 200, bundle_res.text
    body = bundle_res.json()

    bundle_path = Path(body["bundlePath"])
    assert bundle_path.exists()

    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert detail["contract"]["passRate"] >= 95
    assert detail["registryRecord"].get("specHash")
    assert detail["registryRecord"].get("configHash")


def test_f4_run_report_endpoint_and_bundle_artifacts(client):
    run_id, _ = _create_run(client, auto_execute=True)

    report_res = client.get(f"/api/v1/agentic/runs/{run_id}/report")
    assert report_res.status_code == 200, report_res.text
    report_body = report_res.json()
    assert report_body["runId"] == run_id
    assert report_body["report"]["runId"] == run_id
    assert report_body["report"]["contractPassRate"] >= 95
    assert "## Repro & Replay" in report_body["markdown"]
    assert Path(report_body["artifactJsonPath"]).exists()
    assert Path(report_body["artifactMarkdownPath"]).exists()

    bundle_res = client.post(f"/api/v1/agentic/runs/{run_id}/repro-bundle")
    assert bundle_res.status_code == 200, bundle_res.text
    manifest = bundle_res.json()["manifest"]
    assert manifest.get("runReport") == "artifacts/run_report.json"
    assert manifest.get("runReportMarkdown") == "artifacts/run_report.md"

    bundle_path = Path(bundle_res.json()["bundlePath"])
    with zipfile.ZipFile(bundle_path, "r") as zf:
        names = set(zf.namelist())
    assert "artifacts/run_report.json" in names
    assert "artifacts/run_report.md" in names


def test_f5_matrix_elo_and_cell_evidence(client):
    run_id, _ = _create_run(client, auto_execute=True)

    matrix_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/matrix",
        json={"checkpointIds": ["ckpt_0", "ckpt_1", "ckpt_2"], "maxSize": 12, "downsample": True},
    )
    assert matrix_res.status_code == 200, matrix_res.text
    payload = matrix_res.json()["matrix"]

    labels = payload["labels"]
    matrix = payload["matrix"]
    cells = payload["cells"]
    ranking = payload["ranking"]

    assert len(labels) == 3
    assert len(matrix) == 3
    assert all(len(row) == 3 for row in matrix)
    assert len(cells) == 9
    assert ranking and all("score" in item for item in ranking)
    assert all("logUri" in cell and "replayUri" in cell and "confidence" in cell for cell in cells)


def test_nfr_high_risk_action_intercept_and_approval(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": ["unknown_script_execution"],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
        },
    )

    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert detail["status"] == "BLOCKED"
    pending = [item["id"] for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending

    approve_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": pending, "decision": "approve", "actorId": "test_admin", "actorRole": "admin"},
    )
    assert approve_res.status_code == 200

    exec_res2 = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res2.status_code == 200
    final_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert final_detail["status"] in {"RUNNING", "SUCCEEDED"}


def test_nfr_high_risk_non_forbidden_still_requires_approval(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": [],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
        },
    )

    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert detail["status"] == "BLOCKED"
    assert any(item["status"] == "PENDING" for item in detail["pendingApprovals"])


def test_nfr_pagination_and_matrix_downsample(client):
    run_ids = [_create_run(client)[0] for _ in range(3)]
    assert len(run_ids) == 3

    list_res_1 = client.get("/api/v1/agentic/runs?page=1&page_size=2")
    assert list_res_1.status_code == 200, list_res_1.text
    body_1 = list_res_1.json()
    assert body_1["page"] == 1
    assert body_1["pageSize"] == 2
    assert body_1["total"] >= 3
    assert len(body_1["items"]) == 2

    list_res_2 = client.get("/api/v1/agentic/runs?page=2&page_size=2")
    assert list_res_2.status_code == 200, list_res_2.text
    body_2 = list_res_2.json()
    assert body_2["page"] == 2
    assert body_2["total"] >= 3
    assert len(body_2["items"]) >= 1

    run_id = run_ids[0]
    checkpoint_ids = [f"ckpt_{idx:02d}" for idx in range(17)]
    matrix_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/matrix",
        json={"checkpointIds": checkpoint_ids, "maxSize": 5, "downsample": True},
    )
    assert matrix_res.status_code == 200, matrix_res.text
    matrix = matrix_res.json()["matrix"]
    assert len(matrix["labels"]) <= 5
    assert matrix["meta"]["downsampled"] is True
    assert matrix["meta"]["originalCount"] == 17


def test_nfr_failure_retrieval_and_audit_replay_artifacts(client):
    run_id, _ = _create_run(client, induce_failure=True)
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item["id"] for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    if pending:
        approve_res = client.post(
            f"/api/v1/agentic/runs/{run_id}/approvals",
            json={"approvalIds": pending, "decision": "approve", "actorId": "test_admin", "actorRole": "admin"},
        )
        assert approve_res.status_code == 200, approve_res.text
        exec_res2 = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
        assert exec_res2.status_code == 200, exec_res2.text

    bundle_res = client.post(f"/api/v1/agentic/runs/{run_id}/repro-bundle")
    assert bundle_res.status_code == 200, bundle_res.text
    body = bundle_res.json()
    manifest = body["manifest"]
    assert manifest.get("reportSummary") == "artifacts/report_summary.json"
    assert manifest.get("runReport") == "artifacts/run_report.json"
    assert manifest.get("runReportMarkdown") == "artifacts/run_report.md"

    bundle_path = Path(body["bundlePath"])
    assert bundle_path.exists()
    run_dir = bundle_path.parent.parent
    assert (run_dir / "manifest" / "decision_snapshot.json").exists()
    assert (run_dir / "timeline" / "events.jsonl").exists()
    assert (run_dir / "artifacts" / "report_summary.json").exists()
    assert (run_dir / "artifacts" / "run_report.json").exists()
    assert (run_dir / "artifacts" / "run_report.md").exists()

    failure_report = json.loads((run_dir / "artifacts" / "error_report.json").read_text(encoding="utf-8"))
    assert isinstance(failure_report.get("retrievalContext"), list)
    report_summary = json.loads((run_dir / "artifacts" / "report_summary.json").read_text(encoding="utf-8"))
    assert isinstance(report_summary.get("retrievalContext"), list)

    with zipfile.ZipFile(bundle_path, "r") as zf:
        names = set(zf.namelist())
    assert "artifacts/report_summary.json" in names
    assert "artifacts/run_report.json" in names
    assert "artifacts/run_report.md" in names


def test_nfr_audit_replay_verification_and_tamper_detection(client):
    run_id, _ = _create_run(client, auto_execute=True)

    replay_res = client.get(f"/api/v1/agentic/runs/{run_id}/audit-replay")
    assert replay_res.status_code == 200, replay_res.text
    replay = replay_res.json()
    assert replay["verified"] is True
    assert replay["checkedEvents"] >= 1
    assert replay["replay"]["replayedEvents"] >= 1

    bundle_res = client.post(f"/api/v1/agentic/runs/{run_id}/repro-bundle")
    assert bundle_res.status_code == 200, bundle_res.text
    bundle_path = Path(bundle_res.json()["bundlePath"])
    run_dir = bundle_path.parent.parent
    state_path = run_dir / "state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state.get("events")
    state["events"][0]["message"] = "tampered_event_message"
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    replay_res_tampered = client.get(f"/api/v1/agentic/runs/{run_id}/audit-replay")
    assert replay_res_tampered.status_code == 200, replay_res_tampered.text
    replay_tampered = replay_res_tampered.json()
    assert replay_tampered["verified"] is False
    assert replay_tampered["failureReason"] is not None


def test_nfr_approval_rbac_enforced(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii", "no_external_data_push"],
                "forbiddenActions": ["data_exfiltration"],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["data_exfiltration"],
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text

    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item["id"] for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending

    deny_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": pending, "decision": "approve", "actorId": "test_user", "actorRole": "ops"},
    )
    assert deny_res.status_code == 403

    pass_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": pending, "decision": "approve", "actorId": "security_user", "actorRole": "security"},
    )
    assert pass_res.status_code == 200, pass_res.text


def test_nfr_approval_actor_registry_enforced(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": [],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["custom_local_cleanup"],
            "approvalPolicy": {
                "mode": "strict",
                "requireApprovalForUnknownActions": True,
                "highRiskActionRoles": ["security"],
                "blockedActionRoles": ["security"],
            },
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item["id"] for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending

    unknown_actor = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": pending, "decision": "approve", "actorId": "unknown_admin", "actorRole": "admin"},
    )
    assert unknown_actor.status_code == 403

    role_mismatch = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": pending, "decision": "approve", "actorId": "security_user", "actorRole": "admin"},
    )
    assert role_mismatch.status_code == 403

    valid_actor = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": pending, "decision": "approve", "actorId": "security_user", "actorRole": "security"},
    )
    assert valid_actor.status_code == 200, valid_actor.text


def test_nfr_approval_actor_action_scope_enforced(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": [],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
            "approvalPolicy": {
                "mode": "balanced",
                "requireApprovalForUnknownActions": True,
                "highRiskActionRoles": ["admin", "ops", "security"],
                "blockedActionRoles": ["admin", "security"],
            },
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item["id"] for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending

    ops_denied = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": pending, "decision": "approve", "actorId": "ops_user", "actorRole": "ops"},
    )
    assert ops_denied.status_code == 403

    admin_allowed = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": pending, "decision": "approve", "actorId": "admin_user", "actorRole": "admin"},
    )
    assert admin_allowed.status_code == 200, admin_allowed.text


def test_nfr_approval_policy_unknown_action_permissive_mode(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": [],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["custom_local_cleanup"],
            "approvalPolicy": {
                "mode": "permissive",
                "requireApprovalForUnknownActions": False,
                "highRiskActionRoles": ["admin", "ops", "security"],
                "blockedActionRoles": ["admin"],
            },
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert detail["status"] in {"RUNNING", "SUCCEEDED"}
    assert not any(item["status"] == "PENDING" for item in detail["pendingApprovals"])


def test_nfr_approval_policy_unknown_action_strict_mode(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": [],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["custom_local_cleanup"],
            "approvalPolicy": {
                "mode": "strict",
                "requireApprovalForUnknownActions": True,
                "highRiskActionRoles": ["security"],
                "blockedActionRoles": ["security"],
            },
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert detail["status"] == "BLOCKED"
    pending = [item for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending
    assert all(str(item.get("reason")) == "unknown_action_requires_approval" for item in pending)
    assert all("security" in (item.get("requiredRoles") or item.get("required_roles") or []) for item in pending)

    deny_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in pending], "decision": "approve", "actorId": "test_admin", "actorRole": "admin"},
    )
    assert deny_res.status_code == 403

    pass_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in pending], "decision": "approve", "actorId": "security_user", "actorRole": "security"},
    )
    assert pass_res.status_code == 200, pass_res.text


def test_nfr_approval_reject_comment_recorded(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": ["unknown_script_execution"],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending

    reject_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={
            "approvalIds": [item["id"] for item in pending],
            "decision": "reject",
            "actorId": "security_user",
            "actorRole": "security",
            "comment": "blocked by manual review",
        },
    )
    assert reject_res.status_code == 200, reject_res.text
    updated = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    rejected = [item for item in updated["pendingApprovals"] if item["status"] == "REJECTED"]
    assert rejected
    assert all(str(item.get("decision_comment") or "") == "blocked by manual review" for item in rejected)
    approval_events = [evt for evt in updated["events"] if evt["event"] == "approval_updated"]
    assert approval_events
    assert str((approval_events[-1].get("payload") or {}).get("comment") or "") == "blocked by manual review"


def test_nfr_approval_quorum_two_distinct_actors(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": ["unknown_script_execution"],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
            "approvalPolicy": {
                "mode": "balanced",
                "requireApprovalForUnknownActions": True,
                "highRiskActionRoles": ["admin", "security"],
                "blockedActionRoles": ["admin", "security"],
                "minApprovals": 2,
            },
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending

    first_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={
            "approvalIds": [item["id"] for item in pending],
            "decision": "approve",
            "actorId": "admin_user",
            "actorRole": "admin",
        },
    )
    assert first_res.status_code == 200, first_res.text
    mid = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    mid_pending = [item for item in mid["pendingApprovals"] if item["status"] == "PENDING"]
    assert mid_pending
    assert all(int(item.get("requiredApprovals") or item.get("required_approvals") or 1) == 2 for item in mid_pending)
    assert all(int(item.get("approvalVotes") or item.get("approval_votes") or 0) == 1 for item in mid_pending)

    second_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={
            "approvalIds": [item["id"] for item in mid_pending],
            "decision": "approve",
            "actorId": "security_user",
            "actorRole": "security",
        },
    )
    assert second_res.status_code == 200, second_res.text
    final_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    approved = [item for item in final_detail["pendingApprovals"] if item["status"] == "APPROVED"]
    assert approved
    assert all(int(item.get("approvalVotes") or item.get("approval_votes") or 0) >= 2 for item in approved)


def test_nfr_execution_mode_local_shell_with_policy_gate(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": [],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "executionMode": "local_shell",
            "localCommand": "python -c \"print('agentic_local_shell_ok')\"",
            "requestedActions": [],
        },
    )

    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    blocked_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert blocked_detail["status"] == "BLOCKED"
    pending = [item for item in blocked_detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending
    assert any(str(item.get("action")) == "unknown_script_execution" for item in pending)

    approve_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={
            "approvalIds": [item["id"] for item in pending],
            "decision": "approve",
            "actorId": "admin_user",
            "actorRole": "admin",
        },
    )
    assert approve_res.status_code == 200, approve_res.text

    exec_res2 = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res2.status_code == 200, exec_res2.text
    final_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert final_detail["status"] == "SUCCEEDED"

    run_root = Path(os.environ["LOCAL_RUN_ROOT"]).expanduser()
    runtime_path = run_root.parent / "agentic_os" / "runs" / run_id / "artifacts" / "runtime_execution.json"
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    assert runtime.get("mode") == "local_shell"
    assert runtime.get("status") == "SUCCEEDED"
    assert int(runtime.get("returnCode") or 0) == 0

    exec_nodes = [node for node in final_detail["totTree"] if str(node.get("title")) == "Execute Candidate Run"]
    assert exec_nodes
    execution = (exec_nodes[0].get("evidence") or {}).get("execution") or {}
    assert str(execution.get("mode")) == "local_shell"


def test_nfr_execution_mode_mle_runner_dry_run(client, monkeypatch):
    import app.services.agentic_os as agentic_os_module

    class _Proc:
        returncode = 0
        stdout = "mle_runner_ok\n"
        stderr = ""

    def _fake_run(command, cwd=None, env=None, capture_output=True, text=True, timeout=0, check=False):
        assert isinstance(command, list)
        assert "-m" in command
        assert "toto.run" in command
        assert "search" in command
        assert "--dry-run" in command
        assert cwd and str(cwd).endswith("/MLE")
        artifacts_idx = command.index("--artifacts")
        artifacts_dir = Path(command[artifacts_idx + 1])
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        (artifacts_dir / "search_summary.json").write_text(
            json.dumps({"best_run_id": "mle-run-001", "best_score": 0.61, "runs": [{"run_id": "mle-run-001"}]}),
            encoding="utf-8",
        )
        return _Proc()

    monkeypatch.setattr(agentic_os_module.subprocess, "run", _fake_run)

    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": [],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "executionMode": "mle_runner",
            "requestedActions": [],
        },
    )

    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    final_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert final_detail["status"] == "SUCCEEDED"

    run_root = Path(os.environ["LOCAL_RUN_ROOT"]).expanduser()
    runtime_path = run_root.parent / "agentic_os" / "runs" / run_id / "artifacts" / "runtime_execution.json"
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    assert runtime.get("mode") == "mle_runner"
    assert runtime.get("status") == "SUCCEEDED"
    assert runtime.get("mle", {}).get("summary", {}).get("bestRunId") == "mle-run-001"
    assert float(runtime.get("mle", {}).get("summary", {}).get("bestScore")) == 0.61

    exec_nodes = [node for node in final_detail["totTree"] if str(node.get("title")) == "Execute Candidate Run"]
    assert exec_nodes
    execution = (exec_nodes[0].get("evidence") or {}).get("execution") or {}
    assert str(execution.get("mode")) == "mle_runner"


def test_nfr_approval_distinct_roles_enforced(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": ["unknown_script_execution"],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
            "approvalPolicy": {
                "mode": "balanced",
                "highRiskActionRoles": ["admin", "security"],
                "blockedActionRoles": ["admin", "security"],
                "requireApprovalForUnknownActions": True,
                "minApprovals": 2,
                "requireDistinctRoles": True,
            },
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending

    vote1 = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in pending], "decision": "approve", "actorId": "admin_1", "actorRole": "admin"},
    )
    assert vote1.status_code == 200, vote1.text
    vote2 = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in pending], "decision": "approve", "actorId": "admin_2", "actorRole": "admin"},
    )
    assert vote2.status_code == 200, vote2.text
    mid = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    still_pending = [item for item in mid["pendingApprovals"] if item["status"] == "PENDING"]
    assert still_pending
    assert all(int(item.get("approvalVotes") or item.get("approval_votes") or 0) >= 2 for item in still_pending)

    vote3 = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in still_pending], "decision": "approve", "actorId": "security_1", "actorRole": "security"},
    )
    assert vote3.status_code == 200, vote3.text
    final_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    approved = [item for item in final_detail["pendingApprovals"] if item["status"] == "APPROVED"]
    assert approved


def test_nfr_approval_reopen_flow(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": ["unknown_script_execution"],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending

    reject_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in pending], "decision": "reject", "actorId": "admin_1", "actorRole": "admin"},
    )
    assert reject_res.status_code == 200, reject_res.text
    rejected = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    rejected_items = [item for item in rejected["pendingApprovals"] if item["status"] == "REJECTED"]
    assert rejected_items

    reopen_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in rejected_items], "decision": "reopen", "actorId": "admin_1", "actorRole": "admin"},
    )
    assert reopen_res.status_code == 200, reopen_res.text
    reopened = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    reopened_items = [item for item in reopened["pendingApprovals"] if item["status"] == "PENDING"]
    assert reopened_items

    approve_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in reopened_items], "decision": "approve", "actorId": "admin_1", "actorRole": "admin"},
    )
    assert approve_res.status_code == 200, approve_res.text
    exec_res2 = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res2.status_code == 200, exec_res2.text
    final_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert final_detail["status"] in {"RUNNING", "SUCCEEDED"}
    assert not any(item["status"] == "PENDING" for item in final_detail["pendingApprovals"])


def test_nfr_approval_expiry(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": ["unknown_script_execution"],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
            "approvalPolicy": {
                "mode": "balanced",
                "approvalTtlMinutes": 5,
            },
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending

    run_root = Path(os.environ["LOCAL_RUN_ROOT"]).expanduser()
    state_path = run_root.parent / "agentic_os" / "runs" / run_id / "state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    for item in state.get("pending_approvals", []):
        if str(item.get("status")) == "PENDING":
            item["expires_at"] = "2000-01-01T00:00:00+00:00"
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    approve_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in pending], "decision": "approve", "actorId": "admin_1", "actorRole": "admin"},
    )
    assert approve_res.status_code == 200, approve_res.text
    expired_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    expired = [item for item in expired_detail["pendingApprovals"] if item["status"] == "EXPIRED"]
    assert expired
    assert any(evt["event"] == "approval_expired" for evt in expired_detail["events"])


def test_nfr_local_shell_command_blocked_token_fails_execution(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": [],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "executionMode": "local_shell",
            "localCommand": "python -c \"print('x')\"; echo bad",
            "requestedActions": [],
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    pending = [item for item in detail["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending
    approve_res = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={"approvalIds": [item["id"] for item in pending], "decision": "approve", "actorId": "admin_1", "actorRole": "admin"},
    )
    assert approve_res.status_code == 200, approve_res.text

    exec_res2 = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res2.status_code == 200, exec_res2.text
    final_detail = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert final_detail["status"] == "FAILED"
    registry = final_detail.get("registryRecord", {})
    failure_reason = registry.get("failureReason") or registry.get("failure_reason") or ""
    assert "local_shell_blocked_token" in str(failure_reason)


def test_nfr_health_ready_and_basic_metrics_endpoint(client):
    health = client.get("/healthz")
    assert health.status_code == 200, health.text
    assert health.json().get("status") == "ok"

    ready = client.get("/readyz")
    assert ready.status_code == 200, ready.text
    assert ready.json().get("status") in {"ready", "not_ready"}

    metrics_1 = client.get("/metrics/basic")
    assert metrics_1.status_code == 200, metrics_1.text
    before_total = int(metrics_1.json().get("agenticRunsTotal") or 0)

    _create_run(client)
    metrics_2 = client.get("/metrics/basic")
    assert metrics_2.status_code == 200, metrics_2.text
    after_total = int(metrics_2.json().get("agenticRunsTotal") or 0)
    assert after_total >= before_total + 1


def test_nfr_idempotency_for_execute_and_approve(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": ["unknown_script_execution"],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
        },
    )

    exec1 = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all", "idempotencyKey": "exec-key-1"})
    assert exec1.status_code == 200, exec1.text
    detail1 = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    events_1 = len(detail1["events"])

    exec2 = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all", "idempotencyKey": "exec-key-1"})
    assert exec2.status_code == 200, exec2.text
    detail2 = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    events_2 = len(detail2["events"])
    assert events_2 == events_1

    pending = [item["id"] for item in detail2["pendingApprovals"] if item["status"] == "PENDING"]
    assert pending
    app1 = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={
            "approvalIds": pending,
            "decision": "approve",
            "actorId": "test_admin",
            "actorRole": "admin",
            "idempotencyKey": "app-key-1",
        },
    )
    assert app1.status_code == 200, app1.text
    after1 = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    approvals_done_1 = sum(1 for item in after1["pendingApprovals"] if item["status"] == "APPROVED")

    app2 = client.post(
        f"/api/v1/agentic/runs/{run_id}/approvals",
        json={
            "approvalIds": pending,
            "decision": "approve",
            "actorId": "test_admin",
            "actorRole": "admin",
            "idempotencyKey": "app-key-1",
        },
    )
    assert app2.status_code == 200, app2.text
    after2 = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    approvals_done_2 = sum(1 for item in after2["pendingApprovals"] if item["status"] == "APPROVED")
    assert approvals_done_2 == approvals_done_1


def test_nfr_recover_run_rebuilds_status(client):
    run_id, _ = _create_run(
        client,
        idea_overrides={
            "constraints": {
                "compliance": ["no_pii"],
                "forbiddenActions": ["unknown_script_execution"],
                "allowNetwork": False,
                "allowDependencyInstall": False,
            },
            "requestedActions": ["unknown_script_execution"],
        },
    )
    exec_res = client.post(f"/api/v1/agentic/runs/{run_id}/execute", json={"mode": "all"})
    assert exec_res.status_code == 200, exec_res.text
    detail_blocked = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert detail_blocked["status"] == "BLOCKED"

    run_root = Path(os.environ["LOCAL_RUN_ROOT"]).expanduser()
    state_path = run_root.parent / "agentic_os" / "runs" / run_id / "state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["status"] = "RUNNING"
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    recover_res = client.post(f"/api/v1/agentic/runs/{run_id}/recover")
    assert recover_res.status_code == 200, recover_res.text
    detail_recovered = client.get(f"/api/v1/agentic/runs/{run_id}").json()
    assert detail_recovered["status"] == "BLOCKED"
    assert any(evt["event"] == "run_recovered" for evt in detail_recovered["events"])
