import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronUp, Pause, Play, RefreshCcw, ShieldAlert, SlidersHorizontal, Sparkles, WandSparkles } from 'lucide-react';
import { api, isDemoMode } from '../services/api';
import { useI18n } from '../services/i18n';
import type { AgenticIdeaInput, AgenticLlmTraceRecord, AgenticNode, AgenticNodeRunRecord, AgenticRunDetail, AgenticRunSummary } from '../types';

type GraphLayoutPoint = {
  nodeId: string;
  x: number;
  y: number;
  depth: number;
};

type SearchReplayEvent = {
  idx: number;
  event: string;
  ts: string;
  nodeId: string;
  summary: string;
  childIds: string[];
  mutations: Array<{
    nodeId: string;
    mutationKind: string;
    targetFiles: string[];
    strategy: string;
  }>;
};

type NodeMutationPlan = {
  strategy: string;
  mutationKind: string;
  changeSummary: string;
  targetFiles: string[];
  validationCommand: string;
  risk: string;
  source: string;
};

type NodeRunArtifactSummary = {
  nodeRunId: string;
  status: string;
  finishedAtMs: number;
  diffFiles: number;
  resolvedTargets: number;
  unresolvedTargets: number;
  pythonSyntaxFailed: number;
  mutationKind: string;
  changeSummary: string;
  targetFiles: string[];
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '').trim()).filter(Boolean);
};

const extractNodeMutationPlans = (node: AgenticNode): NodeMutationPlan[] => {
  const evidence = asRecord(node.evidence);
  const expansion = asRecord(evidence.expansion);
  const direct = expansion.mutationPlan;
  const rows = Array.isArray(direct) ? direct : direct ? [direct] : [];
  return rows
    .map(item => asRecord(item))
    .filter(item => Object.keys(item).length > 0)
    .map(item => ({
      strategy: String(item.strategy || 'code_mutation'),
      mutationKind: String(item.mutationKind || 'code').toLowerCase(),
      changeSummary: String(item.changeSummary || ''),
      targetFiles: asStringArray(item.targetFiles),
      validationCommand: String(item.validationCommand || ''),
      risk: String(item.risk || ''),
      source: String(item.source || expansion.strategy || 'node_expansion'),
    }));
};

const extractNodeRunArtifactSummary = (run: AgenticNodeRunRecord): NodeRunArtifactSummary => {
  const metrics = asRecord(run.metrics);
  const artifacts = asRecord(metrics.nodeRunArtifacts);
  const patchPlan = Array.isArray(run.patchPlan) ? run.patchPlan : [];
  const firstPlan = asRecord(patchPlan[0]);
  const diffPreviews = Array.isArray(artifacts.diffPreviews) ? artifacts.diffPreviews : [];
  const firstPreview = asRecord(diffPreviews[0]);
  const targetFiles = asStringArray(firstPlan.targetFiles).length > 0
    ? asStringArray(firstPlan.targetFiles)
    : asStringArray(firstPreview.targets);
  const mutationKind = String(firstPlan.mutationKind || firstPreview.mutationKind || 'code').toLowerCase();
  const changeSummary = String(firstPlan.changeSummary || firstPreview.changeSummary || '');

  const toCount = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };

  const finishedAtMs = Date.parse(String(run.finishedAt || run.startedAt || ''));
  return {
    nodeRunId: String(run.nodeRunId || ''),
    status: String(run.status || ''),
    finishedAtMs: Number.isFinite(finishedAtMs) ? finishedAtMs : 0,
    diffFiles: toCount(artifacts.diffFiles),
    resolvedTargets: toCount(artifacts.resolvedTargets),
    unresolvedTargets: toCount(artifacts.unresolvedTargets),
    pythonSyntaxFailed: toCount(artifacts.pythonSyntaxFailed),
    mutationKind,
    changeSummary,
    targetFiles,
  };
};

const mutationBadgeColors = (kind: string) => {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'architecture') return { fill: 'rgba(14,116,144,.14)', stroke: 'rgba(14,116,144,.42)', text: '#0e7490' };
  if (normalized === 'loss' || normalized === 'objective') return { fill: 'rgba(22,163,74,.14)', stroke: 'rgba(22,163,74,.4)', text: '#15803d' };
  if (normalized === 'integration' || normalized === 'ops') return { fill: 'rgba(217,119,6,.14)', stroke: 'rgba(217,119,6,.4)', text: '#b45309' };
  if (normalized === 'evaluation') return { fill: 'rgba(124,58,237,.14)', stroke: 'rgba(124,58,237,.4)', text: '#6d28d9' };
  return { fill: 'rgba(71,85,105,.14)', stroke: 'rgba(71,85,105,.35)', text: '#475569' };
};

const mutationTagClass = (kind: string) => {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'architecture') return 'bg-cyan-100 text-cyan-700';
  if (normalized === 'loss' || normalized === 'objective') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'integration' || normalized === 'ops') return 'bg-amber-100 text-amber-700';
  if (normalized === 'evaluation') return 'bg-violet-100 text-violet-700';
  return 'bg-slate-100 text-slate-700';
};

const statusBadgeClass = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'SUCCEEDED') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'FAILED') return 'bg-rose-100 text-rose-700';
  if (normalized === 'BLOCKED') return 'bg-amber-100 text-amber-700';
  if (normalized === 'RUNNING') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-600';
};

const statusDot = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'SUCCEEDED') return '#10b981';
  if (normalized === 'FAILED') return '#f43f5e';
  if (normalized === 'BLOCKED') return '#f59e0b';
  if (normalized === 'RUNNING') return '#2563eb';
  return '#94a3b8';
};

