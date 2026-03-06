import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Compass,
  GitBranch,
  Play,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { api, isDemoMode } from '../services/api';
import { useI18n } from '../services/i18n';
import type { AgenticLlmTraceRecord, AgenticNode, AgenticNodeRunRecord, AgenticRunDetail, AgenticRunSummary } from '../types';

type SearchMeta = {
  depth: number;
  visits: number;
  value: number;
  frontierScore: number;
  selectedCount: number;
};

type ProcessPhase = 'goal' | 'plan' | 'act' | 'observe' | 'reflect';

type ProcessStep = {
  id: string;
  ts: string;
  tsMs: number;
  phase: ProcessPhase;
  source: 'event' | 'llm';
  nodeId: string;
  status: string;
  headline: string;
  detail: string;
  role: string;
};

type StrategyTurnCategory = 'governance' | 'failure' | 'recovery' | 'reflection';

type StrategyTurnRow = {
  id: string;
  ts: string;
  tsMs: number;
  nodeId: string;
  cause: StrategyTurnCategory;
  trigger: string;
  before: string;
  after: string;
  detail: string;
};

type BranchRow = {
  nodeId: string;
  title: string;
  status: string;
  agent: string;
  llmEnabled: boolean;
  nodeFunctions: Array<'code' | 'experiment' | 'planning'>;
  hypothesis: string;
  rationale: string;
  depth: number;
  visits: number;
  frontier: number;
  value: number;
  evidence: number;
  childCount: number;
  lastSignal: string;
  lastTouchMs: number;
};

type NodeRunEvidence = {
  nodeRunId: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  finishedAtMs: number;
  diffFiles: number;
  resolvedTargets: number;
  unresolvedTargets: number;
  syntaxFailed: number;
  changeSummary: string;
  strategy: string;
  mutationKind: string;
  validationCommand: string;
  targetFiles: string[];
};

type NodeStoryView = {
  whyThisStep: string;
  analysisSummary: string;
  changesSummary: string;
  runSummary: string;
  decisionSummary: string;
  run: Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const summarizeValue = (value: unknown, fallback = '-') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const rows = value.map(item => summarizeValue(item, '')).filter(Boolean);
    return rows.length > 0 ? rows.slice(0, 3).join(' | ') : fallback;
  }
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const pairs = Object.entries(row)
      .slice(0, 4)
      .map(([key, val]) => `${key}: ${summarizeValue(val, '')}`.trim())
      .filter(Boolean);
    return pairs.length > 0 ? pairs.join(' | ') : fallback;
  }
  return fallback;
};

const extractNodeStory = (node: AgenticNode | null): NodeStoryView | null => {
  if (!node) return null;
  const story = asRecord(asRecord(node.evidence).story);
  if (Object.keys(story).length === 0) return null;
  const run = asRecord(story.run);
  return {
    whyThisStep: summarizeValue(story.whyThisStep, ''),
    analysisSummary: summarizeValue(story.analysis, ''),
    changesSummary: summarizeValue(story.changes, ''),
    runSummary: summarizeValue(story.run, ''),
    decisionSummary: summarizeValue(story.decision, ''),
    run,
  };
};

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const statusBadgeClass = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'SUCCEEDED') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'FAILED') return 'bg-rose-100 text-rose-700';
  if (normalized === 'BLOCKED') return 'bg-amber-100 text-amber-700';
  if (normalized === 'RUNNING') return 'bg-blue-100 text-blue-700';
  if (normalized === 'RETRY_PENDING') return 'bg-indigo-100 text-indigo-700';
  return 'bg-slate-100 text-slate-600';
};

const phaseBadgeClass = (phase: ProcessPhase) => {
  if (phase === 'goal') return 'bg-cyan-100 text-cyan-700 border-cyan-200';
  if (phase === 'plan') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (phase === 'act') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (phase === 'observe') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
};

const phaseLabel = (phase: ProcessPhase, tx: (zh: string, en: string) => string) => {
  if (phase === 'goal') return tx('目标', 'Goal');
  if (phase === 'plan') return tx('计划', 'Plan');
  if (phase === 'act') return tx('动作', 'Act');
  if (phase === 'observe') return tx('观察', 'Observe');
  return tx('反思', 'Reflect');
};

const getSearchMeta = (node: AgenticNode): SearchMeta => {
  const search = asRecord(asRecord(node.evidence).search);
  const toNum = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    depth: toNum(search.depth),
    visits: toNum(search.visits),
    value: toNum(search.value),
    frontierScore: toNum(search.frontierScore),
    selectedCount: toNum(search.selectedCount),
  };
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const normalizeLlmIssue = (raw: string, tx: (zh: string, en: string) => string): string => {
  const detail = String(raw || '');
  if (detail.includes('llm_required_missing_api_key')) {
    return tx(
      '未配置 LLM API Key（可用 AGENTIC_LLM_API_KEY / LLM_API_KEY / MODEL_API_KEY / OPENAI_API_KEY）。请先在后端环境变量中配置，再重试。',
      'LLM API key is missing (use AGENTIC_LLM_API_KEY / LLM_API_KEY / MODEL_API_KEY / OPENAI_API_KEY). Configure backend env and retry.',
    );
  }
  if (detail.includes('llm_required_missing_model')) {
    return tx(
      '未配置 LLM 模型（可用 AGENTIC_LLM_MODEL / LLM_MODEL）。请先配置模型名，再重试。',
      'LLM model is missing (use AGENTIC_LLM_MODEL / LLM_MODEL). Configure model and retry.',
    );
  }
  if (detail.includes('llm_required_missing_provider')) {
    return tx(
      '未配置 LLM Provider（可用 AGENTIC_LLM_PROVIDER / LLM_PROVIDER）。请先配置 provider，再重试。',
      'LLM provider is missing (use AGENTIC_LLM_PROVIDER / LLM_PROVIDER). Configure provider and retry.',
    );
  }
  if (detail.includes('llm_required_')) {
    return tx(`LLM 核心链路校验失败：${detail}`, `LLM core-chain check failed: ${detail}`);
  }
  return detail;
};

