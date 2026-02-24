import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bot, ChevronDown, ChevronUp, Pause, Play, RefreshCcw, ShieldAlert, SlidersHorizontal, Sparkles, WandSparkles } from 'lucide-react';
import { api, isDemoMode } from '../services/api';
import { useI18n } from '../services/i18n';
import type { AgenticIdeaInput, AgenticNode, AgenticRunDetail, AgenticRunSummary } from '../types';

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

  const loadRun = useCallback(async (runId: string) => {
    if (!runId) {
      setDetail(null);
      return;
    }
    setLoadingRun(true);
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
      setMessage(toErrorMessage(error));
      setDetail(null);
    } finally {
      setLoadingRun(false);
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
    loadRun(selectedRunId).catch(() => undefined);
  }, [selectedRunId, loadRun]);

  useEffect(() => {
    if (!selectedRunId) return;
    if (autoExploring) return;
    const status = String(detail?.status || '').toUpperCase();
    if (status !== 'RUNNING' && status !== 'PENDING' && status !== 'BLOCKED') return;
    const intervalMs = status === 'BLOCKED' ? 10000 : 2500;
    const timer = window.setInterval(() => {
      loadRun(selectedRunId).catch(() => undefined);
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

  const filteredNodes = useMemo(() => nodes, [nodes]);

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
      group.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
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
  }, [visibleNodes, visibleNodeMap]);

  const focusedNodeId = useMemo(() => {
    if (selectedNodeId && visibleNodeMap.has(selectedNodeId)) return selectedNodeId;
    if (hoveredNodeId && visibleNodeMap.has(hoveredNodeId)) return hoveredNodeId;
    if (replayNodeId && visibleNodeMap.has(replayNodeId)) return replayNodeId;
    return visibleNodes[0]?.nodeId || '';
  }, [selectedNodeId, hoveredNodeId, replayNodeId, visibleNodes, visibleNodeMap]);

  const focusedNode = useMemo(() => (focusedNodeId ? nodeById.get(focusedNodeId) || null : null), [focusedNodeId, nodeById]);

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
  const storyStages = useMemo(() => {
    const hasRun = !!selectedRunId;
    const depth = Number(searchStats?.maxDepth || 0);
    const expansions = Number(searchStats?.expandedNodes || 0);
    const selections = Number(searchStats?.selectionEvents || 0);
    const coverage = Math.round(Number(searchStats?.explorationCoverage || 0) * 100);
    const succeeded = Number(runStats.succeeded || 0);
    const contractPass = Math.round(Number(selectedRunSummary?.contractPassRate || 0) * 100);
    const finalSucceeded = String(detail?.status || '').toUpperCase() === 'SUCCEEDED';

    return [
      {
        key: 'idea',
        titleZh: '1) 接收 Idea',
        titleEn: '1) Capture Idea',
        done: hasRun,
        metricZh: hasRun ? `Run ${selectedRunId}` : '等待输入',
        metricEn: hasRun ? `Run ${selectedRunId}` : 'Waiting input',
      },
      {
        key: 'expand',
        titleZh: '2) 自动展开假设',
        titleEn: '2) Expand Hypotheses',
        done: depth >= 2 || expansions >= 1,
        metricZh: `深度 ${depth} · 扩展 ${expansions}`,
        metricEn: `Depth ${depth} · Expanded ${expansions}`,
      },
      {
        key: 'execute',
        titleZh: '3) 执行与筛选',
        titleEn: '3) Execute & Select',
        done: selections >= 1 && succeeded >= 1,
        metricZh: `选择 ${selections} · 成功 ${succeeded}`,
        metricEn: `Selected ${selections} · Succeeded ${succeeded}`,
      },
      {
        key: 'synthesize',
        titleZh: '4) 形成证据结论',
        titleEn: '4) Synthesize Evidence',
        done: finalSucceeded || contractPass >= 95,
        metricZh: `覆盖 ${coverage}% · 合同 ${contractPass}%`,
        metricEn: `Coverage ${coverage}% · Contract ${contractPass}%`,
      },
    ];
  }, [selectedRunId, searchStats, runStats, selectedRunSummary, detail?.status]);

  const searchReplayEvents = useMemo(() => {
    const replayRows: SearchReplayEvent[] = [];
    const eventRows = Array.isArray(detail?.events) ? detail?.events : [];
    eventRows.forEach((row, idx) => {
      const event = String((row as any)?.event || '');
      if (event !== 'search_node_selected' && event !== 'tot_node_expanded') return;
      const payload = ((row as any)?.payload || {}) as Record<string, unknown>;
      const nodeId = String(payload.nodeId || payload.node_id || '');
      if (!nodeId) return;
      replayRows.push({
        idx,
        event,
        ts: String((row as any)?.ts || ''),
        nodeId,
        summary: String((row as any)?.message || event),
      });
    });
    return replayRows;
  }, [detail?.events]);

  const replayActiveEvent = useMemo(() => {
    if (searchReplayEvents.length === 0 || replayStep <= 0) return null;
    const idx = Math.min(searchReplayEvents.length - 1, replayStep - 1);
    return searchReplayEvents[idx] || null;
  }, [searchReplayEvents, replayStep]);

  const replayNodeId = replayActiveEvent?.nodeId || '';

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
    setReplayStep(prev => {
      if (prev <= 0) return searchReplayEvents.length;
      return Math.min(prev, searchReplayEvents.length);
    });
  }, [searchReplayEvents.length]);

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
    if (visibleNodes.length === 0) {
      setSelectedNodeId('');
      return;
    }
    if (!selectedNodeId || !visibleNodes.some(node => node.nodeId === selectedNodeId)) {
      setSelectedNodeId(visibleNodes[0].nodeId);
    }
  }, [visibleNodes, selectedNodeId]);

  useEffect(() => {
    if (!replayActiveEvent?.nodeId) return;
    if (!visibleNodeMap.has(replayActiveEvent.nodeId)) return;
    if (!replayPlaying) return;
    setSelectedNodeId(replayActiveEvent.nodeId);
    centerNodeInViewport(replayActiveEvent.nodeId, 'smooth');
  }, [replayActiveEvent?.idx, replayActiveEvent?.nodeId, replayPlaying, visibleNodeMap, centerNodeInViewport]);

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
      setMessage(toErrorMessage(error));
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
        const created = await api.createAgenticRun({
          idea: buildAutoScienceIdea(),
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
        setMessage(tx('自动探索已暂停：遇到安全审批，请到 Agent 面板处理后继续。', 'Auto exploration paused: safety approval required. Approve in Agent Panel and continue.'));
      } else {
        setMessage(tx('自动探索已完成一轮：你可以继续点击 Auto Explore 让树继续生长。', 'Auto exploration round complete. Click Auto Explore again to keep growing the tree.'));
      }
    } catch (error) {
      setMessage(toErrorMessage(error));
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
      <section className="rounded-3xl border border-slate-200 bg-gradient-to-r from-blue-50 via-white to-cyan-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <div className="mb-2 inline-flex items-center rounded-full border border-blue-200 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {tx('纯 ToT 图面', 'Pure ToT Canvas')}
            </div>
            <h1 className="display-title text-2xl font-semibold text-slate-900">
              {tx('Agentic ToT 搜索画布', 'Agentic ToT Search Canvas')}
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              {tx('这里只展示决策树。Idea 输入、Agent 面板、节点证据都跳转到独立页面。', 'This page is tree-only. Idea input, agent panel, and node evidence are separate pages.')}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {tx('目标：让评委 10 秒理解“给一个 idea -> 自动展开探索 -> 产出证据结论”。', 'Goal: make it obvious in 10 seconds: one idea -> automatic exploration -> evidence-backed outcome.')}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>{tx('链路来源', 'Pipeline source')}: <span className="font-semibold">{isDemoMode ? 'Demo API' : 'Live API'}</span></div>
            {selectedRunSummary && (
              <div className={`mt-1 inline-flex rounded-full px-2 py-1 font-semibold text-[11px] ${statusBadgeClass(selectedRunSummary.status)}`}>
                {selectedRunSummary.status}
              </div>
            )}
            <div className="mt-2">
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
                {presentationMode ? tx('切到专家模式', 'Switch to Expert') : tx('切到评委模式', 'Switch to Judge')}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-800">{tx('Auto-Science 进度', 'Auto-Science Progress')}</div>
          <div className="text-xs text-slate-500">{tx('简化叙事，先看这四步再看树。', 'Narrative first, tree second.')}</div>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          {storyStages.map(stage => (
            <div
              key={stage.key}
              className={`rounded-xl border px-3 py-2 ${
                stage.done
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className={`text-xs font-semibold ${stage.done ? 'text-emerald-700' : 'text-slate-700'}`}>
                {tx(stage.titleZh, stage.titleEn)}
              </div>
              <div className="mt-1 text-[11px] text-slate-600">{tx(stage.metricZh, stage.metricEn)}</div>
            </div>
          ))}
        </div>
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
                onClick={() => navigate('/agentic/new')}
                className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
              >
                {tx('Idea 输入', 'Idea Input')}
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
                onClick={() => navigate('/agentic/workbench')}
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
          {presentationMode && showAdvancedControls && (
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
                onClick={() => navigate('/agentic/new')}
                className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
              >
                {tx('Idea 输入', 'Idea Input')}
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
              <button
                type="button"
                onClick={() => navigate('/agentic/workbench')}
                className="inline-flex items-center rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
              >
                {tx('探索洞察', 'Exploration Insights')}
              </button>
            </>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded bg-slate-100 px-2 py-1">{tx('总节点', 'Nodes')} {runStats.total}</span>
          <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">{tx('运行中', 'Running')} {runStats.running}</span>
          <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{tx('成功', 'Succeeded')} {runStats.succeeded}</span>
          <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">{tx('阻塞', 'Blocked')} {runStats.blocked}</span>
          <span className="rounded bg-rose-50 px-2 py-1 text-rose-700">{tx('失败', 'Failed')} {runStats.failed}</span>
          <span className="rounded bg-slate-100 px-2 py-1">{tx('待执行', 'Pending')} {runStats.pending}</span>
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
          {selectedRunSummary && (
            <span className="rounded bg-slate-100 px-2 py-1">{tx('合同', 'Contract')} {Math.round((selectedRunSummary.contractPassRate || 0) * 100)}%</span>
          )}
        </div>
      </section>

      {searchReplayEvents.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800">{tx('探索回放', 'Exploration Replay')}</div>
            <div className="text-xs text-slate-500">
              {tx('拖动滑杆可回看树是如何被逐步扩展的。', 'Use the slider to replay how the tree expanded step by step.')}
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
              }}
              className="min-w-[16rem] flex-1 accent-indigo-600"
            />
            <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {replayStep}/{searchReplayEvents.length}
            </span>
          </div>
          {replayActiveEvent && (
            <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
              <div className="font-semibold">{replayActiveEvent.event} · {replayActiveEvent.nodeId}</div>
              <div className="mt-0.5 text-indigo-800">{replayActiveEvent.summary}</div>
            </div>
          )}
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
            {tx('单击节点聚焦，双击进入证据页。', 'Single-click to focus, double-click to open evidence.')}
          </div>
        </div>

        <div ref={graphViewportRef} className="max-h-[72vh] overflow-auto rounded-xl border border-slate-200 bg-[radial-gradient(circle_at_0%_0%,rgba(219,234,254,.34),transparent_42%),radial-gradient(circle_at_100%_0%,rgba(209,250,229,.24),transparent_38%),linear-gradient(180deg,rgba(248,250,252,.72),rgba(255,255,255,.95))]">
          {loadingRun ? (
            <div className="p-6 text-sm text-slate-500">{tx('加载运行详情中...', 'Loading run detail...')}</div>
          ) : visibleNodes.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">{tx('暂无节点。先从 Idea 页创建一个 Run。', 'No nodes yet. Create a run from Idea Input page.')}</div>
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
                const highlighted = edge.from === focusedNodeId || edge.to === focusedNodeId;
                const runningEdge = String(visibleNodeMap.get(edge.from)?.status || '').toUpperCase() === 'RUNNING'
                  || String(visibleNodeMap.get(edge.to)?.status || '').toUpperCase() === 'RUNNING';
                const path = `M ${from.x + graph.cardWidth} ${from.y} C ${from.x + graph.cardWidth + 56} ${from.y}, ${to.x - 56} ${to.y}, ${to.x} ${to.y}`;
                return (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={path}
                    fill="none"
                    stroke={highlighted ? '#2563eb' : 'url(#tree-edge-canvas)'}
                    strokeWidth={highlighted ? 2.3 : 1.7}
                    strokeOpacity={highlighted ? 0.9 : 0.7}
                    strokeDasharray={runningEdge ? '6 4' : undefined}
                    style={{ transition: 'stroke 180ms ease, stroke-width 180ms ease, stroke-opacity 180ms ease' }}
                  />
                );
              })}

              {visibleNodes.map(node => {
                const point = graph.layout.get(node.nodeId);
                if (!point) return null;
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
                const riskLabel = String(node.risk || 'low').toLowerCase();
                const hasChildren = (filteredChildCountByParent.get(node.nodeId) || 0) > 0;
                const isCollapsed = !!collapsedNodeIds[node.nodeId];
                const hiddenDescendantCount = isCollapsed ? descendantCountByNode.get(node.nodeId) || 0 : 0;
                const searchMeta = getSearchMeta(node);
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
                    onMouseEnter={() => setHoveredNodeId(node.nodeId)}
                    onClick={() => setSelectedNodeId(node.nodeId)}
                    onDoubleClick={() => openNodeEvidence(node.nodeId)}
                  >
                    <title>{`${node.nodeId} · ${node.title} · score ${scorePct}`}</title>
                    <rect
                      width={graph.cardWidth}
                      height={graph.cardHeight}
                      rx={14}
                      fill={cardBg}
                      stroke={isReplayActive ? 'rgba(99,102,241,.92)' : (isFocused ? 'rgba(37,99,235,.9)' : 'rgba(148,163,184,.7)')}
                      strokeWidth={isReplayActive ? 2.2 : (isFocused ? 1.9 : 1.2)}
                      filter={isFocused ? 'url(#tree-node-focus-canvas)' : 'url(#tree-node-shadow-canvas)'}
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
                    <text x={20} y={graph.cardHeight - 38} fontSize={8.2} fill="#475569">N {searchMeta.visits} · V {(searchMeta.value || 0).toFixed(2)}</text>
                    <text x={20} y={graph.cardHeight - 28} fontSize={8.2} fill="#475569">Sel {searchMeta.selectedCount} · D {searchMeta.depth}</text>
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
                      UCT
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          {!focusedNode ? (
            <div className="text-xs text-slate-500">{tx('暂无聚焦节点。', 'No focused node.')}</div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-700">{focusedNode.nodeId}</span>
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${statusBadgeClass(focusedNode.status)}`}>{focusedNode.status}</span>
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700">UCT {Math.round((getSearchMeta(focusedNode).frontierScore || 0) * 100) || '-'}</span>
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{focusedNode.title || focusedNode.nodeId}</div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">{focusedNode.hypothesis || '-'}</p>
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
