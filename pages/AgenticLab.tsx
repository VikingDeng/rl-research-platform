import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, Bot, Gauge, GitBranch, Layers3, Play, RefreshCcw, ShieldAlert, Sparkles } from 'lucide-react';
import { api, isDemoMode } from '../services/api';
import { useI18n } from '../services/i18n';
import type { AgenticNode, AgenticNodeRunRecord, AgenticRunDetail, AgenticRunSummary } from '../types';

type SearchMeta = {
  depth: number;
  visits: number;
  value: number;
  frontierScore: number;
  selectedCount: number;
};

type EventRow = {
  idx: number;
  ts: string;
  event: string;
  nodeId: string;
  depth: number;
  summary: string;
  mutationKind: string;
  childCount: number;
};

type FrontierRow = {
  nodeId: string;
  title: string;
  status: string;
  depth: number;
  visits: number;
  frontier: number;
  value: number;
  evidence: number;
  mutationKind: string;
  scoreFrontier: number;
  scoreValue: number;
  scoreEvidence: number;
  scoreUrgency: number;
  score: number;
  patchStrategy: string;
  patchSummary: string;
  patchFiles: string[];
  validationCommand: string;
};

type NodeRunEvidence = {
  nodeRunId: string;
  finishedAtMs: number;
  diffFiles: number;
  resolvedTargets: number;
  unresolvedTargets: number;
  syntaxFailed: number;
};

type NodePatchPlan = {
  strategy: string;
  mutationKind: string;
  changeSummary: string;
  targetFiles: string[];
  validationCommand: string;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const normalizeLlmIssue = (raw: string, tx: (zh: string, en: string) => string): string => {
  const detail = String(raw || '');
  if (detail.includes('llm_required_missing_api_key')) {
    return tx(
      '未配置 LLM API Key（AGENTIC_LLM_API_KEY）。请先在后端环境变量中配置，再重试。',
      'LLM API key is missing (AGENTIC_LLM_API_KEY). Configure backend env and retry.',
    );
  }
  if (detail.includes('llm_required_missing_model')) {
    return tx(
      '未配置 LLM 模型（AGENTIC_LLM_MODEL）。请先配置模型名，再重试。',
      'LLM model is missing (AGENTIC_LLM_MODEL). Configure model and retry.',
    );
  }
  if (detail.includes('llm_required_missing_provider')) {
    return tx(
      '未配置 LLM Provider（AGENTIC_LLM_PROVIDER）。请先配置 provider，再重试。',
      'LLM provider is missing (AGENTIC_LLM_PROVIDER). Configure provider and retry.',
    );
  }
  if (detail.includes('llm_required_')) {
    return tx(
      `LLM 核心链路校验失败：${detail}`,
      `LLM core-chain check failed: ${detail}`,
    );
  }
  return detail;
};

const statusBadgeClass = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'SUCCEEDED') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'FAILED') return 'bg-rose-100 text-rose-700';
  if (normalized === 'BLOCKED') return 'bg-amber-100 text-amber-700';
  if (normalized === 'RUNNING') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-600';
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

const getNodeMutationKind = (node: AgenticNode): string => {
  const plan = extractNodePatchPlan(node);
  if (plan?.mutationKind) return String(plan.mutationKind).toLowerCase();
  return 'code';
};

const extractNodePatchPlan = (node: AgenticNode): NodePatchPlan | null => {
  const evidence = asRecord(node.evidence);
  const expansion = asRecord(evidence.expansion);
  const mutationPlan = expansion.mutationPlan;
  const first = Array.isArray(mutationPlan) ? asRecord(mutationPlan[0]) : asRecord(mutationPlan);
  if (Object.keys(first).length === 0) return null;
  const targetFiles = Array.isArray(first.targetFiles)
    ? first.targetFiles.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  return {
    strategy: String(first.strategy || '').trim(),
    mutationKind: String(first.mutationKind || 'code').trim().toLowerCase() || 'code',
    changeSummary: String(first.changeSummary || '').trim(),
    targetFiles,
    validationCommand: String(first.validationCommand || '').trim(),
  };
};