const parseMetricNumber = (raw: unknown): number | null => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw.replace(/[^\d.+-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const splitLines = (value: string, maxChars: number, maxLines: number) => {
  const rawTokens = String(value || '').split(/\s+/).filter(Boolean);
  const tokens = rawTokens.flatMap(token => {
    const chars = Array.from(token);
    if (chars.length <= maxChars) return [token];
    const chunks: string[] = [];
    for (let idx = 0; idx < chars.length; idx += maxChars) {
      chunks.push(chars.slice(idx, idx + maxChars).join(''));
    }
    return chunks;
  });
  if (tokens.length === 0) return ['-'];
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const next = current ? `${current} ${token}` : token;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = token;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  const hasOverflow = tokens.join(' ').length > lines.join(' ').length;
  if (hasOverflow && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
};

const extractExpectedWinRate = (node: AgenticNode): number => {
  const metrics = (node.expectedMetrics || {}) as Record<string, unknown>;
  const raw = metrics.winRate ?? metrics.win_rate ?? metrics.targetWinRate;
  const parsed = parseMetricNumber(raw);
  if (parsed === null) return 0.5;
  if (parsed > 1) return Math.min(1, parsed / 100);
  return Math.max(0, Math.min(1, parsed));
};

const getSearchMeta = (node: AgenticNode) => {
  const evidence = (node.evidence || {}) as Record<string, unknown>;
  const search = (evidence.search || {}) as Record<string, unknown>;
  const visits = Number(search.visits || 0);
  const value = Number(search.value || 0);
  const frontierScore = Number(search.frontierScore || 0);
  const depth = Number(search.depth || 0);
  const selectedCount = Number(search.selectedCount || 0);
  return {
    visits: Number.isFinite(visits) ? visits : 0,
    value: Number.isFinite(value) ? value : 0,
    frontierScore: Number.isFinite(frontierScore) ? frontierScore : 0,
    depth: Number.isFinite(depth) ? depth : 0,
    selectedCount: Number.isFinite(selectedCount) ? selectedCount : 0,
  };
};

const collectAncestorPath = (nodeById: Map<string, AgenticNode>, nodeId: string): Set<string> => {
  const path = new Set<string>();
  let cursor = String(nodeId || '').trim();
  let guard = 0;
  while (cursor && guard < 256) {
    if (path.has(cursor)) break;
    path.add(cursor);
    const parentId = String(nodeById.get(cursor)?.parentId || '').trim();
    if (!parentId) break;
    cursor = parentId;
    guard += 1;
  }
  return path;
};

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

const mctsLikeScore = (node: AgenticNode, parentBranching: number, childCount: number): number => {
  const expected = extractExpectedWinRate(node);
  const risk = String(node.risk || 'low').toLowerCase();
  const riskPenalty = risk === 'high' ? 0.24 : risk === 'medium' ? 0.12 : 0.02;
  const normalizedStatus = String(node.status || '').toUpperCase();
  const statusFactor = normalizedStatus === 'SUCCEEDED'
    ? 0.12
    : normalizedStatus === 'RUNNING'
    ? 0.06
    : normalizedStatus === 'FAILED'
    ? -0.18
    : normalizedStatus === 'BLOCKED'
    ? -0.22
    : 0;

  const exploration = Math.sqrt(Math.log(parentBranching + 2) / (childCount + 1));
  const blended = expected * 0.62 + exploration * 0.33 + statusFactor - riskPenalty;
  return Math.max(0, Math.min(1, blended));
};

const buildAutoScienceIdea = (): AgenticIdeaInput => ({
  title: 'Auto-Science Demo: Budgeted MARL Uplift',
  taskGoal: 'Find a robust branch that improves win-rate while keeping budget and safety constraints.',
  environment: 'pettingzoo.smac_v2:3s5z',
  dataSources: ['registry://baseline_runs', 'registry://historical_failures'],
  successMetrics: {
    winRate: '>=0.62',
    eloLift: '>=25',
  },
  budget: {
    gpuHours: 2,
    wallclockMinutes: 90,
  },
  constraints: {
    compliance: ['no_pii', 'no_external_data_push'],
    forbiddenActions: ['data_exfiltration'],
    allowNetwork: false,
    allowDependencyInstall: false,
  },
  executionMode: 'offline_stub',
  requestedActions: [],
});

export const AgenticTotCanvas: React.FC = () => {
  const navigate = useNavigate();
  const { tx } = useI18n();

  const [runs, setRuns] = useState<AgenticRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [detail, setDetail] = useState<AgenticRunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [busyAction, setBusyAction] = useState<'none' | 'next' | 'all' | 'recover'>('none');
  const [autoExploring, setAutoExploring] = useState(false);
  const [message, setMessage] = useState('');

  const [graphZoomPct, setGraphZoomPct] = useState(100);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [hoveredNodeId, setHoveredNodeId] = useState('');
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Record<string, boolean>>({});
  const [presentationMode, setPresentationMode] = useState(true);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [replayStep, setReplayStep] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayRevealMode, setReplayRevealMode] = useState(false);
  const [autoFollowLatest, setAutoFollowLatest] = useState(true);
  const [mutationFilter, setMutationFilter] = useState('all');
  const [branchViewMode, setBranchViewMode] = useState<'default' | 'evidence'>('default');
  const [spotlightMode, setSpotlightMode] = useState(true);
  const [treeOnlyMode, setTreeOnlyMode] = useState(true);
  const graphViewportRef = useRef<HTMLDivElement | null>(null);

  const selectedRunSummary = useMemo(() => runs.find(item => item.runId === selectedRunId) || null, [runs, selectedRunId]);

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
      if (!selectedRunId || !items.some(row => row.runId === selectedRunId)) {
        setSelectedRunId(items[0].runId);
      }
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setLoadingRuns(false);
    }
  }, [selectedRunId]);

  const loadRun = useCallback(async (runId: string, options?: { background?: boolean }) => {
    const background = !!options?.background;
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
          && (prev.timeline?.length || 0) === (payload.timeline?.length || 0);
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
    loadRun(selectedRunId, { background: false }).catch(() => undefined);
  }, [selectedRunId, loadRun]);

  useEffect(() => {
    if (!selectedRunId) return;
    if (autoExploring) return;
    const status = String(detail?.status || '').toUpperCase();
    if (status !== 'RUNNING' && status !== 'PENDING' && status !== 'BLOCKED') return;
    const intervalMs = status === 'BLOCKED' ? 10000 : 2500;
    const timer = window.setInterval(() => {
      loadRun(selectedRunId, { background: true }).catch(() => undefined);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [selectedRunId, detail?.status, loadRun, autoExploring]);

  useEffect(() => {
    if (selectedRunId) {
      setSelectedNodeId('');
      setHoveredNodeId('');
      setCollapsedNodeIds({});
      setReplayStep(0);
      setReplayPlaying(false);
      setAutoFollowLatest(true);
      setMutationFilter('all');
      setBranchViewMode('default');
      setSpotlightMode(true);
      setTreeOnlyMode(true);
    }
  }, [selectedRunId]);

  const nodes = useMemo(() => (Array.isArray(detail?.totTree) ? detail?.totTree : []), [detail]);
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.nodeId, node])), [nodes]);

  const childCountByParent = useMemo(() => {
    const map = new Map<string, number>();
    nodes.forEach(node => {
      if (!node.parentId) return;
      map.set(node.parentId, (map.get(node.parentId) || 0) + 1);
    });
    return map;
  }, [nodes]);

  const latestNodeRunByNode = useMemo(() => {
    const map = new Map<string, NodeRunArtifactSummary>();
    const rows = Array.isArray(detail?.nodeRuns) ? detail.nodeRuns : [];
    rows.forEach(run => {
      const nodeId = String(run.nodeId || '').trim();
      if (!nodeId) return;
      const summary = extractNodeRunArtifactSummary(run);
      const existing = map.get(nodeId);
      if (!existing || summary.finishedAtMs >= existing.finishedAtMs) {
        map.set(nodeId, summary);
      }
    });
    return map;
  }, [detail?.nodeRuns]);

  const resolveNodeMutationKind = useCallback((node: AgenticNode) => {
    const fromPlan = String(extractNodeMutationPlans(node)[0]?.mutationKind || '').trim().toLowerCase();
    if (fromPlan) return fromPlan;
    const fromNodeRun = String(latestNodeRunByNode.get(node.nodeId)?.mutationKind || '').trim().toLowerCase();
    return fromNodeRun;
  }, [latestNodeRunByNode]);

  const mutationFilterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach(node => {
      const kind = resolveNodeMutationKind(node);
      if (!kind) return;
      counts.set(kind, (counts.get(kind) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  }, [nodes, resolveNodeMutationKind]);

  useEffect(() => {
    if (mutationFilter === 'all') return;
    if (mutationFilterOptions.some(item => item.kind === mutationFilter)) return;
    setMutationFilter('all');
  }, [mutationFilter, mutationFilterOptions]);

  const filteredNodes = useMemo(() => {
    if (mutationFilter === 'all') return nodes;
    const target = String(mutationFilter || '').trim().toLowerCase();
    if (!target) return nodes;
    const included = new Set<string>();
    nodes.forEach(node => {
      const kind = resolveNodeMutationKind(node);
      if (kind !== target) return;
      included.add(node.nodeId);
      let parentId = node.parentId || null;
      while (parentId) {
        included.add(parentId);
        parentId = nodeById.get(parentId)?.parentId || null;
      }
    });
    return nodes.filter(node => included.has(node.nodeId));
  }, [nodes, nodeById, mutationFilter, resolveNodeMutationKind]);
  const evidenceScoreByNode = useMemo(() => {
    const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
    const map = new Map<string, number>();
    nodes.forEach(node => {
      const runSummary = latestNodeRunByNode.get(node.nodeId);
      const diffFiles = Number(runSummary?.diffFiles || 0);
      const resolvedTargets = Number(runSummary?.resolvedTargets || 0);
      const unresolvedTargets = Number(runSummary?.unresolvedTargets || 0);
      const syntaxFailed = Number(runSummary?.pythonSyntaxFailed || 0);
      const runRaw = diffFiles * 0.28 + resolvedTargets * 0.35 - unresolvedTargets * 0.18 - syntaxFailed * 0.22;
      const runSignal = clamp01(runRaw / 3.2);

      const mutationPlans = extractNodeMutationPlans(node);
      const planSignal = mutationPlans.length > 0 ? clamp01(0.45 + mutationPlans[0].targetFiles.length * 0.08) : 0;

      const status = String(node.status || '').toUpperCase();
      const statusSignal = status === 'SUCCEEDED' ? 1 : status === 'RUNNING' ? 0.72 : status === 'PENDING' ? 0.42 : status === 'FAILED' ? 0.2 : 0.3;

      const search = getSearchMeta(node);
      const searchSignal = clamp01((Number(search.frontierScore || 0) + Number(search.value || 0)) * 0.5);

      const score = clamp01(runSignal * 0.45 + planSignal * 0.2 + statusSignal * 0.2 + searchSignal * 0.15);
      map.set(node.nodeId, score);
    });
    return map;
  }, [nodes, latestNodeRunByNode]);

  const filteredNodeMap = useMemo(() => new Map(filteredNodes.map(node => [node.nodeId, node])), [filteredNodes]);
  const filteredChildCountByParent = useMemo(() => {
    const map = new Map<string, number>();
    filteredNodes.forEach(node => {
      if (!node.parentId || !filteredNodeMap.has(node.parentId)) return;
      map.set(node.parentId, (map.get(node.parentId) || 0) + 1);
    });
    return map;
  }, [filteredNodes, filteredNodeMap]);
  const filteredChildrenByParent = useMemo(() => {
    const map = new Map<string, AgenticNode[]>();
    filteredNodes.forEach(node => {
      if (!node.parentId || !filteredNodeMap.has(node.parentId)) return;
      const group = map.get(node.parentId) || [];
      group.push(node);
      map.set(node.parentId, group);
    });
    return map;
  }, [filteredNodes, filteredNodeMap]);
  const visibleNodes = useMemo(() => {
    return filteredNodes.filter(node => {
      let parentId = node.parentId || null;
      while (parentId) {
        if (collapsedNodeIds[parentId] && filteredNodeMap.has(parentId)) return false;
        parentId = filteredNodeMap.get(parentId)?.parentId || null;
      }
      return true;
    });
  }, [filteredNodes, filteredNodeMap, collapsedNodeIds]);
  const visibleNodeMap = useMemo(() => new Map(visibleNodes.map(node => [node.nodeId, node])), [visibleNodes]);
  const visibleChildCountByParent = useMemo(() => {
    const map = new Map<string, number>();
    visibleNodes.forEach(node => {
      if (!node.parentId || !visibleNodeMap.has(node.parentId)) return;
      map.set(node.parentId, (map.get(node.parentId) || 0) + 1);
    });
    return map;
  }, [visibleNodes, visibleNodeMap]);
  const descendantCountByNode = useMemo(() => {
    const memo = new Map<string, number>();
    const countDescendants = (nodeId: string): number => {
      if (memo.has(nodeId)) return memo.get(nodeId) || 0;
      const children = filteredChildrenByParent.get(nodeId) || [];
      const count = children.reduce((acc, child) => acc + 1 + countDescendants(child.nodeId), 0);
      memo.set(nodeId, count);
      return count;
    };
    filteredNodes.forEach(node => {
      countDescendants(node.nodeId);
    });
    return memo;
  }, [filteredChildrenByParent, filteredNodes]);

  const graph = useMemo(() => {
    const laneWidth = 264;
    const leafHeight = 160;
    const cardWidth = 240;
    const cardHeight = 124;

    const childrenByParent = new Map<string, AgenticNode[]>();
    visibleNodes.forEach(node => {
      const parentKey = node.parentId && visibleNodeMap.has(node.parentId) ? node.parentId : '__root__';
      const group = childrenByParent.get(parentKey) || [];
      group.push(node);
      childrenByParent.set(parentKey, group);
    });

    childrenByParent.forEach(group => {
      group.sort((a, b) => {
        if (branchViewMode === 'evidence') {
          const scoreA = evidenceScoreByNode.get(a.nodeId) || 0;
          const scoreB = evidenceScoreByNode.get(b.nodeId) || 0;
          if (scoreA !== scoreB) return scoreB - scoreA;
        }
        return a.nodeId.localeCompare(b.nodeId);
      });
    });

    const layout = new Map<string, GraphLayoutPoint>();
    let cursor = 0;
    let maxDepth = 0;

    const place = (node: AgenticNode, depth: number): number => {
      maxDepth = Math.max(maxDepth, depth);
      const children = childrenByParent.get(node.nodeId) || [];
      let y = cursor * leafHeight + 60;
      if (children.length === 0) {
        cursor += 1;
      } else {
        const ys = children.map(child => place(child, depth + 1));
        y = ys.reduce((acc, item) => acc + item, 0) / ys.length;
      }
      layout.set(node.nodeId, {
        nodeId: node.nodeId,
        x: depth * laneWidth + 30,
        y,
        depth,
      });
      return y;
    };

    (childrenByParent.get('__root__') || []).forEach(root => place(root, 0));

    const edges: Array<{ from: string; to: string }> = [];
    visibleNodes.forEach(node => {
      if (!node.parentId || !visibleNodeMap.has(node.parentId)) return;
      edges.push({ from: node.parentId, to: node.nodeId });
    });

    return {
      layout,
      edges,
      laneWidth,
      cardWidth,
      cardHeight,
      maxDepth,
      width: Math.max(640, (maxDepth + 1) * laneWidth + 300),
      height: Math.max(320, cursor * leafHeight + 120),
    };
  }, [visibleNodes, visibleNodeMap, branchViewMode, evidenceScoreByNode]);

  const searchReplayEvents = useMemo(() => {
    const replayRows: SearchReplayEvent[] = [];
    const eventRows = Array.isArray(detail?.events) ? detail?.events : [];
    eventRows.forEach((row, idx) => {
      const event = String((row as any)?.event || '');
      if (event !== 'search_node_selected' && event !== 'tot_node_expanded') return;
      const payload = ((row as any)?.payload || {}) as Record<string, unknown>;
      const nodeId = String(payload.nodeId || payload.node_id || '');
      if (!nodeId) return;
      const childIds = Array.isArray(payload.childIds)
        ? (payload.childIds as unknown[]).map(item => String(item || '').trim()).filter(Boolean)
        : [];
      const rawMutations = Array.isArray(payload.mutations) ? (payload.mutations as unknown[]) : [];
      const mutations = rawMutations
        .map(item => asRecord(item))
        .filter(item => Object.keys(item).length > 0)
        .map(item => ({
          nodeId: String(item.nodeId || '').trim(),
          mutationKind: String(item.mutationKind || '').trim().toLowerCase(),
          targetFiles: asStringArray(item.targetFiles),
          strategy: String(item.strategy || '').trim(),
        }))
        .filter(item => item.nodeId || item.mutationKind || item.targetFiles.length > 0 || item.strategy);
      replayRows.push({
        idx,
        event,
        ts: String((row as any)?.ts || ''),
        nodeId,
        summary: String((row as any)?.message || event),
        childIds,
        mutations,
      });
    });
    return replayRows;
  }, [detail?.events]);

  const firstSeenStepByNode = useMemo(() => {
    const map = new Map<string, number>();
    nodes.forEach(node => {
      if (!node.parentId && !map.has(node.nodeId)) map.set(node.nodeId, 0);
    });
    searchReplayEvents.forEach((item, idx) => {
      const step = idx + 1;
      if (!map.has(item.nodeId)) map.set(item.nodeId, step);
      item.childIds.forEach(childId => {
        if (!map.has(childId)) map.set(childId, step);
      });
    });

    // Infer remaining nodes from parent appearance order, so replay can reveal branches progressively.
    let changed = true;
    let rounds = 0;
    while (changed && rounds < nodes.length + 2) {
      changed = false;
      rounds += 1;
      nodes.forEach(node => {
        if (map.has(node.nodeId)) return;
        if (!node.parentId) {
          map.set(node.nodeId, 0);
          changed = true;
          return;
        }
        const parentStep = map.get(node.parentId);
        if (typeof parentStep === 'number') {
          map.set(node.nodeId, parentStep + 1);
          changed = true;
        }
      });
    }

    const fallbackStep = Math.max(1, searchReplayEvents.length);
    nodes.forEach(node => {
      if (!map.has(node.nodeId)) map.set(node.nodeId, fallbackStep);
    });
    return map;
  }, [nodes, searchReplayEvents, searchReplayEvents.length]);

  const replayRevealedNodeIds = useMemo(() => {
    if (!replayRevealMode || replayStep <= 0) {
      return new Set(nodes.map(node => node.nodeId));
    }
    const revealed = new Set<string>();
    firstSeenStepByNode.forEach((step, nodeId) => {
      if (step <= replayStep) revealed.add(nodeId);
    });
    return revealed;
  }, [nodes, firstSeenStepByNode, replayRevealMode, replayStep]);

  const replayActiveEvent = useMemo(() => {
    if (searchReplayEvents.length === 0 || replayStep <= 0) return null;
    const idx = Math.min(searchReplayEvents.length - 1, replayStep - 1);
    return searchReplayEvents[idx] || null;
  }, [searchReplayEvents, replayStep]);
  const latestReplayEvent = useMemo(
    () => (searchReplayEvents.length > 0 ? searchReplayEvents[searchReplayEvents.length - 1] : null),
    [searchReplayEvents],
  );

  const replayNodeId = replayActiveEvent?.nodeId || '';
  const replayProgressPct = useMemo(
    () => (searchReplayEvents.length > 0 ? Math.round((replayStep / searchReplayEvents.length) * 100) : 0),
    [replayStep, searchReplayEvents.length],
  );

  const focusedNodeId = useMemo(() => {
    const visibleAndRevealed = (nodeId: string) => visibleNodeMap.has(nodeId) && replayRevealedNodeIds.has(nodeId);
    if (selectedNodeId && visibleAndRevealed(selectedNodeId)) return selectedNodeId;
    if (hoveredNodeId && visibleAndRevealed(hoveredNodeId)) return hoveredNodeId;
    if (replayNodeId && visibleAndRevealed(replayNodeId)) return replayNodeId;
    const fallback = visibleNodes.find(node => replayRevealedNodeIds.has(node.nodeId));
    return fallback?.nodeId || '';
  }, [selectedNodeId, hoveredNodeId, replayNodeId, visibleNodes, visibleNodeMap, replayRevealedNodeIds]);

  const focusedNode = useMemo(() => (focusedNodeId ? nodeById.get(focusedNodeId) || null : null), [focusedNodeId, nodeById]);
  const mutationPlansByNode = useMemo(() => {
    const map = new Map<string, NodeMutationPlan[]>();
    nodes.forEach(node => {
      map.set(node.nodeId, extractNodeMutationPlans(node));
    });
    return map;
  }, [nodes]);
  const focusedNodeMutationPlans = useMemo(
    () => (focusedNode ? mutationPlansByNode.get(focusedNode.nodeId) || [] : []),
    [focusedNode, mutationPlansByNode],
  );

  const runStats = useMemo(() => {
    const stats = { total: nodes.length, running: 0, failed: 0, blocked: 0, succeeded: 0, pending: 0 };
    nodes.forEach(node => {
      const status = String(node.status || '').toUpperCase();
      if (status === 'RUNNING') stats.running += 1;
      else if (status === 'FAILED') stats.failed += 1;
      else if (status === 'BLOCKED') stats.blocked += 1;
      else if (status === 'SUCCEEDED') stats.succeeded += 1;
      else stats.pending += 1;
    });
    return stats;
  }, [nodes]);
  const searchStats = detail?.searchStats || null;
  const llmTraces = useMemo(
    () => (Array.isArray(detail?.llmTraces) ? (detail?.llmTraces as AgenticLlmTraceRecord[]) : []),
    [detail?.llmTraces],
  );
  const llmTraceSummary = useMemo(() => {
    const total = llmTraces.length;
    let succeeded = 0;
    let failed = 0;
    let latencyTotal = 0;
    let retryCalls = 0;
    const nodeSet = new Set<string>();
    llmTraces.forEach(trace => {
      const ok = String(trace.status || '').toLowerCase() === 'succeeded';
      if (ok) succeeded += 1;
      else failed += 1;
      const latency = Number(trace.latencyMs || 0);
      if (Number.isFinite(latency) && latency > 0) latencyTotal += latency;
      const attempt = Number(trace.attempt || 1);
      if (Number.isFinite(attempt) && attempt > 1) retryCalls += 1;
      const nodeId = String(trace.nodeId || '').trim();
      if (nodeId) nodeSet.add(nodeId);
    });
    return {
      total,
      succeeded,
      failed,
      avgLatencyMs: total > 0 ? Math.round(latencyTotal / total) : 0,
      retryCalls,
      coveredNodes: nodeSet.size,
    };
  }, [llmTraces]);
  const llmTraceByNode = useMemo(() => {
    const map = new Map<string, { total: number; failed: number; avgLatencyMs: number; lastTask: string }>();
    const accum = new Map<string, { total: number; failed: number; latencyTotal: number; lastTask: string }>();
    llmTraces.forEach(trace => {
      const nodeId = String(trace.nodeId || '').trim();
      if (!nodeId) return;
      const prev = accum.get(nodeId) || { total: 0, failed: 0, latencyTotal: 0, lastTask: '' };
      const latency = Number(trace.latencyMs || 0);
      const failed = String(trace.status || '').toLowerCase() !== 'succeeded';
      accum.set(nodeId, {
        total: prev.total + 1,
        failed: prev.failed + (failed ? 1 : 0),
        latencyTotal: prev.latencyTotal + (Number.isFinite(latency) ? Math.max(0, latency) : 0),
        lastTask: String(trace.task || prev.lastTask || ''),
      });
    });
    accum.forEach((row, nodeId) => {
      map.set(nodeId, {
        total: row.total,
        failed: row.failed,
        avgLatencyMs: row.total > 0 ? Math.round(row.latencyTotal / row.total) : 0,
        lastTask: row.lastTask,
      });
    });
    return map;
  }, [llmTraces]);
  const maxLlmCallsPerNode = useMemo(() => {
    let best = 0;
    llmTraceByNode.forEach(row => {
      if (row.total > best) best = row.total;
    });
    return best;
  }, [llmTraceByNode]);
  const focusedNodeLlm = useMemo(
    () => (focusedNodeId ? llmTraceByNode.get(focusedNodeId) || null : null),
    [focusedNodeId, llmTraceByNode],
  );
  const ideaSnapshot = useMemo(() => {
    const spec = (detail?.researchSpec || {}) as Record<string, unknown>;
    const idea = (detail?.idea || {}) as Record<string, unknown>;
    const title = String(spec.title || idea.title || selectedRunSummary?.title || 'Auto-Science Idea');
    const env = String(((spec.environment as Record<string, unknown> | undefined)?.name) || idea.environment || '-');
    const metrics = (spec.successMetrics || idea.successMetrics || {}) as Record<string, unknown>;
    const metricEntries = Object.entries(metrics);
    const firstMetric = metricEntries.length > 0 ? `${metricEntries[0][0]} ${String(metricEntries[0][1] || '').replace(/\s+/g, '')}` : 'winRate';
    return { title, env, firstMetric };
  }, [detail?.researchSpec, detail?.idea, selectedRunSummary?.title]);
  const nodeRunCount = detail?.nodeRuns?.length || 0;
  const focusedNodeRun = useMemo(
    () => (focusedNodeId ? latestNodeRunByNode.get(focusedNodeId) || null : null),
    [focusedNodeId, latestNodeRunByNode],
  );
  const explorationPulseRows = useMemo(() => {
    if (searchReplayEvents.length === 0) return [] as Array<{ key: string; nodeId: string; event: string; mutation: string; ts: string }>;
    const rows = searchReplayEvents.slice(-16).map((row, idx) => {
      const node = nodeById.get(row.nodeId);
      const plans = node ? extractNodeMutationPlans(node) : [];
      const replayMutation = row.mutations[0]?.mutationKind || '';
      const mutation = String(replayMutation || plans[0]?.mutationKind || '').toUpperCase() || '--';
      return {
        key: `${row.idx}-${idx}-${row.nodeId}`,
        nodeId: row.nodeId,
        event: row.event === 'tot_node_expanded' ? 'EXPAND' : 'SELECT',
        mutation,
        ts: row.ts,
      };
    });
    return rows.reverse();
  }, [searchReplayEvents, nodeById]);
  const frontierQueue = useMemo(() => {
    const rows = visibleNodes
      .filter(node => {
        const status = String(node.status || '').toUpperCase();
        return status === 'PENDING' || status === 'RUNNING' || status === 'RETRY_PENDING';
      })
      .map(node => {
        const search = getSearchMeta(node);
        const primaryPlan = (mutationPlansByNode.get(node.nodeId) || [])[0] || null;
        const runSummary = latestNodeRunByNode.get(node.nodeId) || null;
        const mutationKind = String(primaryPlan?.mutationKind || runSummary?.mutationKind || '').toLowerCase();
        const changeSummary = String(primaryPlan?.changeSummary || runSummary?.changeSummary || '').trim();
        const targetFiles = (primaryPlan?.targetFiles && primaryPlan.targetFiles.length > 0
          ? primaryPlan.targetFiles
          : runSummary?.targetFiles || [])
          .map(path => String(path || '').trim())
          .filter(Boolean);
        const validationCommand = String(primaryPlan?.validationCommand || '').trim();
        const strategy = String(primaryPlan?.strategy || '').trim();
        const status = String(node.status || '').toUpperCase();
        const frontier = Number.isFinite(Number(search.frontierScore)) ? Number(search.frontierScore) : 0;
        const value = Number.isFinite(Number(search.value)) ? Number(search.value) : 0;
        const evidence = Number(evidenceScoreByNode.get(node.nodeId) || 0);
        const urgency = status === 'RUNNING' ? 0.12 : status === 'RETRY_PENDING' ? 0.08 : 0;
        const scoreFrontier = frontier * 0.56;
        const scoreValue = value * 0.18;
        const scoreEvidence = evidence * 0.2;
        const scoreUrgency = urgency;
        return {
          nodeId: node.nodeId,
          status,
          depth: Number(search.depth || 0),
          visits: Number(search.visits || 0),
          frontier,
          value,
          evidence,
          mutationKind: mutationKind || 'code',
          changeSummary,
          targetFiles,
          validationCommand,
          strategy,
          scoreFrontier,
          scoreValue,
          scoreEvidence,
          scoreUrgency,
          score: scoreFrontier + scoreValue + scoreEvidence + scoreUrgency,
        };
      })
      .sort((a, b) => b.score - a.score || b.frontier - a.frontier || a.depth - b.depth || a.nodeId.localeCompare(b.nodeId));
    return rows.slice(0, 8);
  }, [visibleNodes, mutationPlansByNode, evidenceScoreByNode, latestNodeRunByNode]);
  const spotlightNodeId = useMemo(() => {
    if (!spotlightMode) return '';
    if (replayActiveEvent?.nodeId && visibleNodeMap.has(replayActiveEvent.nodeId) && replayRevealedNodeIds.has(replayActiveEvent.nodeId)) {
      return replayActiveEvent.nodeId;
    }
    if (frontierQueue[0]?.nodeId) return frontierQueue[0].nodeId;
    if (focusedNodeId && visibleNodeMap.has(focusedNodeId) && replayRevealedNodeIds.has(focusedNodeId)) return focusedNodeId;
    return '';
  }, [
    spotlightMode,
    replayActiveEvent?.nodeId,
    frontierQueue,
    focusedNodeId,
    visibleNodeMap,
    replayRevealedNodeIds,
  ]);
  const spotlightPathIds = useMemo(() => {
    if (!spotlightNodeId) return new Set<string>();
    return collectAncestorPath(nodeById, spotlightNodeId);
  }, [nodeById, spotlightNodeId]);
  const spotlightReason = useMemo(
    () => frontierQueue.find(row => row.nodeId === spotlightNodeId) || frontierQueue[0] || null,
    [frontierQueue, spotlightNodeId],
  );
  const maxFrontierScore = useMemo(() => {
    let max = 0;
    visibleNodes.forEach(node => {
      const frontier = Number(getSearchMeta(node).frontierScore || 0);
      if (Number.isFinite(frontier) && frontier > max) max = frontier;
    });
    return max;
  }, [visibleNodes]);

  const fitGraphToViewport = useCallback(() => {
    const viewport = graphViewportRef.current;
    if (!viewport) return;
    const widthZoom = ((viewport.clientWidth - 24) / Math.max(1, graph.width)) * 100;
    const heightZoom = ((viewport.clientHeight - 24) / Math.max(1, graph.height)) * 100;
    const target = Math.min(widthZoom, heightZoom);
    const snapped = Math.round(target / 5) * 5;
    setGraphZoomPct(Math.max(65, Math.min(160, snapped || 100)));
  }, [graph.width, graph.height]);

  const centerNodeInViewport = useCallback((nodeId: string, behavior: ScrollBehavior = 'smooth') => {
    if (!nodeId) return;
    const viewport = graphViewportRef.current;
    const point = graph.layout.get(nodeId);
    if (!viewport || !point) return;
    const scale = graphZoomPct / 100;
    const centerX = (point.x + graph.cardWidth / 2) * scale;
    const centerY = point.y * scale;
    viewport.scrollTo({
      left: Math.max(0, centerX - viewport.clientWidth / 2),
      top: Math.max(0, centerY - viewport.clientHeight / 2),
      behavior,
    });
  }, [graph.layout, graph.cardWidth, graphZoomPct]);

  const setReplayStepAndFocus = useCallback((nextStep: number, behavior: ScrollBehavior = 'smooth') => {
    const normalized = Math.max(0, Math.min(searchReplayEvents.length, nextStep));
    setReplayStep(normalized);
    if (normalized <= 0) return;
    const event = searchReplayEvents[Math.min(searchReplayEvents.length - 1, normalized - 1)];
    if (!event?.nodeId) return;
    setSelectedNodeId(event.nodeId);
    centerNodeInViewport(event.nodeId, behavior);
  }, [searchReplayEvents, centerNodeInViewport]);

  const toggleNodeCollapsed = useCallback((nodeId: string) => {
    setCollapsedNodeIds(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
  }, []);

  useEffect(() => {
    if (searchReplayEvents.length === 0) {
      setReplayStep(0);
      setReplayPlaying(false);
      return;
    }
    if (!replayRevealMode) {
      setReplayPlaying(false);
      setReplayStep(searchReplayEvents.length);
      return;
    }
    let shouldAutoplay = false;
    setReplayStep(prev => {
      if (prev <= 0) {
        shouldAutoplay = true;
        return 1;
      }
      return Math.min(prev, searchReplayEvents.length);
    });
    if (shouldAutoplay && searchReplayEvents.length > 1) {
      setReplayPlaying(true);
    }
  }, [searchReplayEvents.length, replayRevealMode]);

  useEffect(() => {
    if (!replayPlaying) return;
    if (searchReplayEvents.length === 0) return;
    const timer = window.setInterval(() => {
      setReplayStep(prev => {
        if (prev >= searchReplayEvents.length) {
          setReplayPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 850);
    return () => window.clearInterval(timer);
  }, [replayPlaying, searchReplayEvents.length]);

  useEffect(() => {
    const replayVisibleNodes = visibleNodes.filter(node => replayRevealedNodeIds.has(node.nodeId));
    if (replayVisibleNodes.length === 0) {
      setSelectedNodeId('');
      return;
    }
    if (!selectedNodeId || !replayVisibleNodes.some(node => node.nodeId === selectedNodeId)) {
      setSelectedNodeId(replayVisibleNodes[0].nodeId);
    }
  }, [visibleNodes, replayRevealedNodeIds, selectedNodeId]);

  useEffect(() => {
    if (!replayActiveEvent?.nodeId) return;
    if (!visibleNodeMap.has(replayActiveEvent.nodeId) || !replayRevealedNodeIds.has(replayActiveEvent.nodeId)) return;
    if (!replayPlaying) return;
    setSelectedNodeId(replayActiveEvent.nodeId);
    centerNodeInViewport(replayActiveEvent.nodeId, 'smooth');
  }, [replayActiveEvent?.idx, replayActiveEvent?.nodeId, replayPlaying, visibleNodeMap, replayRevealedNodeIds, centerNodeInViewport]);
  useEffect(() => {
    if (!autoFollowLatest) return;
    if (replayPlaying) return;
    const nodeId = latestReplayEvent?.nodeId || '';
    if (!nodeId) return;
    if (!visibleNodeMap.has(nodeId) || !replayRevealedNodeIds.has(nodeId)) return;
    if (selectedNodeId === nodeId) return;
    setSelectedNodeId(nodeId);
    centerNodeInViewport(nodeId, 'smooth');
  }, [
    autoFollowLatest,
    replayPlaying,
    latestReplayEvent?.idx,
    latestReplayEvent?.nodeId,
    visibleNodeMap,
    replayRevealedNodeIds,
    selectedNodeId,
    centerNodeInViewport,
  ]);

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

  const runAutoScience = async () => {
    if (autoExploring) return;
    setAutoExploring(true);
    setMessage('');
    try {
      let runId = selectedRunId;
      let current = detail;

      if (!runId) {
        const idea = buildAutoScienceIdea();
        await api.validateAgenticSpec(idea);
        const created = await api.createAgenticRun({
          idea,
          autoExecute: false,
        });
        runId = created.runId;
        current = created.detail;
        setSelectedRunId(runId);
        setDetail(created.detail);
        await refreshRuns();
      }

      let rounds = 0;
      const maxRounds = isDemoMode ? 10 : 14;
      while (runId && rounds < maxRounds) {
        const status = String(current?.status || '').toUpperCase();
        if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'BLOCKED') break;
        const res = await api.executeAgenticRun(runId, { mode: 'next' });
        current = res.detail;
        setDetail(res.detail);
        rounds += 1;
      }

      await refreshRuns();
      const finalStatus = String(current?.status || '').toUpperCase();
      if (finalStatus === 'BLOCKED') {
        setMessage(tx('自动探索已暂停：遇到安全审批，请先在当前页面处理后继续。', 'Auto exploration paused: safety approval required. Resolve it on this page and continue.'));
      } else {
        setMessage(tx('自动探索已完成一轮：你可以继续点击 Auto Explore 让树继续生长。', 'Auto exploration round complete. Click Auto Explore again to keep growing the tree.'));
      }
    } catch (error) {
      setMessage(normalizeLlmIssue(toErrorMessage(error), tx));
    } finally {
      setAutoExploring(false);
    }
  };

  const openNodeEvidence = (nodeId: string) => {
    if (!selectedRunId) return;
    navigate(`/agentic/runs/${encodeURIComponent(selectedRunId)}/nodes/${encodeURIComponent(nodeId)}`);
  };

  const isActionBusy = busyAction !== 'none' || loadingRun;

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_0%_0%,rgba(37,99,235,.14),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(124,58,237,.14),transparent_36%),linear-gradient(180deg,rgba(248,250,252,.92),rgba(255,255,255,.98))] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-700">
            <Sparkles className={`mr-1.5 h-3.5 w-3.5 ${autoExploring ? 'animate-pulse text-indigo-600' : 'text-slate-600'}`} />
            {tx('LLM Auto-Science', 'LLM Auto-Science')}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="rounded bg-white px-2 py-1">
              {tx('来源', 'Source')}: <span className="font-semibold">{isDemoMode ? 'Demo API' : 'Live API'}</span>
            </span>
            {selectedRunSummary && (
              <span className={`rounded px-2 py-1 font-semibold ${statusBadgeClass(selectedRunSummary.status)}`}>
                {selectedRunSummary.status}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                const next = !presentationMode;
                setPresentationMode(next);
                if (next) setShowAdvancedControls(false);
              }}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
              {presentationMode ? tx('专家模式', 'Expert Mode') : tx('评审模式', 'Judge Mode')}
            </button>
            <button
              type="button"
              onClick={() => setTreeOnlyMode(prev => !prev)}
              className={`inline-flex items-center rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${treeOnlyMode ? 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {treeOnlyMode ? tx('Tree-Only', 'Tree-Only') : tx('Rich View', 'Rich View')}
            </button>
          </div>
        </div>
        {treeOnlyMode ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded bg-white px-2 py-1">{ideaSnapshot.title}</span>
            <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">{tx('树', 'Tree')} {runStats.total} · D{searchStats?.maxDepth || 0}</span>
            <span className="rounded bg-violet-50 px-2 py-1 text-violet-700">LLM {llmTraceSummary.total}</span>
            <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">EV {nodeRunCount}</span>
          </div>
        ) : (
          <>
            <div className="mt-2 grid gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{tx('Idea', 'Idea')}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-slate-900" title={ideaSnapshot.title}>{ideaSnapshot.title}</div>
                <div className="mt-1 truncate text-[11px] text-slate-600">{ideaSnapshot.env}</div>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-violet-700">{tx('LLM', 'LLM')}</div>
                <div className="mt-0.5 text-sm font-semibold text-violet-900">{llmTraceSummary.total} {tx('calls', 'calls')}</div>
                <div className="mt-1 text-[11px] text-violet-700">{tx('失败', 'Failed')} {llmTraceSummary.failed} · {llmTraceSummary.avgLatencyMs}ms</div>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-blue-700">{tx('Tree', 'Tree')}</div>
                <div className="mt-0.5 text-sm font-semibold text-blue-900">{runStats.total} {tx('nodes', 'nodes')} · D{searchStats?.maxDepth || 0}</div>
                <div className="mt-1 text-[11px] text-blue-700">{tx('扩展', 'Expanded')} {searchStats?.expandedNodes || 0} · {tx('覆盖', 'Coverage')} {Math.round((searchStats?.explorationCoverage || 0) * 100)}%</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-emerald-700">{tx('Evidence', 'Evidence')}</div>
                <div className="mt-0.5 text-sm font-semibold text-emerald-900">{nodeRunCount} {tx('node runs', 'node runs')}</div>
                <div className="mt-1 text-[11px] text-emerald-700">{tx('目标指标', 'Target')} {ideaSnapshot.firstMetric}</div>
              </div>
            </div>
            <div className="mt-2 overflow-auto rounded-xl border border-slate-200 bg-white px-2 py-1.5">
              <div className="flex min-w-max items-center gap-1.5">
                {explorationPulseRows.length === 0 && (
                  <span className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{tx('等待探索事件', 'Waiting for exploration events')}</span>
                )}
                {explorationPulseRows.map((row, idx) => (
                  <button
                    key={`pulse-${row.key}`}
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(row.nodeId);
                      setAutoFollowLatest(false);
                      centerNodeInViewport(row.nodeId, 'smooth');
                    }}
                    className={`rounded-lg border px-2 py-1 text-[11px] ${idx === 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
                  >
                    <span className="font-semibold">{row.event}</span> · {row.nodeId} · {row.mutation}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedRunId}
            onChange={e => setSelectedRunId(e.target.value)}
            className="min-w-[16rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {runs.length === 0 && <option value="">{tx('暂无运行', 'No runs yet')}</option>}
            {runs.map(run => (
              <option key={run.runId} value={run.runId}>{run.runId} · {run.title}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => refreshRuns()}
            className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            disabled={loadingRuns}
          >
            <RefreshCcw className={`mr-1.5 h-4 w-4 ${loadingRuns ? 'animate-spin' : ''}`} />
            {tx('刷新', 'Refresh')}
          </button>
          <button
            type="button"
            onClick={() => runAutoScience()}
            disabled={autoExploring || isActionBusy}
            className="inline-flex items-center rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            <Sparkles className={`mr-1.5 h-4 w-4 ${autoExploring ? 'animate-pulse' : ''}`} />
            {autoExploring ? tx('自动探索中...', 'Auto Exploring...') : tx('Auto Explore', 'Auto Explore')}
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
            onClick={() => navigate('/agentic/new')}
            className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
          >
            {tx('Idea 输入', 'Idea Input')}
          </button>
          <button
            type="button"
            onClick={() => setAutoFollowLatest(prev => !prev)}
            className={`inline-flex items-center rounded-lg border px-3 py-2 text-sm ${autoFollowLatest ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            {autoFollowLatest ? tx('跟随最新: 开', 'Auto Follow: On') : tx('跟随最新: 关', 'Auto Follow: Off')}
          </button>
          {!presentationMode && (
            <>
              <button
                type="button"
                onClick={() => runExecutionAction('all')}
                disabled={!selectedRunId || isActionBusy}
                className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
                onClick={() => navigate('/agentic/classic')}
                className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <WandSparkles className="mr-1.5 h-4 w-4" />
                {tx('经典控制台', 'Classic Console')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/agentic')}
                className="inline-flex items-center rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
              >
                {tx('探索洞察', 'Exploration Insights')}
              </button>
            </>
          )}
          {presentationMode && (
            <button
              type="button"
              onClick={() => setShowAdvancedControls(prev => !prev)}
              className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {showAdvancedControls ? <ChevronUp className="mr-1.5 h-4 w-4" /> : <ChevronDown className="mr-1.5 h-4 w-4" />}
              {showAdvancedControls ? tx('收起高级入口', 'Hide Advanced') : tx('展开高级入口', 'Show Advanced')}
            </button>
          )}
        </div>

        {presentationMode && showAdvancedControls && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
            <button
              type="button"
              onClick={() => runExecutionAction('all')}
              disabled={!selectedRunId || isActionBusy}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
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
              className="inline-flex items-center rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
            >
              {tx('探索洞察', 'Exploration Insights')}
            </button>
            <button
              type="button"
              onClick={() => navigate('/agentic/classic')}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              <WandSparkles className="mr-1.5 h-4 w-4" />
              {tx('经典控制台', 'Classic Console')}
            </button>
          </div>
        )}

        {(!treeOnlyMode || !presentationMode || showAdvancedControls) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded bg-slate-100 px-2 py-1">{tx('总节点', 'Nodes')} {runStats.total}</span>
            {searchStats && (
              <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">
                {tx('搜索深度', 'Search depth')} {searchStats.maxDepth}
              </span>
            )}
            {searchStats && (
              <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">
                {tx('已扩展', 'Expanded')} {searchStats.expandedNodes}
              </span>
            )}
            {searchStats && (
              <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">
                {tx('探索覆盖', 'Coverage')} {Math.round((searchStats.explorationCoverage || 0) * 100)}%
              </span>
            )}
            <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{tx('成功', 'Succeeded')} {runStats.succeeded}</span>
            <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">{tx('运行中', 'Running')} {runStats.running}</span>
            <span className="rounded bg-slate-100 px-2 py-1">{tx('证据', 'Evidence')} {nodeRunCount}</span>
            {selectedRunSummary && (
              <span className="rounded bg-slate-100 px-2 py-1">{tx('合同', 'Contract')} {Math.round((selectedRunSummary.contractPassRate || 0) * 100)}%</span>
            )}
            <span className="rounded bg-violet-50 px-2 py-1 text-violet-700">
              {tx('LLM', 'LLM')} {llmTraceSummary.total}
            </span>
            <span className={`rounded px-2 py-1 ${llmTraceSummary.failed > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {tx('失败', 'Failed')} {llmTraceSummary.failed}
            </span>
          </div>
        )}
        {mutationFilterOptions.length > 0 && (!treeOnlyMode || !presentationMode || showAdvancedControls) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{tx('变更过滤', 'Mutation filter')}</span>
            <button
              type="button"
              onClick={() => setMutationFilter('all')}
              className={`rounded border px-2 py-1 ${mutationFilter === 'all' ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {tx('全部', 'All')} ({nodes.length})
            </button>
            {mutationFilterOptions.map(item => (
              <button
                key={`mutation-filter-${item.kind}`}
                type="button"
                onClick={() => setMutationFilter(item.kind)}
                className={`rounded border px-2 py-1 ${mutationFilter === item.kind ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {String(item.kind || 'code').toUpperCase()} ({item.count})
              </button>
            ))}
            {mutationFilter !== 'all' && (
              <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">
                {tx('当前可见', 'Visible')} {filteredNodes.length}
              </span>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{tx('树视图', 'Tree view')}</span>
          {(!treeOnlyMode || !presentationMode || showAdvancedControls) && (
            <>
              <button
                type="button"
                onClick={() => setBranchViewMode('default')}
                className={`rounded border px-2 py-1 ${branchViewMode === 'default' ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {tx('默认排序', 'Default order')}
              </button>
              <button
                type="button"
                onClick={() => setBranchViewMode('evidence')}
                className={`rounded border px-2 py-1 ${branchViewMode === 'evidence' ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {tx('证据优先', 'Evidence first')}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSpotlightMode(prev => !prev)}
            className={`rounded border px-2 py-1 ${spotlightMode ? 'border-blue-300 bg-blue-50 font-semibold text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {spotlightMode ? tx('探索聚光灯: 开', 'Spotlight: On') : tx('探索聚光灯: 关', 'Spotlight: Off')}
          </button>
        </div>
      </section>

      {!presentationMode && searchReplayEvents.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800">{tx('探索回放', 'Exploration Replay')}</div>
            <div className="text-xs text-slate-500">
              {tx('Live', 'Live')} · {searchReplayEvents.length} {tx('steps', 'steps')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (replayPlaying) {
                  setReplayPlaying(false);
                  return;
                }
                if (replayStep >= searchReplayEvents.length) {
                  setReplayStepAndFocus(1, 'auto');
                }
                setAutoFollowLatest(true);
                setReplayPlaying(true);
              }}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {replayPlaying ? <Pause className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
              {replayPlaying ? tx('暂停', 'Pause') : tx('播放', 'Play')}
            </button>
            <button
              type="button"
              onClick={() => {
                setReplayPlaying(false);
                setReplayStepAndFocus(0, 'auto');
                setAutoFollowLatest(true);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              {tx('重置', 'Reset')}
            </button>
            <input
              type="range"
              min={0}
              max={searchReplayEvents.length}
              step={1}
              value={replayStep}
              onChange={e => {
                setReplayPlaying(false);
                setReplayStepAndFocus(Number(e.target.value || 0), 'auto');
                setAutoFollowLatest(false);
              }}
              className="min-w-[16rem] flex-1 accent-indigo-600"
            />
            <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {replayStep}/{searchReplayEvents.length}
            </span>
            <label className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={replayRevealMode}
                onChange={e => setReplayRevealMode(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              {tx('逐步显影', 'Progressive Reveal')}
            </label>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
            <div
              className="h-full rounded bg-indigo-500 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, replayProgressPct))}%` }}
            />
          </div>
          {replayActiveEvent && (
            <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
              <div className="font-semibold">{replayActiveEvent.event} · {replayActiveEvent.nodeId}</div>
              <div className="mt-0.5 text-indigo-800">{replayActiveEvent.summary}</div>
            </div>
          )}
          <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-1.5">
            <div className="space-y-1">
              {searchReplayEvents.map((row, idx) => {
                const step = idx + 1;
                const active = step === replayStep;
                const done = step < replayStep;
                const tone = active
                  ? 'border-indigo-300 bg-indigo-100 text-indigo-800'
                  : done
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-700';
                const label = row.event === 'tot_node_expanded'
                  ? tx('扩展', 'Expand')
                  : tx('选择', 'Select');
                return (
                  <button
                    key={`replay-event-${row.idx}-${row.nodeId}`}
                    type="button"
                    onClick={() => {
                      setReplayPlaying(false);
                      setReplayStepAndFocus(step, 'smooth');
                      setAutoFollowLatest(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-[11px] ${tone}`}
                  >
                    <span className="min-w-0 truncate">
                      #{step} · {label} · {row.nodeId}
                    </span>
                    <span className="ml-2 text-[10px] opacity-75">
                      {row.ts ? new Date(row.ts).toLocaleTimeString() : '-'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!presentationMode && (
              <label className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                <span>{graphZoomPct}%</span>
                <input
                  type="range"
                  min={65}
                  max={160}
                  step={5}
                  value={graphZoomPct}
                  onChange={e => setGraphZoomPct(Number(e.target.value || 100))}
                  className="w-24 accent-blue-600"
                />
              </label>
            )}
            <button
              type="button"
              onClick={fitGraphToViewport}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              {tx('适配视图', 'Fit')}
            </button>
          </div>
          <div className="text-[11px] text-slate-500">
            {presentationMode
              ? tx('双击节点看证据；回放请切到专家模式。', 'Double-click for evidence; use Expert Mode for replay controls.')
              : tx('双击节点进入证据页。', 'Double-click node to open evidence.')}
          </div>
        </div>
        {!presentationMode && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5">
              <span className="mr-1.5 h-2 w-2 rounded-full bg-blue-600" />
              {tx('蓝色高亮 = 当前聚焦路径', 'Blue highlight = focused path')}
            </span>
            <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">
              <span className="mr-1.5 h-2 w-2 rounded-full bg-violet-600" />
              {tx('紫色强度 = LLM 探索密度', 'Purple intensity = LLM exploration density')}
            </span>
            <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
              {tx('红色 LLM 标签 = 该节点有失败调用', 'Red LLM tag = failed LLM calls on node')}
            </span>
            {branchViewMode === 'evidence' && (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                {tx('证据优先：按代码证据强度重排并高亮', 'Evidence-first: branches sorted/highlighted by code-evidence strength')}
              </span>
            )}
            {spotlightMode && (
              <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">
                {tx('聚光灯：突出当前探索主路径', 'Spotlight: highlight active exploration path')}
              </span>
            )}
            {replayRevealMode && (
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">
                {tx('回放显影开启：仅展示已探索到的节点', 'Replay reveal on: showing explored nodes only')}
              </span>
            )}
          </div>
        )}
        {frontierQueue.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{tx('Frontier', 'Frontier')}</span>
            {frontierQueue.map((row, idx) => {
              const statusTone = row.status === 'RUNNING'
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : row.status === 'RETRY_PENDING'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-slate-200 bg-white text-slate-700';
              const active = spotlightNodeId === row.nodeId;
              return (
                <button
                  key={`frontier-${row.nodeId}-${idx}`}
                  type="button"
                  onClick={() => {
                    setSelectedNodeId(row.nodeId);
                    setAutoFollowLatest(false);
                    centerNodeInViewport(row.nodeId, 'smooth');
                  }}
                  className={`rounded border px-2 py-1 ${statusTone} ${active ? 'ring-1 ring-blue-300' : 'hover:bg-slate-50'}`}
                  title={`${row.nodeId} | frontier=${Math.round(row.frontier * 100)} | depth=${row.depth} | mutation=${String(row.mutationKind || '').toUpperCase()}${row.targetFiles.length > 0 ? ` | files=${row.targetFiles.slice(0, 3).join(',')}` : ''}${row.changeSummary ? ` | ${row.changeSummary}` : ''}`}
                >
                  <span className="font-semibold">{row.nodeId}</span>
                  {' '}
                  · {String(row.mutationKind || 'code').toUpperCase()}
                  {' '}
                  · F{Math.round(row.frontier * 100)}
                </button>
              );
            })}
          </div>
        )}
        {spotlightReason && (
          <div className="mb-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">
                {tx('为何选择该节点', 'Why this node next')}
              </span>
              <span className="font-semibold text-sky-900">
                {spotlightReason.nodeId}
              </span>
              <span className="text-sky-700">
                {tx('深度', 'Depth')} {spotlightReason.depth} · {tx('访问', 'Visits')} {spotlightReason.visits}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-sky-800">
              {tx('探索分数由四部分组成：Frontier + Value + Evidence + Urgency。', 'Exploration score is composed of Frontier + Value + Evidence + Urgency.')}
            </div>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-4">
              <div className="rounded border border-sky-200 bg-white/80 px-2 py-1 text-[11px] text-sky-700">
                F {Math.round(spotlightReason.frontier * 100)} · +{spotlightReason.scoreFrontier.toFixed(2)}
              </div>
              <div className="rounded border border-sky-200 bg-white/80 px-2 py-1 text-[11px] text-sky-700">
                V {Math.round(spotlightReason.value * 100)} · +{spotlightReason.scoreValue.toFixed(2)}
              </div>
              <div className="rounded border border-sky-200 bg-white/80 px-2 py-1 text-[11px] text-sky-700">
                EV {Math.round(spotlightReason.evidence * 100)} · +{spotlightReason.scoreEvidence.toFixed(2)}
              </div>
              <div className="rounded border border-sky-200 bg-white/80 px-2 py-1 text-[11px] text-sky-700">
                U +{spotlightReason.scoreUrgency.toFixed(2)} · {tx('总分', 'Total')} {spotlightReason.score.toFixed(2)}
              </div>
            </div>
            {spotlightReason.changeSummary && (
              <div className="mt-1.5 text-[11px] text-sky-900">
                <span className="font-semibold">{tx('代码改动摘要', 'Code change summary')}: </span>
                {spotlightReason.changeSummary}
              </div>
            )}
            {spotlightReason.targetFiles.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-700">{tx('目标文件', 'Target files')}</span>
                {spotlightReason.targetFiles.slice(0, 4).map((path, idx) => (
                  <span
                    key={`spotlight-target-${idx}-${path}`}
                    className="rounded border border-sky-200 bg-white px-2 py-0.5 text-sky-700"
                    title={path}
                  >
                    {path}
                  </span>
                ))}
              </div>
            )}
            {spotlightReason.validationCommand && (
              <div className="mt-1 text-[11px] text-sky-800">
                <span className="font-semibold">{tx('校验命令', 'Validation command')}: </span>
                <code className="rounded bg-white px-1.5 py-0.5 text-sky-900">{spotlightReason.validationCommand}</code>
              </div>
            )}
            {spotlightReason.strategy && (
              <div className="mt-1 text-[11px] text-sky-700">
                <span className="font-semibold">{tx('策略', 'Strategy')}: </span>
                {spotlightReason.strategy}
              </div>
            )}
          </div>
        )}

        <div ref={graphViewportRef} className="max-h-[72vh] overflow-auto rounded-xl border border-slate-200 bg-[radial-gradient(circle_at_0%_0%,rgba(219,234,254,.34),transparent_42%),radial-gradient(circle_at_100%_0%,rgba(209,250,229,.24),transparent_38%),linear-gradient(180deg,rgba(248,250,252,.72),rgba(255,255,255,.95))]">
          {loadingRun ? (
            <div className="p-6 text-sm text-slate-500">{tx('加载运行详情中...', 'Loading run detail...')}</div>
          ) : visibleNodes.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              {mutationFilter === 'all'
                ? tx('暂无节点。先从 Idea 页创建一个 Run。', 'No nodes yet. Create a run from Idea Input page.')
                : tx('当前 mutation 过滤条件无匹配节点。请切换过滤器。', 'No nodes matched current mutation filter. Switch filter to continue.')}
            </div>
          ) : (
            <svg
              width={Math.round((graph.width * graphZoomPct) / 100)}
              height={Math.round((graph.height * graphZoomPct) / 100)}
              viewBox={`0 0 ${graph.width} ${graph.height}`}
              onMouseLeave={() => setHoveredNodeId('')}
            >
              <defs>
                <pattern id="tree-grid-canvas" width="30" height="30" patternUnits="userSpaceOnUse">
                  <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#e2e8f0" strokeWidth="1" strokeOpacity="0.45" />
                </pattern>
                <linearGradient id="tree-edge-canvas" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.54" />
                  <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.2" />
                </linearGradient>
                <filter id="tree-node-shadow-canvas" x="-22%" y="-22%" width="144%" height="144%">
                  <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.13" />
                </filter>
                <filter id="tree-node-focus-canvas" x="-28%" y="-28%" width="156%" height="156%">
                  <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#2563eb" floodOpacity="0.24" />
                </filter>
              </defs>
              <rect x={0} y={0} width={graph.width} height={graph.height} fill="url(#tree-grid-canvas)" opacity={0.58} />
              {Array.from({ length: graph.maxDepth + 1 }, (_, depth) => (
                <g key={`lane-${depth}`}>
                  <rect
                    x={depth * graph.laneWidth + 12}
                    y={0}
                    width={graph.laneWidth - 24}
                    height={graph.height}
                    fill={depth % 2 === 0 ? 'rgba(148,163,184,.04)' : 'rgba(59,130,246,.035)'}
                  />
                  <text
                    x={depth * graph.laneWidth + 24}
                    y={18}
                    fontSize={8.8}
                    fontWeight={700}
                    fill="#64748b"
                  >
                    {tx('深度', 'Depth')} {depth}
                  </text>
                </g>
              ))}

              {graph.edges.map(edge => {
                const from = graph.layout.get(edge.from);
                const to = graph.layout.get(edge.to);
                if (!from || !to) return null;
                if (!replayRevealedNodeIds.has(edge.from) || !replayRevealedNodeIds.has(edge.to)) return null;
                const inSpotlightPath = spotlightMode && spotlightPathIds.has(edge.from) && spotlightPathIds.has(edge.to);
                const highlighted = edge.from === focusedNodeId || edge.to === focusedNodeId || inSpotlightPath;
                const runningEdge = String(visibleNodeMap.get(edge.from)?.status || '').toUpperCase() === 'RUNNING'
                  || String(visibleNodeMap.get(edge.to)?.status || '').toUpperCase() === 'RUNNING';
                const fromLlm = llmTraceByNode.get(edge.from)?.total || 0;
                const toLlm = llmTraceByNode.get(edge.to)?.total || 0;
                const llmCalls = Math.max(fromLlm, toLlm);
                const llmIntensity = maxLlmCallsPerNode > 0 ? Math.min(1, llmCalls / maxLlmCallsPerNode) : 0;
                const evidenceFrom = evidenceScoreByNode.get(edge.from) || 0;
                const evidenceTo = evidenceScoreByNode.get(edge.to) || 0;
                const evidenceEdge = Math.max(0, Math.min(1, (evidenceFrom + evidenceTo) / 2));
                const path = `M ${from.x + graph.cardWidth} ${from.y} C ${from.x + graph.cardWidth + 56} ${from.y}, ${to.x - 56} ${to.y}, ${to.x} ${to.y}`;
                const edgeStroke = highlighted
                  ? inSpotlightPath
                    ? 'rgba(14,165,233,.95)'
                    : '#2563eb'
                  : spotlightMode
                  ? 'rgba(148,163,184,.22)'
                  : branchViewMode === 'evidence'
                  ? `rgba(16,185,129,${0.22 + evidenceEdge * 0.62})`
                  : llmIntensity > 0
                  ? `rgba(124,58,237,${0.2 + llmIntensity * 0.55})`
                  : 'url(#tree-edge-canvas)';
                const edgeWidth = highlighted
                  ? inSpotlightPath
                    ? 2.9
                    : 2.4
                  : spotlightMode
                  ? 1.05
                  : branchViewMode === 'evidence'
                  ? 1.5 + evidenceEdge * 1.5
                  : 1.6 + llmIntensity * 1.1;
                const edgeOpacity = highlighted
                  ? inSpotlightPath
                    ? 0.96
                    : 0.92
                  : spotlightMode
                  ? 0.26
                  : branchViewMode === 'evidence'
                  ? 0.56 + evidenceEdge * 0.34
                  : 0.62 + llmIntensity * 0.3;
                return (
                  <g key={`${edge.from}-${edge.to}`}>
                    <path
                      d={path}
                      fill="none"
                      stroke={edgeStroke}
                      strokeWidth={edgeWidth}
                      strokeOpacity={edgeOpacity}
                      strokeDasharray={runningEdge ? '6 4' : undefined}
                      style={{ transition: 'stroke 180ms ease, stroke-width 180ms ease, stroke-opacity 180ms ease' }}
                    />
                    {inSpotlightPath && (
                      <path
                        d={path}
                        fill="none"
                        stroke="rgba(56,189,248,.9)"
                        strokeWidth={1.9}
                        strokeOpacity={0.52}
                        strokeDasharray="3 8"
                      >
                        <animate attributeName="stroke-opacity" values="0.12;0.7;0.12" dur="1.25s" repeatCount="indefinite" />
                      </path>
                    )}
                    {llmIntensity >= 0.75 && !highlighted && !spotlightMode && (
                      <path
                        d={path}
                        fill="none"
                        stroke="rgba(139,92,246,.85)"
                        strokeWidth={2.2}
                        strokeOpacity={0.35}
                        strokeDasharray="3 7"
                      >
                        <animate attributeName="stroke-opacity" values="0.15;0.52;0.15" dur="1.3s" repeatCount="indefinite" />
                      </path>
                    )}
                  </g>
                );
              })}

              {visibleNodes.map(node => {
                const point = graph.layout.get(node.nodeId);
                if (!point) return null;
                if (!replayRevealedNodeIds.has(node.nodeId)) return null;
                const childCount = childCountByParent.get(node.nodeId) || 0;
                const visibleChildCount = visibleChildCountByParent.get(node.nodeId) || 0;
                const parentCount = node.parentId ? childCountByParent.get(node.parentId) || 1 : 1;
                const score = mctsLikeScore(node, parentCount, childCount);
                const scorePct = Math.round(score * 100);
                const nodeTitle = splitLines(node.title || node.nodeId, 20, 2);
                const normStatus = String(node.status || '').toUpperCase();
                const isFocused = node.nodeId === focusedNodeId;
                const isReplayActive = replayNodeId === node.nodeId;
                const isRunning = normStatus === 'RUNNING';
                const isSpotlightNode = spotlightMode && spotlightNodeId === node.nodeId;
                const inSpotlightPath = spotlightMode && spotlightPathIds.has(node.nodeId);
                const fadeBySpotlight = spotlightMode && spotlightPathIds.size > 0 && !inSpotlightPath && !isFocused && !isReplayActive;
                const riskLabel = String(node.risk || 'low').toLowerCase();
                const hasChildren = (filteredChildCountByParent.get(node.nodeId) || 0) > 0;
                const isCollapsed = !!collapsedNodeIds[node.nodeId];
                const hiddenDescendantCount = isCollapsed ? descendantCountByNode.get(node.nodeId) || 0 : 0;
                const searchMeta = getSearchMeta(node);
                const frontierScore = Number(searchMeta.frontierScore || 0);
                const frontierPct = Math.round(Math.max(0, Math.min(1, frontierScore)) * 100);
                const normalizedFrontier = maxFrontierScore > 0 ? Math.max(0, Math.min(1, frontierScore / maxFrontierScore)) : 0;
                const llmStat = llmTraceByNode.get(node.nodeId);
                const llmCalls = llmStat?.total || 0;
                const llmFailed = llmStat?.failed || 0;
                const mutationPlans = mutationPlansByNode.get(node.nodeId) || [];
                const primaryMutation = mutationPlans[0] || null;
                const latestNodeRun = latestNodeRunByNode.get(node.nodeId) || null;
                const mutationKind = String(primaryMutation?.mutationKind || '').toLowerCase();
                const mutationTag = mutationKind ? mutationKind.toUpperCase() : '';
                const mutationColors = mutationBadgeColors(mutationKind);
                const mutationBadgeWidth = Math.max(40, Math.min(122, mutationTag.length * 6 + 20));
                const mutationTargets = primaryMutation?.targetFiles || [];
                const mutationTargetHintRaw = mutationTargets
                  .slice(0, 2)
                  .map(path => String(path || '').split('/').pop() || String(path || ''))
                  .join(', ');
                const mutationTargetHint = mutationTargetHintRaw
                  ? splitLines(mutationTargetHintRaw, 22, 1)[0]
                  : '';
                const latestRunMutationKind = String(latestNodeRun?.mutationKind || '').toUpperCase();
                const latestRunTargetHint = (latestNodeRun?.targetFiles || [])
                  .slice(0, 2)
                  .map(path => String(path || '').split('/').pop() || String(path || ''))
                  .join(', ');
                const evidenceScore = evidenceScoreByNode.get(node.nodeId) || 0;
                const evidencePct = Math.round(evidenceScore * 100);
                const evidenceGlow = (branchViewMode === 'evidence' && evidenceScore >= 0.65) || isSpotlightNode;
                const revealStep = firstSeenStepByNode.get(node.nodeId) ?? 0;
                const isJustRevealed = replayStep > 0 && revealStep === replayStep;
                const cardBg = normStatus === 'FAILED'
                  ? 'rgba(255,241,242,0.95)'
                  : normStatus === 'BLOCKED'
                  ? 'rgba(255,251,235,0.95)'
                  : normStatus === 'SUCCEEDED'
                  ? 'rgba(240,253,244,0.95)'
                  : 'rgba(248,250,252,0.96)';
                return (
                  <g
                    key={node.nodeId}
                    transform={`translate(${point.x}, ${point.y - graph.cardHeight / 2})`}
                    className="cursor-pointer"
                    opacity={fadeBySpotlight ? 0.35 : 1}
                    style={{ transition: 'opacity 180ms ease' }}
                    onMouseEnter={() => setHoveredNodeId(node.nodeId)}
                    onClick={() => {
                      setSelectedNodeId(node.nodeId);
                      setAutoFollowLatest(false);
                    }}
                    onDoubleClick={() => openNodeEvidence(node.nodeId)}
                  >
                    <title>
                      {`${node.nodeId} · ${node.title} · score ${scorePct} · evidence ${evidencePct} · llm ${llmCalls} · failed ${llmFailed} · latency ${llmStat?.avgLatencyMs || 0}ms${primaryMutation ? ` · mutation ${primaryMutation.mutationKind} · files ${primaryMutation.targetFiles.length}` : ''}${latestNodeRun ? ` · nodeRun ${latestNodeRun.nodeRunId} · diff ${latestNodeRun.diffFiles} · resolved ${latestNodeRun.resolvedTargets}` : ''}${llmStat?.lastTask ? ` · ${llmStat.lastTask}` : ''}`}
                    </title>
                    {isJustRevealed && (
                      <rect
                        x={-3}
                        y={-3}
                        width={graph.cardWidth + 6}
                        height={graph.cardHeight + 6}
                        rx={16}
                        fill="none"
                        stroke="rgba(99,102,241,.95)"
                        strokeWidth={1.4}
                        strokeOpacity={0.2}
                      >
                        <animate attributeName="stroke-opacity" values="0.85;0.12;0" dur="1.2s" repeatCount="1" />
                        <animate attributeName="stroke-width" values="2.8;1.4;0.8" dur="1.2s" repeatCount="1" />
                      </rect>
                    )}
                    {isSpotlightNode && (
                      <rect
                        x={-5}
                        y={-5}
                        width={graph.cardWidth + 10}
                        height={graph.cardHeight + 10}
                        rx={18}
                        fill="none"
                        stroke="rgba(56,189,248,.95)"
                        strokeWidth={1.5}
                        strokeOpacity={0.22}
                      >
                        <animate attributeName="stroke-opacity" values="0.12;0.72;0.12" dur="1.4s" repeatCount="indefinite" />
                        <animate attributeName="stroke-width" values="1.2;2.6;1.2" dur="1.4s" repeatCount="indefinite" />
                      </rect>
                    )}
                    <rect
                      width={graph.cardWidth}
                      height={graph.cardHeight}
                      rx={14}
                      fill={cardBg}
                      stroke={
                        isReplayActive
                          ? 'rgba(99,102,241,.92)'
                          : isSpotlightNode
                          ? 'rgba(14,165,233,.92)'
                          : isFocused
                          ? 'rgba(37,99,235,.9)'
                          : spotlightMode && inSpotlightPath
                          ? `rgba(56,189,248,${0.36 + normalizedFrontier * 0.42})`
                          : branchViewMode === 'evidence'
                          ? `rgba(16,185,129,${0.28 + evidenceScore * 0.58})`
                          : llmCalls > 0
                          ? 'rgba(124,58,237,.55)'
                          : 'rgba(148,163,184,.7)'
                      }
                      strokeWidth={
                        isReplayActive
                          ? 2.2
                          : isSpotlightNode
                          ? 2.5
                          : isFocused
                          ? 1.9
                          : spotlightMode && inSpotlightPath
                          ? 1.3 + normalizedFrontier * 1.1
                          : branchViewMode === 'evidence'
                          ? 1.15 + evidenceScore * 1.25
                          : 1.2
                      }
                      filter={isFocused || evidenceGlow ? 'url(#tree-node-focus-canvas)' : 'url(#tree-node-shadow-canvas)'}
                    />
                    <circle cx={12} cy={13} r={3.5} fill={statusDot(node.status)}>
                      {isRunning && <animate attributeName="r" values="3.5;5;3.5" dur="1.25s" repeatCount="indefinite" />}
                    </circle>
                    <text x={20} y={16} fontSize={9.5} fontWeight={700} fill="#334155">{node.nodeId}</text>
                    <text x={20} y={33} fontSize={10.5} fontWeight={700} fill="#0f172a">
                      {nodeTitle.map((line, idx) => (
                        <tspan key={`${node.nodeId}-${idx}`} x={20} dy={idx === 0 ? 0 : 12}>{line}</tspan>
                      ))}
                    </text>
                    {primaryMutation && (
                      <>
                        <rect
                          x={20}
                          y={50}
                          width={mutationBadgeWidth}
                          height={13}
                          rx={6.5}
                          fill={mutationColors.fill}
                          stroke={mutationColors.stroke}
                          strokeWidth={0.7}
                        />
                        <text x={26} y={59.5} fontSize={7.7} fontWeight={700} fill={mutationColors.text}>
                          {mutationTag}
                        </text>
                      </>
                    )}
                    {latestNodeRun && (
                      <>
                        <rect
                          x={20}
                          y={65}
                          width={96}
                          height={11}
                          rx={5.5}
                          fill="rgba(37,99,235,.12)"
                          stroke="rgba(37,99,235,.34)"
                          strokeWidth={0.7}
                        />
                        <text x={25} y={73} fontSize={7.3} fontWeight={700} fill="#1d4ed8">
                          {`NR ${latestNodeRun.diffFiles}/${latestNodeRun.resolvedTargets}`}
                        </text>
                      </>
                    )}
                    {branchViewMode === 'evidence' && (
                      <>
                        <rect
                          x={graph.cardWidth - 116}
                          y={50}
                          width={40}
                          height={12}
                          rx={6}
                          fill="rgba(16,185,129,.15)"
                          stroke="rgba(16,185,129,.42)"
                          strokeWidth={0.7}
                        />
                        <text x={graph.cardWidth - 96} y={58.5} textAnchor="middle" fontSize={7.2} fontWeight={700} fill="#047857">
                          {`EV ${evidencePct}`}
                        </text>
                      </>
                    )}
                    {(frontierScore > 0 || normStatus === 'PENDING' || normStatus === 'RUNNING' || isSpotlightNode) && (
                      <>
                        <rect
                          x={graph.cardWidth - 114}
                          y={34}
                          width={34}
                          height={12}
                          rx={6}
                          fill={isSpotlightNode ? 'rgba(14,165,233,.2)' : 'rgba(59,130,246,.12)'}
                          stroke={isSpotlightNode ? 'rgba(14,165,233,.52)' : 'rgba(59,130,246,.34)'}
                          strokeWidth={0.7}
                        />
                        <text x={graph.cardWidth - 97} y={42.5} textAnchor="middle" fontSize={7.2} fontWeight={700} fill={isSpotlightNode ? '#0369a1' : '#1d4ed8'}>
                          {`F ${frontierPct}`}
                        </text>
                      </>
                    )}
                    {llmCalls > 0 && (
                      <>
                        {llmCalls >= 3 && (
                          <circle
                            cx={graph.cardWidth - 45}
                            cy={41}
                            r={8}
                            fill="rgba(139,92,246,.12)"
                            stroke="rgba(139,92,246,.45)"
                            strokeWidth={0.8}
                          >
                            <animate attributeName="r" values="6;9;6" dur="1.4s" repeatCount="indefinite" />
                            <animate attributeName="stroke-opacity" values="0.2;0.58;0.2" dur="1.4s" repeatCount="indefinite" />
                          </circle>
                        )}
                        <rect
                          x={graph.cardWidth - 72}
                          y={34}
                          width={54}
                          height={14}
                          rx={7}
                          fill={llmFailed > 0 ? 'rgba(251,113,133,.18)' : 'rgba(139,92,246,.18)'}
                        />
                        <text
                          x={graph.cardWidth - 45}
                          y={44}
                          textAnchor="middle"
                          fontSize={8}
                          fontWeight={700}
                          fill={llmFailed > 0 ? '#be123c' : '#6d28d9'}
                        >
                          LLM {llmCalls}
                        </text>
                      </>
                    )}
                    {hasChildren && (
                      <g
                        transform={`translate(${graph.cardWidth - 17}, 14)`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleNodeCollapsed(node.nodeId);
                        }}
                      >
                        <circle r={8} fill="rgba(255,255,255,.92)" stroke="rgba(148,163,184,.8)" strokeWidth={1} />
                        <line x1={-3} y1={0} x2={3} y2={0} stroke="#334155" strokeWidth={1.2} strokeLinecap="round" />
                        {isCollapsed && <line x1={0} y1={-3} x2={0} y2={3} stroke="#334155" strokeWidth={1.2} strokeLinecap="round" />}
                      </g>
                    )}
                    <text x={20} y={graph.cardHeight - 38} fontSize={8.2} fill="#475569">
                      {primaryMutation
                        ? `${tx('代码变更', 'Code change')} · ${mutationTag || 'CODE'} · files ${mutationTargets.length} · F ${frontierPct}`
                        : latestNodeRun
                        ? `${tx('最近运行', 'Latest run')} · diff ${latestNodeRun.diffFiles} · ok ${latestNodeRun.resolvedTargets} · F ${frontierPct}`
                        : `N ${searchMeta.visits} · V ${(searchMeta.value || 0).toFixed(2)} · F ${frontierPct}`}
                    </text>
                    <text x={20} y={graph.cardHeight - 28} fontSize={8.2} fill="#475569">
                      {primaryMutation
                        ? (mutationTargetHint || `${tx('策略', 'Strategy')}: ${primaryMutation.strategy}`)
                        : latestNodeRun
                        ? (latestRunTargetHint || `${tx('变更类型', 'Mutation')}: ${latestRunMutationKind || 'CODE'}`)
                        : `Sel ${searchMeta.selectedCount} · D ${searchMeta.depth}`}
                    </text>
                    <rect x={20} y={graph.cardHeight - 20} width={30} height={14} rx={7} fill="rgba(148,163,184,.16)" />
                    <text x={35} y={graph.cardHeight - 10} textAnchor="middle" fontSize={8.4} fontWeight={700} fill="#475569">
                      {riskLabel === 'high' ? 'H' : riskLabel === 'medium' ? 'M' : 'L'}
                    </text>
                    <text x={58} y={graph.cardHeight - 10} fontSize={8.4} fill="#475569">{tx('分支', 'Ch')} {visibleChildCount}/{childCount}</text>
                    {hiddenDescendantCount > 0 && (
                      <>
                        <rect x={graph.cardWidth - 112} y={graph.cardHeight - 22} width={44} height={14} rx={7} fill="rgba(15,23,42,.1)" />
                        <text x={graph.cardWidth - 90} y={graph.cardHeight - 11} textAnchor="middle" fontSize={8} fontWeight={700} fill="#334155">
                          +{hiddenDescendantCount}
                        </text>
                      </>
                    )}
                    <rect x={graph.cardWidth - 60} y={graph.cardHeight - 22} width={42} height={14} rx={7} fill={isFocused ? 'rgba(37,99,235,.2)' : 'rgba(59,130,246,.13)'} />
                    <text x={graph.cardWidth - 39} y={graph.cardHeight - 11} textAnchor="middle" fontSize={9.2} fontWeight={700} fill="#1d4ed8">
                      {scorePct}
                    </text>
                    <text x={graph.cardWidth - 6} y={graph.cardHeight - 11} textAnchor="end" fontSize={8.1} fill="#64748b">
                      {tx('评分', 'Score')}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {presentationMode ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            {!focusedNode ? (
              <div className="text-xs text-slate-500">{tx('双击节点进入证据页。', 'Double-click a node to open evidence page.')}</div>
            ) : (
              <div className="min-w-0 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{focusedNode.nodeId}</span>
                {' · '}
                {focusedNode.title || focusedNode.nodeId}
                {' · '}
                {tx('F', 'F')}
                {Math.round((getSearchMeta(focusedNode).frontierScore || 0) * 100)}
                {' · '}
                EV {Math.round((evidenceScoreByNode.get(focusedNode.nodeId) || 0) * 100)}
              </div>
            )}
            {focusedNode && (
              <button
                type="button"
                onClick={() => openNodeEvidence(focusedNode.nodeId)}
                className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
              >
                {tx('证据页', 'Evidence')} <ArrowRight className="ml-1 h-3 w-3" />
              </button>
            )}
          </div>
        ) : (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          {!focusedNode ? (
            <div className="text-xs text-slate-500">{tx('暂无聚焦节点。', 'No focused node.')}</div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-700">{focusedNode.nodeId}</span>
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${statusBadgeClass(focusedNode.status)}`}>{focusedNode.status}</span>
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700">
                    {tx('搜索评分', 'Search score')} {Math.round((getSearchMeta(focusedNode).frontierScore || 0) * 100) || '-'}
                  </span>
                  {spotlightMode && spotlightNodeId === focusedNode.nodeId && (
                    <span className="rounded bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-700">
                      {tx('探索焦点', 'Spotlight')}
                    </span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${(focusedNodeLlm?.total || 0) > 0 ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
                    LLM {focusedNodeLlm?.total || 0}
                  </span>
                  {(focusedNodeLlm?.total || 0) > 0 && (
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${(focusedNodeLlm?.failed || 0) > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {tx('失败', 'failed')} {focusedNodeLlm?.failed || 0}
                    </span>
                  )}
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700">
                    EV {Math.round((evidenceScoreByNode.get(focusedNode.nodeId) || 0) * 100)}
                  </span>
                  {focusedNodeRun && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">
                      {`NR ${focusedNodeRun.nodeRunId} · diff ${focusedNodeRun.diffFiles}`}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{focusedNode.title || focusedNode.nodeId}</div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">{focusedNode.hypothesis || '-'}</p>
                {focusedNodeMutationPlans.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {focusedNodeMutationPlans.slice(0, 3).map((item, idx) => {
                      const files = item.targetFiles
                        .slice(0, 2)
                        .map(path => String(path || '').split('/').pop() || String(path || ''))
                        .join(', ');
                      return (
                        <span
                          key={`focus-mutation-${idx}-${item.strategy}`}
                          className={`inline-flex items-center rounded px-1.5 py-0.5 font-semibold ${mutationTagClass(item.mutationKind)}`}
                          title={`${item.changeSummary}${files ? ` | files: ${files}` : ''}`}
                        >
                          {String(item.mutationKind || 'code').toUpperCase()}
                        </span>
                      );
                    })}
                  </div>
                )}
                {focusedNodeMutationPlans[0]?.changeSummary && (
                  <div className="mt-1 text-[11px] text-slate-600">
                    {tx('代码改动', 'Code change')}: {focusedNodeMutationPlans[0].changeSummary}
                  </div>
                )}
                {focusedNodeMutationPlans[0]?.targetFiles?.length > 0 && (
                  <div className="mt-1 text-[11px] text-slate-500">
                    {tx('目标文件', 'Target files')}: {focusedNodeMutationPlans[0].targetFiles.slice(0, 3).join(', ')}
                  </div>
                )}
                {(focusedNodeLlm?.total || 0) > 0 && (
                  <div className="mt-1 text-[11px] text-violet-700">
                    {tx('最近 LLM 任务', 'Latest LLM task')}: {focusedNodeLlm?.lastTask || '-'} · {tx('均延迟', 'avg latency')} {focusedNodeLlm?.avgLatencyMs || 0}ms
                  </div>
                )}
                {focusedNodeRun && (
                  <div className="mt-1 text-[11px] text-indigo-700">
                    {tx('最近代码证据', 'Latest code evidence')}: {focusedNodeRun.mutationKind.toUpperCase() || 'CODE'} ·
                    {' '}
                    {tx('命中', 'resolved')} {focusedNodeRun.resolvedTargets}
                    {' '}
                    · {tx('未命中', 'unresolved')} {focusedNodeRun.unresolvedTargets}
                    {' '}
                    · {tx('语法失败', 'syntax failed')} {focusedNodeRun.pythonSyntaxFailed}
                  </div>
                )}
                {focusedNodeRun?.changeSummary && (
                  <div className="mt-1 text-[11px] text-slate-600">
                    {tx('最近改动摘要', 'Latest change summary')}: {focusedNodeRun.changeSummary}
                  </div>
                )}
                {focusedNodeRun && focusedNodeRun.targetFiles.length > 0 && (
                  <div className="mt-1 text-[11px] text-slate-500">
                    {tx('最近目标文件', 'Latest target files')}: {focusedNodeRun.targetFiles.slice(0, 3).join(', ')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => centerNodeInViewport(focusedNode.nodeId)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  {tx('定位', 'Center')}
                </button>
                <button
                  type="button"
                  onClick={() => openNodeEvidence(focusedNode.nodeId)}
                  className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                >
                  {tx('证据页', 'Evidence')} <ArrowRight className="ml-1 h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </div>
        )}
      </section>

      {message && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </section>
      )}
    </div>
  );
};

export default AgenticTotCanvas;