const summarizeEvent = (event: string, tx: (zh: string, en: string) => string) => {
  const e = String(event || '').toLowerCase();
  if (e === 'search_node_selected') return tx('选择下一条探索分支', 'Selected next branch to explore');
  if (e === 'tot_node_expanded') return tx('扩展假设并生成子分支', 'Expanded hypothesis into child branches');
  if (e === 'node_succeeded') return tx('执行成功，证据支持当前方向', 'Execution succeeded with supportive evidence');
  if (e === 'node_failed') return tx('执行失败，触发策略修正', 'Execution failed and triggered strategy correction');
  if (e === 'node_unblocked') return tx('分支已解锁，可继续推进', 'Branch unblocked and ready to continue');
  if (e === 'llm_called') return tx('LLM 调用已记录', 'LLM call recorded');
  if (e === 'code_changed') return tx('代码改动已产出', 'Code changes produced');
  if (e === 'experiment_started') return tx('实验已启动', 'Experiment started');
  if (e === 'experiment_finished') return tx('实验已结束', 'Experiment finished');
  if (e === 'node_completed') return tx('节点已完成', 'Node completed');
  if (e === 'sub_agent_started') return tx('派生子 Agent 并行探索', 'Spawned sub-agent for parallel exploration');
  if (e === 'sub_agent_succeeded') return tx('子 Agent 返回有效结论', 'Sub-agent returned useful findings');
  if (e === 'sub_agent_failed') return tx('子 Agent 路径失败，回收到主线', 'Sub-agent path failed and rolled back');
  if (e === 'approval_updated') return tx('审批状态变更，调整执行边界', 'Approval state changed and execution boundary adjusted');
  if (e.includes('recover')) return tx('执行恢复流程，重新进入探索', 'Recovery flow resumed exploration');
  return event || tx('事件更新', 'Event update');
};

const classifyTurnCause = (step: ProcessStep): StrategyTurnCategory => {
  const blob = `${step.headline} ${step.detail}`.toLowerCase();
  if (
    blob.includes('approval')
    || blob.includes('审批')
    || blob.includes('policy')
    || blob.includes('compliance')
    || blob.includes('安全')
  ) {
    return 'governance';
  }
  if (
    blob.includes('failed')
    || blob.includes('error')
    || blob.includes('reject')
    || blob.includes('失败')
    || blob.includes('中断')
  ) {
    return 'failure';
  }
  if (
    blob.includes('recover')
    || blob.includes('unblock')
    || blob.includes('retry')
    || blob.includes('恢复')
    || blob.includes('解锁')
    || blob.includes('重试')
  ) {
    return 'recovery';
  }
  return 'reflection';
};

const strategyTurnLabel = (cause: StrategyTurnCategory, tx: (zh: string, en: string) => string) => {
  if (cause === 'governance') return tx('治理约束', 'Governance');
  if (cause === 'failure') return tx('失败驱动', 'Failure-driven');
  if (cause === 'recovery') return tx('恢复转向', 'Recovery');
  return tx('策略反思', 'Reflection');
};

const strategyTurnToneClass = (cause: StrategyTurnCategory) => {
  if (cause === 'governance') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (cause === 'failure') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (cause === 'recovery') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  return 'bg-indigo-100 text-indigo-700 border-indigo-200';
};

const inferEventPhase = (event: string): ProcessPhase => {
  const e = String(event || '').toLowerCase();
  if (e.includes('selected') || e.includes('started') || e.includes('queued')) return 'plan';
  if (e.includes('expanded') || e.includes('execute') || e.includes('branch_added') || e.includes('code_changed')) return 'act';
  if (e.includes('succeeded') || e.includes('failed')) return 'observe';
  if (e.includes('finished') || e.includes('completed')) return 'observe';
  if (e.includes('approval') || e.includes('recover') || e.includes('unblocked') || e.includes('replay')) return 'reflect';
  return 'observe';
};

const inferTracePhase = (trace: AgenticLlmTraceRecord): ProcessPhase => {
  const task = String(trace.task || '').toLowerCase();
  const role = String(trace.role || '').toLowerCase();
  if (
    task.includes('goal')
    || task.includes('spec')
    || task.includes('plan')
    || task.includes('decompose')
    || role.includes('planner')
  ) {
    return 'plan';
  }
  if (
    task.includes('execute')
    || task.includes('tool')
    || task.includes('patch')
    || task.includes('run')
    || role.includes('executor')
  ) {
    return 'act';
  }
  if (
    task.includes('observe')
    || task.includes('eval')
    || task.includes('score')
    || task.includes('verify')
    || role.includes('critic')
  ) {
    return 'observe';
  }
  if (task.includes('reflect') || task.includes('review') || task.includes('decide')) return 'reflect';
  return 'plan';
};

const parseTimestamp = (raw: unknown, fallback: number) => {
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return fallback;
};

const toCount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const extractNodeRunEvidence = (run: AgenticNodeRunRecord): NodeRunEvidence => {
  const metrics = asRecord(run.metrics);
  const artifacts = asRecord(metrics.nodeRunArtifacts);
  const patchRows = Array.isArray(run.patchPlan) ? run.patchPlan : [];
  const firstPatch = asRecord(patchRows[0]);
  const targetFiles = Array.isArray(firstPatch.targetFiles)
    ? firstPatch.targetFiles.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const finishedAtMs = parseTimestamp(run.finishedAt || run.startedAt, 0);
  return {
    nodeRunId: String(run.nodeRunId || ''),
    status: String(run.status || '').toUpperCase(),
    startedAt: String(run.startedAt || ''),
    finishedAt: String(run.finishedAt || ''),
    finishedAtMs,
    diffFiles: toCount(artifacts.diffFiles),
    resolvedTargets: toCount(artifacts.resolvedTargets),
    unresolvedTargets: toCount(artifacts.unresolvedTargets),
    syntaxFailed: toCount(artifacts.pythonSyntaxFailed),
    changeSummary: String(firstPatch.changeSummary || ''),
    strategy: String(firstPatch.strategy || ''),
    mutationKind: String(firstPatch.mutationKind || 'code').toLowerCase(),
    validationCommand: String(firstPatch.validationCommand || ''),
    targetFiles,
  };
};

const computeRunConfidence = (run: NodeRunEvidence | null): number | null => {
  if (!run) return null;
  const raw =
    run.resolvedTargets * 1.15
    + run.diffFiles * 0.35
    - run.unresolvedTargets * 0.95
    - run.syntaxFailed * 1.2;
  return clamp01((raw + 4) / 10);
};

const inferNodeFunctions = (
  node: AgenticNode,
  runEvidence: NodeRunEvidence | undefined,
): Array<'code' | 'experiment' | 'planning'> => {
  const labels: Array<'code' | 'experiment' | 'planning'> = [];
  const explicitFunction = String(node.nodeFunction || '').toLowerCase();
  if (explicitFunction === 'coding') labels.push('code');
  if (explicitFunction === 'experiment') labels.push('experiment');
  if (explicitFunction === 'planning' || explicitFunction === 'review' || explicitFunction === 'safety') labels.push('planning');
  const agent = String(node.agent || '').toLowerCase();
  const expansion = asRecord(asRecord(node.evidence).expansion);
  const mutationPlan = expansion.mutationPlan;
  const hasMutationPlan = Array.isArray(mutationPlan)
    ? mutationPlan.length > 0
    : !!mutationPlan;

  if (hasMutationPlan || !!runEvidence?.changeSummary || (runEvidence?.diffFiles || 0) > 0) {
    labels.push('code');
  }
  if (
    !!runEvidence
    || agent.includes('eval')
    || agent.includes('experiment')
    || agent.includes('runner')
  ) {
    labels.push('experiment');
  }
  if (labels.length === 0) labels.push('planning');
  return Array.from(new Set(labels));
};