const extractNodeRunEvidence = (run: AgenticNodeRunRecord): NodeRunEvidence => {
  const metrics = asRecord(run.metrics);
  const artifacts = asRecord(metrics.nodeRunArtifacts);
  const toCount = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };
  const finishedAtMs = Date.parse(String(run.finishedAt || run.startedAt || ''));
  return {
    nodeRunId: String(run.nodeRunId || ''),
    finishedAtMs: Number.isFinite(finishedAtMs) ? finishedAtMs : 0,
    diffFiles: toCount(artifacts.diffFiles),
    resolvedTargets: toCount(artifacts.resolvedTargets),
    unresolvedTargets: toCount(artifacts.unresolvedTargets),
    syntaxFailed: toCount(artifacts.pythonSyntaxFailed),
  };
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const eventTone = (event: string) => {
  const e = String(event || '').toLowerCase();
  if (e === 'tot_node_expanded') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (e === 'search_node_selected') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (e.includes('failed') || e.includes('error')) return 'bg-rose-50 text-rose-700 border-rose-200';
  if (e.includes('succeed')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
};

export const AgenticLab: React.FC = () => {
  const navigate = useNavigate();
  const { tx } = useI18n();

  const [runs, setRuns] = useState<AgenticRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [detail, setDetail] = useState<AgenticRunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [busyAction, setBusyAction] = useState<'none' | 'next' | 'all' | 'recover'>('none');
  const [message, setMessage] = useState('');
  const [selectedFrontierNodeId, setSelectedFrontierNodeId] = useState('');

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
          && (prev.llmTraces?.length || 0) === (payload.llmTraces?.length || 0);
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

  const runStats = useMemo(() => {
    const stats = { total: nodes.length, pending: 0, running: 0, blocked: 0, failed: 0, succeeded: 0 };
    nodes.forEach(node => {
      const status = String(node.status || '').toUpperCase();
      if (status === 'SUCCEEDED') stats.succeeded += 1;
      else if (status === 'FAILED') stats.failed += 1;
      else if (status === 'BLOCKED') stats.blocked += 1;
      else if (status === 'RUNNING') stats.running += 1;
      else stats.pending += 1;
    });
    return stats;
  }, [nodes]);

  const searchStats = detail?.searchStats || null;

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
      const role = String(trace.role || 'unknown').trim() || 'unknown';
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

  const depthDistribution = useMemo(() => {
    const map = new Map<number, number>();
    nodes.forEach(node => {
      const depth = Number(getSearchMeta(node).depth || 0);
      map.set(depth, (map.get(depth) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([depth, count]) => ({ depth, count }))
      .sort((a, b) => a.depth - b.depth);
  }, [nodes]);

  const mutationDistribution = useMemo(() => {
    const map = new Map<string, number>();
    nodes.forEach(node => {
      const kind = getNodeMutationKind(node);
      map.set(kind, (map.get(kind) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  }, [nodes]);

  const frontierQueue = useMemo(() => {
    const rows = nodes
      .filter(node => {
        const status = String(node.status || '').toUpperCase();
        return status === 'PENDING' || status === 'RUNNING' || status === 'RETRY_PENDING';
      })
      .map(node => {
        const search = getSearchMeta(node);
        const runEvidence = nodeRunEvidenceByNode.get(node.nodeId);
        const plan = extractNodePatchPlan(node);
        const evidenceSignal = runEvidence
          ? clamp01((runEvidence.diffFiles * 0.28 + runEvidence.resolvedTargets * 0.35 - runEvidence.unresolvedTargets * 0.18 - runEvidence.syntaxFailed * 0.2) / 3)
          : 0;
        const status = String(node.status || '').toUpperCase();
        const urgency = status === 'RUNNING' ? 0.12 : status === 'RETRY_PENDING' ? 0.08 : 0;
        const scoreFrontier = search.frontierScore * 0.56;
        const scoreValue = search.value * 0.18;
        const scoreEvidence = evidenceSignal * 0.2;
        const scoreUrgency = urgency;
        return {
          nodeId: node.nodeId,
          title: node.title || node.nodeId,
          status,
          depth: Number(search.depth || 0),
          visits: Number(search.visits || 0),
          frontier: clamp01(Number(search.frontierScore || 0)),
          value: clamp01(Number(search.value || 0)),
          evidence: evidenceSignal,
          mutationKind: String(plan?.mutationKind || getNodeMutationKind(node) || 'code').toLowerCase(),
          scoreFrontier,
          scoreValue,
          scoreEvidence,
          scoreUrgency,
          score: scoreFrontier + scoreValue + scoreEvidence + scoreUrgency,
          patchStrategy: String(plan?.strategy || ''),
          patchSummary: String(plan?.changeSummary || ''),
          patchFiles: Array.isArray(plan?.targetFiles) ? plan.targetFiles : [],
          validationCommand: String(plan?.validationCommand || ''),
        } as FrontierRow;
      })
      .sort((a, b) => b.score - a.score || b.frontier - a.frontier || a.depth - b.depth || a.nodeId.localeCompare(b.nodeId));
    return rows.slice(0, 12);
  }, [nodes, nodeRunEvidenceByNode]);

  useEffect(() => {
    if (frontierQueue.length === 0) {
      setSelectedFrontierNodeId('');
      return;
    }
    if (!selectedFrontierNodeId || !frontierQueue.some(item => item.nodeId === selectedFrontierNodeId)) {
      setSelectedFrontierNodeId(frontierQueue[0].nodeId);
    }
  }, [frontierQueue, selectedFrontierNodeId]);

  const selectedFrontier = useMemo(
    () => frontierQueue.find(item => item.nodeId === selectedFrontierNodeId) || frontierQueue[0] || null,
    [frontierQueue, selectedFrontierNodeId],
  );

  const eventRows = useMemo(() => {
    const rows = Array.isArray(detail?.events) ? detail.events : [];
    const selected = rows
      .map((raw, idx) => {
        const row = asRecord(raw);
        const event = String(row.event || '').trim();
        if (!event) return null;
        const payload = asRecord(row.payload);
        const nodeId = String(payload.nodeId || payload.node_id || '').trim();
        const node = nodeId ? nodeById.get(nodeId) : null;
        const childIds = Array.isArray(payload.childIds)
          ? payload.childIds.map(item => String(item || '').trim()).filter(Boolean)
          : [];
        const mutations = Array.isArray(payload.mutations) ? payload.mutations : [];
        const firstMutation = asRecord(mutations[0]);
        const depth = Number(payload.depth || (node ? getSearchMeta(node).depth : 0) || 0);
        const mutationKind = String(firstMutation.mutationKind || (node ? getNodeMutationKind(node) : '') || '').trim().toLowerCase();
        const summary = String(row.message || event);
        return {
          idx,
          ts: String(row.ts || ''),
          event,
          nodeId,
          depth,
          summary,
          mutationKind: mutationKind || '-',
          childCount: childIds.length,
        } as EventRow;
      })
      .filter((item): item is EventRow => !!item)
      .filter(item => {
        const e = item.event.toLowerCase();
        return (
          e === 'search_node_selected'
          || e === 'tot_node_expanded'
          || e === 'node_succeeded'
          || e === 'node_failed'
          || e === 'sub_agent_started'
          || e === 'sub_agent_failed'
          || e === 'sub_agent_succeeded'
        );
      });

    return selected.slice(-80).reverse();
  }, [detail?.events, nodeById]);

  const selectedNode = useMemo(() => {
    if (!selectedFrontier?.nodeId) return null;
    return nodeById.get(selectedFrontier.nodeId) || null;
  }, [selectedFrontier?.nodeId, nodeById]);

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

  const selectedRunSummary = useMemo(() => runs.find(item => item.runId === selectedRunId) || null, [runs, selectedRunId]);
  const isActionBusy = busyAction !== 'none' || loadingRun;

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_0%_0%,rgba(37,99,235,.12),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(14,165,233,.12),transparent_34%),linear-gradient(180deg,rgba(248,250,252,.96),rgba(255,255,255,.98))] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-700">
              <Activity className="mr-1.5 h-3.5 w-3.5 text-sky-600" />
              {tx('探索洞察专页', 'Exploration Insights')}
            </div>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">{tx('Agentic Search Intelligence Workbench', 'Agentic Search Intelligence Workbench')}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {tx(
                '这里不再展示主树图，专注回答三个问题：当前在探索什么、为何扩展该节点、证据链质量如何。',
                'This page does not render the main tree; it focuses on three questions: what is being explored, why this node is next, and how strong the evidence chain is.',
              )}
            </p>
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
            {tx('Search Step', 'Search Step')}
          </button>
          <button
            type="button"
            onClick={() => runExecutionAction('all')}
            disabled={!selectedRunId || isActionBusy}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {tx('Auto Search', 'Auto Search')}
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
            onClick={() => navigate('/agentic')}
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-700 hover:bg-sky-100"
          >
            {tx('打开 ToT 主画布', 'Open ToT Canvas')}
          </button>
          <button
            type="button"
            onClick={() => selectedRunId && navigate(`/agentic/runs/${encodeURIComponent(selectedRunId)}/agents`)}
            disabled={!selectedRunId}
            className="inline-flex items-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            <Bot className="mr-1.5 h-4 w-4" />
            {tx('Agent 面板', 'Agent Panel')}
          </button>
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">{tx('Tree', 'Tree')}</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{runStats.total}</div>
          <div className="text-[11px] text-slate-600">D{searchStats?.maxDepth || 0} · {tx('覆盖', 'Coverage')} {Math.round((searchStats?.explorationCoverage || 0) * 100)}%</div>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-blue-700">{tx('Frontier', 'Frontier')}</div>
          <div className="mt-1 text-lg font-semibold text-blue-900">{frontierQueue.length}</div>
          <div className="text-[11px] text-blue-700">{tx('Top', 'Top')} {selectedFrontier ? selectedFrontier.nodeId : '-'}</div>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-violet-700">LLM</div>
          <div className="mt-1 text-lg font-semibold text-violet-900">{llmSummary.total}</div>
          <div className="text-[11px] text-violet-700">{tx('失败', 'Failed')} {llmSummary.failed} · {llmSummary.avgLatencyMs}ms</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-emerald-700">{tx('Evidence', 'Evidence')}</div>
          <div className="mt-1 text-lg font-semibold text-emerald-900">{detail?.nodeRuns?.length || 0}</div>
          <div className="text-[11px] text-emerald-700">{tx('合同通过率', 'Contract')} {Math.round((selectedRunSummary?.contractPassRate || 0) * 100)}%</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">{tx('Status', 'Status')}</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{runStats.succeeded}/{runStats.failed}/{runStats.blocked}</div>
          <div className="text-[11px] text-slate-600">{tx('成功/失败/阻塞', 'Succeeded/Failed/Blocked')}</div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-sky-700">{tx('为什么是这个节点', 'Why This Node Next')}</h2>
              {selectedFrontier && (
                <button
                  type="button"
                  onClick={() => openNodeEvidence(selectedFrontier.nodeId)}
                  className="inline-flex items-center rounded-md border border-sky-300 bg-white px-2 py-1 text-xs text-sky-700 hover:bg-sky-100"
                >
                  {tx('证据页', 'Evidence')} <ArrowRight className="ml-1 h-3 w-3" />
                </button>
              )}
            </div>
            {!selectedFrontier ? (
              <div className="mt-2 text-sm text-slate-500">{tx('暂无可探索前沿节点。', 'No frontier nodes available.')}</div>
            ) : (
              <>
                <div className="mt-2 text-sm font-semibold text-slate-900">{selectedFrontier.nodeId} · {selectedFrontier.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className={`rounded px-2 py-1 ${statusBadgeClass(selectedFrontier.status)}`}>{selectedFrontier.status}</span>
                  <span className="rounded bg-white px-2 py-1">{tx('深度', 'Depth')} {selectedFrontier.depth}</span>
                  <span className="rounded bg-white px-2 py-1">{tx('访问', 'Visits')} {selectedFrontier.visits}</span>
                  <span className="rounded bg-white px-2 py-1">{tx('变更', 'Mutation')} {selectedFrontier.mutationKind.toUpperCase()}</span>
                  {selectedFrontier.patchStrategy && (
                    <span className="rounded bg-white px-2 py-1">{tx('策略', 'Strategy')} {selectedFrontier.patchStrategy}</span>
                  )}
                  <span className="rounded bg-sky-100 px-2 py-1 font-semibold text-sky-700">{tx('总分', 'Score')} {selectedFrontier.score.toFixed(2)}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-sky-200 bg-white px-2.5 py-2">
                    <div className="text-[11px] font-semibold text-sky-700">Frontier</div>
                    <div className="mt-0.5 text-xs text-slate-700">{Math.round(selectedFrontier.frontier * 100)} · +{selectedFrontier.scoreFrontier.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-white px-2.5 py-2">
                    <div className="text-[11px] font-semibold text-sky-700">Value</div>
                    <div className="mt-0.5 text-xs text-slate-700">{Math.round(selectedFrontier.value * 100)} · +{selectedFrontier.scoreValue.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-white px-2.5 py-2">
                    <div className="text-[11px] font-semibold text-sky-700">Evidence</div>
                    <div className="mt-0.5 text-xs text-slate-700">{Math.round(selectedFrontier.evidence * 100)} · +{selectedFrontier.scoreEvidence.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-white px-2.5 py-2">
                    <div className="text-[11px] font-semibold text-sky-700">Urgency</div>
                    <div className="mt-0.5 text-xs text-slate-700">+{selectedFrontier.scoreUrgency.toFixed(2)}</div>
                  </div>
                </div>
                {selectedFrontier.patchSummary && (
                  <div className="mt-2 text-xs text-slate-800">
                    <span className="font-semibold">{tx('代码改动摘要', 'Code change summary')}: </span>
                    {selectedFrontier.patchSummary}
                  </div>
                )}
                {selectedFrontier.patchFiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-700">{tx('目标文件', 'Target files')}</span>
                    {selectedFrontier.patchFiles.slice(0, 4).map((path, idx) => (
                      <span key={`frontier-patch-file-${idx}-${path}`} className="rounded border border-sky-200 bg-white px-2 py-0.5 text-sky-700" title={path}>
                        {path}
                      </span>
                    ))}
                  </div>
                )}
                {selectedFrontier.validationCommand && (
                  <div className="mt-1 text-[11px] text-slate-700">
                    <span className="font-semibold">{tx('校验命令', 'Validation command')}: </span>
                    <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">{selectedFrontier.validationCommand}</code>
                  </div>
                )}
                {selectedNode?.hypothesis && (
                  <div className="mt-2 text-xs text-slate-700">
                    <span className="font-semibold">{tx('假设', 'Hypothesis')}: </span>
                    {selectedNode.hypothesis}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('Frontier 队列', 'Frontier Queue')}</h2>
            {frontierQueue.length === 0 ? (
              <div className="mt-2 text-sm text-slate-500">{tx('当前没有待探索节点。', 'No pending exploration nodes at the moment.')}</div>
            ) : (
              <div className="mt-2 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-1 text-left">Node</th>
                      <th className="px-2 py-1 text-left">{tx('变更', 'Mutation')}</th>
                      <th className="px-2 py-1 text-left">Status</th>
                      <th className="px-2 py-1 text-right">F</th>
                      <th className="px-2 py-1 text-right">V</th>
                      <th className="px-2 py-1 text-right">EV</th>
                      <th className="px-2 py-1 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {frontierQueue.map(row => {
                      const active = row.nodeId === selectedFrontierNodeId;
                      return (
                        <tr
                          key={`frontier-row-${row.nodeId}`}
                          className={`border-t border-slate-100 ${active ? 'bg-sky-50' : 'bg-white hover:bg-slate-50'}`}
                          onClick={() => setSelectedFrontierNodeId(row.nodeId)}
                        >
                          <td className="px-2 py-1.5 font-medium text-slate-800">{row.nodeId}</td>
                          <td className="px-2 py-1.5 text-slate-600">
                            <span title={row.patchSummary || row.mutationKind}>
                              {row.mutationKind.toUpperCase()}
                              {row.patchFiles[0] ? ` · ${String(row.patchFiles[0]).split('/').pop()}` : ''}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={`rounded px-1.5 py-0.5 ${statusBadgeClass(row.status)}`}>{row.status}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-700">{Math.round(row.frontier * 100)}</td>
                          <td className="px-2 py-1.5 text-right text-slate-700">{Math.round(row.value * 100)}</td>
                          <td className="px-2 py-1.5 text-right text-slate-700">{Math.round(row.evidence * 100)}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-sky-700">{row.score.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('探索事件流', 'Exploration Event Stream')}</h2>
            <div className="mt-2 max-h-[26rem] space-y-2 overflow-auto pr-1">
              {eventRows.length === 0 && (
                <div className="text-sm text-slate-500">{tx('暂无探索事件。', 'No exploration events yet.')}</div>
              )}
              {eventRows.map(row => (
                <div key={`event-row-${row.idx}-${row.event}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${eventTone(row.event)}`}>{row.event}</span>
                    <span className="text-[11px] text-slate-500">{row.ts ? new Date(row.ts).toLocaleTimeString() : '-'}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-800">{row.summary}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                    {row.nodeId && <span className="rounded bg-white px-1.5 py-0.5">{row.nodeId}</span>}
                    <span className="rounded bg-white px-1.5 py-0.5">D{row.depth}</span>
                    <span className="rounded bg-white px-1.5 py-0.5">{row.mutationKind.toUpperCase()}</span>
                    {row.childCount > 0 && <span className="rounded bg-white px-1.5 py-0.5">+{row.childCount} {tx('子节点', 'children')}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Layers3 className="mr-1 h-3.5 w-3.5" />
                  {tx('深度分布', 'Depth Distribution')}
                </div>
                <div className="mt-2 space-y-1.5">
                  {depthDistribution.length === 0 && <div className="text-xs text-slate-500">-</div>}
                  {depthDistribution.map(row => {
                    const maxCount = Math.max(1, ...depthDistribution.map(item => item.count));
                    const pct = Math.round((row.count / maxCount) * 100);
                    return (
                      <div key={`depth-dist-${row.depth}`} className="text-xs">
                        <div className="flex items-center justify-between text-slate-600">
                          <span>D{row.depth}</span>
                          <span>{row.count}</span>
                        </div>
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-100">
                          <div className="h-full rounded bg-blue-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <GitBranch className="mr-1 h-3.5 w-3.5" />
                  {tx('变更分布', 'Mutation Distribution')}
                </div>
                <div className="mt-2 space-y-1.5">
                  {mutationDistribution.length === 0 && <div className="text-xs text-slate-500">-</div>}
                  {mutationDistribution.slice(0, 8).map(row => (
                    <div key={`mutation-dist-${row.kind}`} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                      <span className="font-medium text-slate-700">{row.kind.toUpperCase()}</span>
                      <span className="text-slate-600">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2">
                <div className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Gauge className="mr-1 h-3.5 w-3.5" />
                  {tx('LLM 角色负载', 'LLM Role Load')}
                </div>
                <div className="mt-2 grid gap-1.5">
                  {llmSummary.topRoles.length === 0 && <div className="text-xs text-slate-500">-</div>}
                  {llmSummary.topRoles.map(row => (
                    <div key={`llm-role-${row.role}`} className="flex items-center justify-between rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs">
                      <span className="truncate text-violet-800" title={row.role}>{row.role}</span>
                      <span className="font-semibold text-violet-700">{row.total} / {row.failed}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
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