const formatPercent = (value: number) => `${Math.round(clamp01(value) * 100)}%`;

const nodeStatusPriority = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'RUNNING') return 0;
  if (normalized === 'RETRY_PENDING') return 1;
  if (normalized === 'PENDING') return 2;
  if (normalized === 'BLOCKED') return 3;
  if (normalized === 'FAILED') return 4;
  if (normalized === 'SUCCEEDED') return 5;
  return 6;
};

export const AgenticLab: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { tx } = useI18n();

  const [runs, setRuns] = useState<AgenticRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [detail, setDetail] = useState<AgenticRunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [busyAction, setBusyAction] = useState<'none' | 'next' | 'all' | 'recover'>('none');
  const [message, setMessage] = useState('');
  const [focusedNodeId, setFocusedNodeId] = useState('');

  const refreshRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await api.listAgenticRuns({ page: 1, pageSize: 120 });
      const items = res.items || [];
      setRuns(items);
      if (items.length === 0) {
        setSelectedRunId('');
        setDetail(null);
        return;
      }
      if (!selectedRunId || !items.some(item => item.runId === selectedRunId)) {
        setSelectedRunId(items[0].runId);
      }
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setLoadingRuns(false);
    }
  }, [selectedRunId]);

  const loadRun = useCallback(async (runId: string, background = false) => {
    if (!runId) {
      setDetail(null);
      return;
    }
    if (!background) setLoadingRun(true);
    try {
      const payload = await api.getAgenticRun(runId);
      setDetail(prev => {
        if (!prev) return payload;
        const unchanged =
          String(prev.updatedAt || '') === String(payload.updatedAt || '')
          && String(prev.status || '') === String(payload.status || '')
          && (prev.totTree?.length || 0) === (payload.totTree?.length || 0)
          && (prev.events?.length || 0) === (payload.events?.length || 0)
          && (prev.nodeRuns?.length || 0) === (payload.nodeRuns?.length || 0)
          && (prev.llmTraces?.length || 0) === (payload.llmTraces?.length || 0)
          && (prev.pendingApprovals?.length || 0) === (payload.pendingApprovals?.length || 0);
        return unchanged ? prev : payload;
      });
    } catch (error) {
      if (!background) {
        setMessage(toErrorMessage(error));
        setDetail(null);
      }
    } finally {
      if (!background) setLoadingRun(false);
    }
  }, []);

  useEffect(() => {
    refreshRuns().catch(() => undefined);
  }, [refreshRuns]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    loadRun(selectedRunId, false).catch(() => undefined);
  }, [selectedRunId, loadRun]);

  useEffect(() => {
    const runId = new URLSearchParams(location.search).get('runId');
    if (!runId) return;
    if (runs.some(item => item.runId === runId) && runId !== selectedRunId) {
      setSelectedRunId(runId);
    }
  }, [location.search, runs, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) return;
    const status = String(detail?.status || '').toUpperCase();
    if (status !== 'RUNNING' && status !== 'PENDING' && status !== 'BLOCKED') return;
    if (busyAction !== 'none') return;
    const timer = window.setInterval(() => {
      loadRun(selectedRunId, true).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [selectedRunId, detail?.status, loadRun, busyAction]);

  const nodes = useMemo(() => (Array.isArray(detail?.totTree) ? detail?.totTree : []), [detail]);
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.nodeId, node])), [nodes]);

  const nodeRunEvidenceByNode = useMemo(() => {
    const map = new Map<string, NodeRunEvidence>();
    const rows = Array.isArray(detail?.nodeRuns) ? detail.nodeRuns : [];
    rows.forEach(run => {
      const nodeId = String(run.nodeId || '').trim();
      if (!nodeId) return;
      const summary = extractNodeRunEvidence(run);
      const prev = map.get(nodeId);
      if (!prev || summary.finishedAtMs >= prev.finishedAtMs) {
        map.set(nodeId, summary);
      }
    });
    return map;
  }, [detail?.nodeRuns]);

  const nodeRunHistoryByNode = useMemo(() => {
    const map = new Map<string, NodeRunEvidence[]>();
    const rows = Array.isArray(detail?.nodeRuns) ? detail.nodeRuns : [];
    rows.forEach(run => {
      const nodeId = String(run.nodeId || '').trim();
      if (!nodeId) return;
      const summary = extractNodeRunEvidence(run);
      const list = map.get(nodeId) || [];
      list.push(summary);
      map.set(nodeId, list);
    });
    map.forEach(list => {
      list.sort((a, b) => b.finishedAtMs - a.finishedAtMs || b.nodeRunId.localeCompare(a.nodeRunId));
    });
    return map;
  }, [detail?.nodeRuns]);

  const processSteps = useMemo(() => {
    const eventRows = (Array.isArray(detail?.events) ? detail.events : []).map((raw, idx) => {
      const row = asRecord(raw);
      const payload = asRecord(row.payload);
      const event = String(row.event || '').trim();
      const nodeId = String(payload.nodeId || payload.node_id || '').trim();
      const ts = String(row.ts || '');
      const tsMs = parseTimestamp(ts, idx + 1);
      const status = String(payload.status || '').trim()
        || (event.toLowerCase().includes('failed') ? 'FAILED' : event.toLowerCase().includes('succeeded') ? 'SUCCEEDED' : '');
      const summary = String(row.message || payload.summary || payload.reason || '').trim();
      return {
        id: `event-${idx}`,
        ts,
        tsMs,
        phase: inferEventPhase(event),
        source: 'event' as const,
        nodeId,
        status,
        headline: summarizeEvent(event, tx),
        detail: summary || event,
        role: String(payload.agent || payload.actorId || payload.owner || 'system'),
      } as ProcessStep;
    });

    const traceRows = (Array.isArray(detail?.llmTraces) ? detail.llmTraces : []).map((trace, idx) => {
      const ts = String(trace.ts || '');
      const tsMs = parseTimestamp(ts, idx + 1);
      const role = String(trace.role || 'LLM').trim() || 'LLM';
      const model = String(trace.model || '-');
      const attempt = Number(trace.attempt || 0);
      const latency = Number(trace.latencyMs || 0);
      const detailLine = `${tx('模型', 'Model')}: ${model} · ${tx('尝试', 'Attempt')} ${attempt || 1} · ${tx('耗时', 'Latency')} ${latency || 0}ms · schema=${trace.schemaValid ? 'ok' : 'fail'}`;
      return {
        id: `llm-${idx}`,
        ts,
        tsMs,
        phase: inferTracePhase(trace),
        source: 'llm' as const,
        nodeId: String(trace.nodeId || ''),
        status: String(trace.status || ''),
        headline: `${role} · ${String(trace.task || tx('推理调用', 'Reasoning call'))}`,
        detail: trace.error ? `${detailLine} · ${trace.error}` : detailLine,
        role,
      } as ProcessStep;
    });

    return [...eventRows, ...traceRows]
      .sort((a, b) => b.tsMs - a.tsMs || a.id.localeCompare(b.id))
      .slice(0, 160);
  }, [detail?.events, detail?.llmTraces, tx]);

  const runStats = useMemo(() => {
    const stats = { total: nodes.length, pending: 0, running: 0, blocked: 0, failed: 0, succeeded: 0, retryPending: 0 };
    nodes.forEach(node => {
      const status = String(node.status || '').toUpperCase();
      if (status === 'SUCCEEDED') stats.succeeded += 1;
      else if (status === 'FAILED') stats.failed += 1;
      else if (status === 'BLOCKED') stats.blocked += 1;
      else if (status === 'RUNNING') stats.running += 1;
      else if (status === 'RETRY_PENDING') stats.retryPending += 1;
      else stats.pending += 1;
    });
    return stats;
  }, [nodes]);

  const llmSummary = useMemo(() => {
    const traces = Array.isArray(detail?.llmTraces) ? detail.llmTraces : [];
    const total = traces.length;
    let failed = 0;
    let latencyTotal = 0;
    const roleMap = new Map<string, { total: number; failed: number }>();

    traces.forEach(trace => {
      const ok = String(trace.status || '').toLowerCase() === 'succeeded';
      if (!ok) failed += 1;
      const latency = Number(trace.latencyMs || 0);
      if (Number.isFinite(latency) && latency > 0) latencyTotal += latency;
      const role = String(trace.role || 'LLM').trim() || 'LLM';
      const prev = roleMap.get(role) || { total: 0, failed: 0 };
      roleMap.set(role, { total: prev.total + 1, failed: prev.failed + (ok ? 0 : 1) });
    });

    const topRoles = Array.from(roleMap.entries())
      .map(([role, row]) => ({ role, total: row.total, failed: row.failed }))
      .sort((a, b) => b.total - a.total || a.role.localeCompare(b.role))
      .slice(0, 6);

    return {
      total,
      failed,
      avgLatencyMs: total > 0 ? Math.round(latencyTotal / total) : 0,
      topRoles,
    };
  }, [detail?.llmTraces]);

  const branchRows = useMemo(() => {
    const latestByNode = new Map<string, ProcessStep>();
    processSteps.forEach(step => {
      if (!step.nodeId) return;
      if (!latestByNode.has(step.nodeId)) latestByNode.set(step.nodeId, step);
    });

    return nodes
      .map(node => {
        const search = getSearchMeta(node);
        const latest = latestByNode.get(node.nodeId);
        const evidence = nodeRunEvidenceByNode.get(node.nodeId);
        const nodeFunctions = inferNodeFunctions(node, evidence);
        const evidenceSignal = evidence
          ? clamp01((evidence.diffFiles * 0.24 + evidence.resolvedTargets * 0.38 - evidence.unresolvedTargets * 0.2 - evidence.syntaxFailed * 0.2) / 3)
          : 0;
        return {
          nodeId: node.nodeId,
          title: String(node.title || node.nodeId),
          status: String(node.status || 'PENDING').toUpperCase(),
          agent: String(node.agent || '-'),
          llmEnabled: node.llmEnabled !== false,
          nodeFunctions,
          hypothesis: String(node.hypothesis || ''),
          rationale: String(node.rationale || ''),
          depth: Number(search.depth || 0),
          visits: Number(search.visits || 0),
          frontier: clamp01(Number(search.frontierScore || 0)),
          value: clamp01(Number(search.value || 0)),
          evidence: evidenceSignal,
          childCount: Array.isArray(node.children) ? node.children.length : 0,
          lastSignal: latest?.headline || tx('尚未产生显式推理信号', 'No explicit reasoning signal yet'),
          lastTouchMs: latest?.tsMs || 0,
        } as BranchRow;
      })
      .sort((a, b) => {
        const statusDelta = nodeStatusPriority(a.status) - nodeStatusPriority(b.status);
        if (statusDelta !== 0) return statusDelta;
        if (b.lastTouchMs !== a.lastTouchMs) return b.lastTouchMs - a.lastTouchMs;
        if (b.frontier !== a.frontier) return b.frontier - a.frontier;
        return a.nodeId.localeCompare(b.nodeId);
      });
  }, [nodes, nodeRunEvidenceByNode, processSteps, tx]);

  useEffect(() => {
    if (branchRows.length === 0) {
      setFocusedNodeId('');
      return;
    }
    if (!focusedNodeId || !branchRows.some(row => row.nodeId === focusedNodeId)) {
      setFocusedNodeId(branchRows[0].nodeId);
    }
  }, [branchRows, focusedNodeId]);

  const focusedBranch = useMemo(
    () => branchRows.find(row => row.nodeId === focusedNodeId) || branchRows[0] || null,
    [branchRows, focusedNodeId],
  );

  const focusedNode = useMemo(() => {
    if (!focusedBranch) return null;
    return nodeById.get(focusedBranch.nodeId) || null;
  }, [focusedBranch, nodeById]);

  const focusedStory = useMemo(() => extractNodeStory(focusedNode), [focusedNode]);

  const focusedNodeRun = useMemo(() => {
    if (!focusedBranch) return null;
    return nodeRunEvidenceByNode.get(focusedBranch.nodeId) || null;
  }, [focusedBranch, nodeRunEvidenceByNode]);

  const focusedRunHistory = useMemo(() => {
    if (!focusedBranch) return [] as NodeRunEvidence[];
    return nodeRunHistoryByNode.get(focusedBranch.nodeId) || [];
  }, [focusedBranch, nodeRunHistoryByNode]);

  const strategyTurns = useMemo(() => {
    const chronological = [...processSteps].sort((a, b) => a.tsMs - b.tsMs || a.id.localeCompare(b.id));
    const rows: StrategyTurnRow[] = [];

    chronological.forEach((step, idx) => {
      if (step.source !== 'event') return;
      const blob = `${step.headline} ${step.detail}`.toLowerCase();
      const isTurn =
        step.phase === 'reflect'
        || blob.includes('approval')
        || blob.includes('审批')
        || blob.includes('failed')
        || blob.includes('失败')
        || blob.includes('recover')
        || blob.includes('恢复')
        || blob.includes('unblock')
        || blob.includes('解锁')
        || blob.includes('retry')
        || blob.includes('重试')
        || blob.includes('reject');
      if (!isTurn) return;

      const nodeId = step.nodeId || '';
      const findNeighbor = (direction: -1 | 1) => {
        for (
          let cursor = idx + direction;
          cursor >= 0 && cursor < chronological.length;
          cursor += direction
        ) {
          const candidate = chronological[cursor];
          if (!nodeId || !candidate.nodeId || candidate.nodeId === nodeId) return candidate;
        }
        return null;
      };

      const before = findNeighbor(-1);
      const after = findNeighbor(1);

      rows.push({
        id: step.id,
        ts: step.ts,
        tsMs: step.tsMs,
        nodeId,
        cause: classifyTurnCause(step),
        trigger: step.headline,
        before: before?.headline || tx('无明确前置动作', 'No explicit previous step'),
        after: after?.headline || tx('无明确后续动作', 'No explicit next step'),
        detail: step.detail,
      });
    });

    return rows.sort((a, b) => b.tsMs - a.tsMs || a.id.localeCompare(b.id)).slice(0, 24);
  }, [processSteps, tx]);

  const latestFocusedTurn = useMemo(() => {
    if (strategyTurns.length === 0) return null;
    if (!focusedBranch?.nodeId) return strategyTurns[0];
    return strategyTurns.find(item => !item.nodeId || item.nodeId === focusedBranch.nodeId) || strategyTurns[0];
  }, [strategyTurns, focusedBranch?.nodeId]);

  const selectedRunSummary = useMemo(() => runs.find(item => item.runId === selectedRunId) || null, [runs, selectedRunId]);

  const mission = useMemo(() => {
    const spec = asRecord(detail?.researchSpec);
    const idea = asRecord(detail?.idea);
    const specEnv = asRecord(spec.environment);
    const specSuccess = asRecord(spec.successMetrics);
    const constraints = asRecord(spec.constraints);

    const compliance = Array.isArray(constraints.compliance)
      ? constraints.compliance.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    const forbiddenActions = Array.isArray(constraints.forbiddenActions)
      ? constraints.forbiddenActions.map(item => String(item || '').trim()).filter(Boolean)
      : [];

    return {
      title: String(spec.title || idea.title || selectedRunSummary?.title || tx('未命名探索任务', 'Untitled exploration mission')),
      goal: String(spec.taskGoal || idea.taskGoal || selectedRunSummary?.objective || '-'),
      environment: String(specEnv.name || idea.environment || '-'),
      primaryMetric: Object.entries(specSuccess)[0]?.[0] || tx('未声明', 'Not declared'),
      compliance,
      forbiddenActions,
    };
  }, [detail?.researchSpec, detail?.idea, selectedRunSummary, tx]);

  const autonomyScore = useMemo(() => {
    const pendingApprovals = (detail?.pendingApprovals || []).length;
    const interventionSignals = pendingApprovals + runStats.blocked + runStats.failed * 0.6;
    const denominator = Math.max(6, processSteps.length * 0.7 + runStats.total * 0.35);
    return clamp01(1 - interventionSignals / denominator);
  }, [detail?.pendingApprovals, runStats.blocked, runStats.failed, runStats.total, processSteps.length]);

  const autonomyFactors = useMemo(() => {
    const pendingApprovals = (detail?.pendingApprovals || []).length;
    const blocked = runStats.blocked;
    const failed = runStats.failed;
    const llmFailed = llmSummary.failed;
    const llmTotal = llmSummary.total;

    const raw = [
      {
        key: 'approval',
        label: tx('审批摩擦', 'Approval friction'),
        ratio: clamp01((pendingApprovals + blocked) / Math.max(1, runStats.total + 3)),
        weight: 0.45,
      },
      {
        key: 'execution',
        label: tx('执行失败率', 'Execution failure rate'),
        ratio: clamp01(failed / Math.max(1, runStats.total)),
        weight: 0.35,
      },
      {
        key: 'llm',
        label: tx('LLM 不稳定性', 'LLM instability'),
        ratio: clamp01(llmFailed / Math.max(1, llmTotal)),
        weight: 0.2,
      },
    ];

    return raw.map(item => ({
      ...item,
      impact: item.ratio * item.weight,
    }));
  }, [detail?.pendingApprovals, runStats.blocked, runStats.failed, runStats.total, llmSummary.failed, llmSummary.total, tx]);

  const runExecutionAction = async (mode: 'next' | 'all' | 'recover') => {
    if (!selectedRunId) return;
    setBusyAction(mode);
    setMessage('');
    try {
      const result = mode === 'recover'
        ? await api.recoverAgenticRun(selectedRunId)
        : await api.executeAgenticRun(selectedRunId, { mode });
      setDetail(result.detail);
      await refreshRuns();
      setMessage(result.message || tx('执行成功。', 'Execution succeeded.'));
    } catch (error) {
      setMessage(normalizeLlmIssue(toErrorMessage(error), tx));
    } finally {
      setBusyAction('none');
    }
  };

  const openNodeEvidence = (nodeId: string) => {
    if (!selectedRunId || !nodeId) return;
    navigate(`/agentic/runs/${encodeURIComponent(selectedRunId)}/nodes/${encodeURIComponent(nodeId)}`);
  };

  const focusedSuggestions = useMemo(
    () => (Array.isArray(focusedNode?.nextSuggestions) ? focusedNode.nextSuggestions.slice(0, 4) : []),
    [focusedNode?.nextSuggestions],
  );

  const focusedProcessStory = useMemo(() => {
    const targetNodeId = focusedBranch?.nodeId || '';
    const pick = (phase: ProcessPhase) =>
      processSteps.find(step =>
        step.phase === phase
        && (!targetNodeId || !step.nodeId || step.nodeId === targetNodeId),
      )
      || processSteps.find(step => step.phase === phase)
      || null;
    return {
      plan: pick('plan'),
      act: pick('act'),
      observe: pick('observe'),
      reflect: pick('reflect'),
    };
  }, [processSteps, focusedBranch?.nodeId]);

  const isActionBusy = busyAction !== 'none' || loadingRun;
  const interventionCount = (detail?.pendingApprovals?.length || 0) + runStats.blocked;
  const completionPercent = runStats.total > 0 ? Math.round((runStats.succeeded / runStats.total) * 100) : 0;
  const autonomyBreakdownHint = autonomyFactors
    .map(item => `${item.label}: ${Math.round(item.ratio * 100)}%`)
    .join(' | ');
  const previousNodeRun = focusedRunHistory.length > 1 ? focusedRunHistory[1] : null;
  const reasoningConfidence = focusedBranch ? clamp01(focusedBranch.value * 0.55 + focusedBranch.evidence * 0.45) : 0;
  const latestRunConfidence = computeRunConfidence(focusedNodeRun);
  const previousRunConfidence = computeRunConfidence(previousNodeRun);
  const storyRunNotExecuted = Boolean(focusedStory?.run.notExecuted);
  const runConfidenceDelta = latestRunConfidence !== null && previousRunConfidence !== null
    ? latestRunConfidence - previousRunConfidence
    : null;

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_0%_0%,rgba(16,185,129,.15),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(37,99,235,.12),transparent_34%),linear-gradient(180deg,rgba(248,250,252,.96),rgba(255,255,255,.98))] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-700">
              <Sparkles className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
              {tx('LLM 自主探索纪要', 'LLM Autonomous Exploration Chronicle')}
            </div>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">{mission.title}</h1>
            <p className="mt-1 text-sm text-slate-600">{mission.goal}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
              <span className="rounded bg-white px-2 py-1">{tx('环境', 'Environment')}: {mission.environment}</span>
              <span className="rounded bg-white px-2 py-1">{tx('主指标', 'Primary metric')}: {mission.primaryMetric}</span>
              <span className="rounded bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                {tx('自治度', 'Autonomy')} {formatPercent(autonomyScore)}
              </span>
            </div>
          </div>
          <div className="text-xs text-slate-600">
            <span className="rounded bg-white px-2 py-1">
              {tx('来源', 'Source')}: <span className="font-semibold">{isDemoMode ? 'Demo API' : 'Live API'}</span>
            </span>
            {selectedRunSummary && (
              <span className={`ml-2 rounded px-2 py-1 font-semibold ${statusBadgeClass(selectedRunSummary.status)}`}>
                {selectedRunSummary.status}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedRunId}
            onChange={e => setSelectedRunId(e.target.value)}
            className="min-w-[18rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {runs.length === 0 && <option value="">{tx('暂无运行', 'No runs yet')}</option>}
            {runs.map(run => (
              <option key={run.runId} value={run.runId}>{run.runId} · {run.title}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => refreshRuns()}
            disabled={loadingRuns}
            className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCcw className={`mr-1.5 h-4 w-4 ${loadingRuns ? 'animate-spin' : ''}`} />
            {tx('刷新', 'Refresh')}
          </button>
          <button
            type="button"
            onClick={() => runExecutionAction('next')}
            disabled={!selectedRunId || isActionBusy}
            className="inline-flex items-center rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            <Play className="mr-1.5 h-4 w-4" />
            {tx('推进一步', 'Run Next Step')}
          </button>
          <button
            type="button"
            onClick={() => runExecutionAction('all')}
            disabled={!selectedRunId || isActionBusy}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {tx('自动探索', 'Auto Explore')}
          </button>
          <button
            type="button"
            onClick={() => runExecutionAction('recover')}
            disabled={!selectedRunId || isActionBusy}
            className="inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            <ShieldAlert className="mr-1.5 h-4 w-4" />
            {tx('恢复', 'Recover')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/agentic/canvas')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            {tx('打开 ToT 画布', 'Open ToT Canvas')}
          </button>
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">{tx('Progress', 'Progress')}</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{completionPercent}%</div>
          <div className="text-[11px] text-slate-600">{runStats.succeeded}/{runStats.total} {tx('分支已收敛', 'branches converged')}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-emerald-700">{tx('Autonomy', 'Autonomy')}</div>
          <div className="mt-1 text-lg font-semibold text-emerald-900">{formatPercent(autonomyScore)}</div>
          <div className="text-[11px] text-emerald-700" title={autonomyBreakdownHint}>
            {tx('人工介入信号', 'Intervention signals')} {interventionCount}
          </div>
          <div className="mt-1 space-y-1">
            {autonomyFactors.map(item => (
              <div key={`autonomy-factor-${item.key}`} className="text-[10px] text-emerald-800">
                <div className="flex items-center justify-between">
                  <span>{item.label}</span>
                  <span>{Math.round(item.ratio * 100)}%</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-emerald-100">
                  <div className="h-full rounded bg-emerald-500/80" style={{ width: `${Math.round(item.ratio * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-violet-700">{tx('LLM Calls', 'LLM Calls')}</div>
          <div className="mt-1 text-lg font-semibold text-violet-900">{llmSummary.total}</div>
          <div className="text-[11px] text-violet-700">{tx('失败', 'Failed')} {llmSummary.failed} · {llmSummary.avgLatencyMs}ms</div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-700">{tx('探索主线', 'Exploration Storyline')}</h2>
              {focusedBranch && (
                <button
                  type="button"
                  onClick={() => openNodeEvidence(focusedBranch.nodeId)}
                  className="inline-flex items-center rounded-md border border-cyan-300 bg-white px-2 py-1 text-xs text-cyan-700 hover:bg-cyan-100"
                >
                  {tx('查看证据链', 'Open evidence chain')} <ArrowRight className="ml-1 h-3 w-3" />
                </button>
              )}
            </div>

            {!focusedBranch ? (
              <div className="mt-2 text-sm text-slate-500">{tx('暂无可用分支。', 'No branch available yet.')}</div>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="rounded-xl border border-cyan-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-cyan-700">{tx('目标', 'Goal')}</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">{mission.goal || '-'}</div>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-indigo-700">{tx('假设', 'Hypothesis')}</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">{focusedBranch.hypothesis || focusedBranch.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">{focusedBranch.nodeId}</span>
                    <span className={`rounded px-1.5 py-0.5 ${statusBadgeClass(focusedBranch.status)}`}>{focusedBranch.status}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">{tx('证据强度', 'Evidence strength')} {Math.round(focusedBranch.evidence * 100)}%</span>
                    {focusedBranch.nodeFunctions.map(kind => (
                      <span key={`focused-node-kind-${kind}`} className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-indigo-700">
                        {kind === 'code' ? tx('代码节点', 'Code Node') : kind === 'experiment' ? tx('实验节点', 'Experiment Node') : tx('规划节点', 'Planning Node')}
                      </span>
                    ))}
                    <span className={`rounded border px-1.5 py-0.5 ${focusedBranch.llmEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                      {focusedBranch.llmEnabled ? tx('LLM 开启', 'LLM Enabled') : tx('LLM 关闭', 'LLM Disabled')}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-blue-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-blue-700">{tx('为什么做这一步', 'Why this step')}</div>
                  <div className="mt-1 text-sm text-slate-900">
                    {focusedStory?.whyThisStep
                      || focusedNode?.rationale
                      || focusedProcessStory.plan?.detail
                      || focusedProcessStory.plan?.headline
                      || tx('暂无明确原因记录。', 'No explicit reason recorded yet.')}
                  </div>
                  {focusedProcessStory.plan?.headline && (
                    <div className="mt-1 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">
                      {focusedProcessStory.plan.headline}
                    </div>
                  )}
                  {latestFocusedTurn && (
                    <div className="mt-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px]">
                      <div className={`inline-flex rounded border px-1.5 py-0.5 font-semibold ${strategyTurnToneClass(latestFocusedTurn.cause)}`}>
                        {strategyTurnLabel(latestFocusedTurn.cause, tx)}
                      </div>
                      <div className="mt-1 text-slate-700">{latestFocusedTurn.trigger}</div>
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-700">{tx('分析了什么', 'What it analyzed')}</div>
                  <div className="mt-1 grid gap-2 sm:grid-cols-3">
                    <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs">
                      <div className="font-semibold text-emerald-700">{tx('输入证据', 'Input evidence')}</div>
                      <div className="mt-1 text-slate-700">{tx('证据强度', 'Evidence strength')}: {Math.round(focusedBranch.evidence * 100)}%</div>
                      <div className="text-slate-700">{tx('命中目标', 'Resolved')}: {focusedNodeRun?.resolvedTargets ?? 0}</div>
                      <div className="text-slate-700">{tx('未命中', 'Unresolved')}: {focusedNodeRun?.unresolvedTargets ?? 0}</div>
                    </div>
                    <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs">
                      <div className="font-semibold text-blue-700">{tx('推理结论', 'Reasoned conclusion')}</div>
                      <div className="mt-1 text-slate-700">
                        {focusedStory?.analysisSummary
                          || focusedProcessStory.observe?.headline
                          || focusedProcessStory.observe?.detail
                          || tx('暂无分析结果。', 'No analysis result yet.')}
                      </div>
                      {focusedProcessStory.observe?.detail && focusedProcessStory.observe.detail !== focusedProcessStory.observe.headline && (
                        <div className="mt-1 text-slate-600">{focusedProcessStory.observe.detail}</div>
                      )}
                    </div>
                    <div className="rounded border border-violet-200 bg-violet-50 px-2 py-1.5 text-xs">
                      <div className="font-semibold text-violet-700">{tx('置信度变化', 'Confidence shift')}</div>
                      <div className="mt-1 text-slate-700">{tx('当前推理置信', 'Current reasoning')}: {Math.round(reasoningConfidence * 100)}%</div>
                      <div className="text-slate-700">
                        {tx('实验置信变化', 'Run confidence delta')}: {runConfidenceDelta === null ? '-' : `${runConfidenceDelta >= 0 ? '+' : ''}${Math.round(runConfidenceDelta * 100)}%`}
                      </div>
                      <div className="text-slate-700">
                        {tx('当前实验置信', 'Latest run confidence')}: {latestRunConfidence === null ? '-' : `${Math.round(latestRunConfidence * 100)}%`}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-violet-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-violet-700">{tx('修改了什么', 'What it changed')}</div>
                  <div className="mt-1 text-sm text-slate-900">
                    {focusedStory?.changesSummary
                      || focusedNodeRun?.changeSummary
                      || focusedProcessStory.act?.detail
                      || focusedProcessStory.act?.headline
                      || tx('暂无明确修改记录。', 'No explicit modification recorded yet.')}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                    {focusedNodeRun?.mutationKind && (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{focusedNodeRun.mutationKind.toUpperCase()}</span>
                    )}
                    {focusedNodeRun?.strategy && (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{focusedNodeRun.strategy}</span>
                    )}
                    {!focusedNodeRun?.mutationKind && <span className="rounded bg-slate-100 px-1.5 py-0.5">-</span>}
                  </div>
                  {focusedNodeRun?.targetFiles && focusedNodeRun.targetFiles.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {focusedNodeRun.targetFiles.slice(0, 5).map(path => (
                        <span key={`storyline-target-file-${path}`} className="rounded border border-violet-200 bg-white px-1.5 py-0.5 text-violet-700" title={path}>
                          {path}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-amber-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-amber-700">{tx('实验 Run', 'Experiment Run')}</div>
                  {focusedNodeRun || focusedStory?.runSummary ? (
                    <>
                      <div className="mt-1 text-sm text-slate-900">
                        {storyRunNotExecuted
                          ? tx('当前节点未执行真实实验，先完成前置规划或切换执行模式。', 'This node has not executed a real experiment yet; finish prerequisites or switch execution mode.')
                          : tx('已启动实验 run 并返回结果。', 'Experiment run has been launched and produced results.')}
                      </div>
                      {focusedNodeRun ? (
                        <>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold">{focusedNodeRun.nodeRunId}</span>
                            <span className={`rounded px-1.5 py-0.5 ${statusBadgeClass(focusedNodeRun.status)}`}>{focusedNodeRun.status || 'UNKNOWN'}</span>
                          </div>
                          <div className="mt-1 grid gap-1 text-[11px] text-slate-600 sm:grid-cols-2">
                            <div><span className="font-semibold">{tx('启动', 'Started')}: </span>{focusedNodeRun.startedAt ? new Date(focusedNodeRun.startedAt).toLocaleString() : '-'}</div>
                            <div><span className="font-semibold">{tx('结束', 'Finished')}: </span>{focusedNodeRun.finishedAt ? new Date(focusedNodeRun.finishedAt).toLocaleString() : tx('进行中', 'Running')}</div>
                          </div>
                          {focusedNodeRun.validationCommand && (
                            <div className="mt-1 text-[11px] text-slate-700">
                              <span className="font-semibold">{tx('校验命令', 'Validation')}: </span>
                              <code className="rounded bg-slate-100 px-1 py-0.5">{focusedNodeRun.validationCommand}</code>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="mt-1 text-[11px] text-slate-700">
                          {focusedStory?.runSummary || tx('暂无实验摘要。', 'No experiment summary yet.')}
                        </div>
                      )}
                      {!!focusedStory?.decisionSummary && (
                        <div className="mt-1 text-[11px] text-amber-800">
                          <span className="font-semibold">{tx('下一步决策', 'Decision')}: </span>
                          {focusedStory.decisionSummary}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mt-1 text-sm text-slate-700">
                        {tx('当前分支还没有启动实验 run。', 'No experiment run has started for this branch yet.')}
                      </div>
                      <button
                        type="button"
                        onClick={() => runExecutionAction('next')}
                        disabled={isActionBusy}
                        className="mt-2 inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        <Play className="mr-1 h-3.5 w-3.5" />
                        {tx('启动一次实验', 'Start one experiment run')}
                      </button>
                    </>
                  )}
                  {focusedSuggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                      {focusedSuggestions.map((item, idx) => (
                        <span key={`focused-suggestion-chip-${idx}`} className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('证据到结论链', 'Evidence to Conclusion Chain')}</h2>
              {focusedBranch && (
                <button
                  type="button"
                  onClick={() => openNodeEvidence(focusedBranch.nodeId)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {tx('节点详情', 'Node detail')}
                </button>
              )}
            </div>

            {!focusedBranch ? (
              <div className="mt-2 text-sm text-slate-500">{tx('先选择一个分支查看证据链。', 'Select a branch to inspect evidence chain.')}</div>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{tx('分支结论状态', 'Branch outcome state')}</div>
                  <div className="mt-1 flex items-center gap-2 text-sm text-slate-900">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>{focusedBranch.lastSignal}</span>
                  </div>
                </div>

                {focusedNodeRun ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-xs text-slate-700">
                    <div className="font-semibold text-emerald-700">{tx('最近一次执行产物', 'Latest execution artifact')}</div>
                    <div className="mt-1">{tx('变更文件', 'Diff files')}: {focusedNodeRun.diffFiles}</div>
                    <div>{tx('命中目标', 'Resolved targets')}: {focusedNodeRun.resolvedTargets}</div>
                    <div>{tx('未命中目标', 'Unresolved targets')}: {focusedNodeRun.unresolvedTargets}</div>
                    <div>{tx('语法失败', 'Syntax failed')}: {focusedNodeRun.syntaxFailed}</div>
                    {focusedNodeRun.changeSummary && (
                      <div className="mt-1">
                        <span className="font-semibold">{tx('改动摘要', 'Change summary')}: </span>
                        {focusedNodeRun.changeSummary}
                      </div>
                    )}
                    {focusedNodeRun.targetFiles.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {focusedNodeRun.targetFiles.slice(0, 4).map(path => (
                          <span key={`focused-run-target-${path}`} className="rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-emerald-700" title={path}>
                            {path}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                    {tx('该分支暂未产出 node-run 证据。', 'No node-run artifacts available for this branch yet.')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('活跃分支导航', 'Active Branch Navigator')}</h2>
            {branchRows.length === 0 ? (
              <div className="mt-2 text-sm text-slate-500">{tx('暂无分支。', 'No branches yet.')}</div>
            ) : (
              <div className="mt-2 space-y-2">
                {branchRows.slice(0, 10).map(row => {
                  const active = row.nodeId === focusedBranch?.nodeId;
                  return (
                    <button
                      type="button"
                      key={`branch-nav-${row.nodeId}`}
                      onClick={() => setFocusedNodeId(row.nodeId)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                        active
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800">{row.nodeId}</span>
                        <span className={`rounded px-1.5 py-0.5 ${statusBadgeClass(row.status)}`}>{row.status}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                        {row.nodeFunctions.map(kind => (
                          <span key={`branch-nav-kind-${row.nodeId}-${kind}`} className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-slate-600">
                            {kind === 'code' ? tx('代码', 'Code') : kind === 'experiment' ? tx('实验', 'Experiment') : tx('规划', 'Plan')}
                          </span>
                        ))}
                        <span className={`rounded border px-1 py-0.5 ${row.llmEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                          {row.llmEnabled ? 'LLM on' : 'LLM off'}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-slate-700">{row.hypothesis || row.title}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="space-y-2 text-xs">
              <div className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Compass className="mr-1 h-3.5 w-3.5" />
                {tx('边界约束', 'Safety boundaries')}
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                <span className="font-semibold text-slate-700">{tx('合规', 'Compliance')}: </span>
                <span className="text-slate-600">{mission.compliance.slice(0, 2).join(', ') || '-'}</span>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                <span className="font-semibold text-slate-700">{tx('禁止动作', 'Forbidden actions')}: </span>
                <span className="text-slate-600">{mission.forbiddenActions.slice(0, 2).join(', ') || '-'}</span>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
                <GitBranch className="mr-1 inline h-3.5 w-3.5" />
                {tx('分支状态', 'Branch state')}: {runStats.running}/{runStats.pending + runStats.retryPending}/{runStats.blocked}
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
                <Activity className="mr-1 inline h-3.5 w-3.5" />
                {tx('过程步数', 'Process steps')}: {processSteps.length}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-600">
            {tx('展开：完整分支板', 'Expand: Full Branch Board')} ({branchRows.length})
          </summary>
          <div className="mt-3 space-y-2">
            {branchRows.length === 0 && <div className="text-sm text-slate-500">{tx('暂无分支。', 'No branches yet.')}</div>}
            {branchRows.slice(0, 24).map(row => (
              <div key={`branch-full-${row.nodeId}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-800">{row.nodeId}</span>
                  <span className={`rounded px-1.5 py-0.5 ${statusBadgeClass(row.status)}`}>{row.status}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                  {row.nodeFunctions.map(kind => (
                    <span key={`branch-full-kind-${row.nodeId}-${kind}`} className="rounded border border-slate-200 bg-white px-1 py-0.5 text-slate-600">
                      {kind === 'code' ? tx('代码节点', 'Code Node') : kind === 'experiment' ? tx('实验节点', 'Experiment Node') : tx('规划节点', 'Planning Node')}
                    </span>
                  ))}
                </div>
                <div className="mt-1 text-sm text-slate-800">{row.hypothesis || row.title}</div>
                <div className="mt-1 text-xs text-slate-600">{row.lastSignal}</div>
              </div>
            ))}
          </div>
        </details>

        <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-600">
            {tx('展开：完整过程时间线', 'Expand: Full Process Timeline')} ({processSteps.length})
          </summary>
          <div className="mt-3 max-h-[26rem] space-y-2 overflow-auto pr-1">
            {processSteps.length === 0 && (
              <div className="text-sm text-slate-500">{tx('暂无过程记录。', 'No process records yet.')}</div>
            )}
            {processSteps.map(step => (
              <div key={step.id} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${phaseBadgeClass(step.phase)}`}>
                    {phaseLabel(step.phase, tx)}
                  </span>
                  <span className="text-[11px] text-slate-500">{step.ts ? new Date(step.ts).toLocaleTimeString() : '-'}</span>
                </div>
                <div className="mt-1 text-xs font-medium text-slate-900">{step.headline}</div>
                <div className="mt-0.5 text-xs text-slate-700">{step.detail}</div>
              </div>
            ))}
          </div>
        </details>

        <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-600">
            {tx('展开：系统视角', 'Expand: System Lens')}
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <BrainCircuit className="mr-1 h-3.5 w-3.5" />
                {tx('LLM 角色负载', 'LLM role load')}
              </div>
              <div className="mt-2 space-y-1.5">
                {llmSummary.topRoles.length === 0 && <div className="text-xs text-slate-500">-</div>}
                {llmSummary.topRoles.map(row => (
                  <div key={`llm-role-${row.role}`} className="flex items-center justify-between rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs">
                    <span className="truncate text-violet-800" title={row.role}>{row.role}</span>
                    <span className="font-semibold text-violet-700">{row.total} / {row.failed}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tx('关键策略转向', 'Key Strategy Turns')}</div>
              <div className="mt-2 space-y-1.5">
                {strategyTurns.length === 0 && <div className="text-xs text-slate-500">{tx('暂无明显策略转向。', 'No strategy turns yet.')}</div>}
                {strategyTurns.slice(0, 8).map(turn => (
                  <div key={`decision-turn-${turn.id}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded border px-1.5 py-0.5 font-semibold ${strategyTurnToneClass(turn.cause)}`}>
                        {strategyTurnLabel(turn.cause, tx)}
                      </span>
                      <span className="text-[10px] text-slate-500">{turn.nodeId || '-'}</span>
                    </div>
                    <div className="mt-1 font-semibold text-slate-800">{turn.trigger}</div>
                    <div className="mt-1 grid gap-1 text-[11px] text-slate-600">
                      <div><span className="font-semibold">{tx('转向前', 'Before')}: </span>{turn.before}</div>
                      <div><span className="font-semibold">{tx('转向后', 'After')}: </span>{turn.after}</div>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">{turn.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>
      </section>

      {message && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </section>
      )}
    </div>
  );
};

export default AgenticLab;
