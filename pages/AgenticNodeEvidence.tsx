import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, GitBranchPlus, Play, RefreshCcw, WandSparkles } from 'lucide-react';
import { api } from '../services/api';
import { useI18n } from '../services/i18n';
import type { AgenticNode, AgenticRunDetail } from '../types';

type TimelineCategoryId = 'planning' | 'execution' | 'safety' | 'recovery' | 'evaluation' | 'other';

type TimelineCategoryMeta = {
  id: TimelineCategoryId;
  zh: string;
  en: string;
  dotClass: string;
  badgeClass: string;
};

type TimelineRow = {
  key: string;
  category: TimelineCategoryId;
  title: string;
  message: string;
  status: string;
  tsRaw: unknown;
  ts: number;
};

const statusBadgeClass = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'SUCCEEDED') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'FAILED') return 'bg-rose-100 text-rose-700';
  if (normalized === 'BLOCKED') return 'bg-amber-100 text-amber-700';
  if (normalized === 'RUNNING') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-600';
};

const parseMetricNumber = (raw: unknown): number | null => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw.replace(/[^\d.+-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const nodeScore = (node: AgenticNode, parentBranching: number, childCount: number): number => {
  const metrics = (node.expectedMetrics || {}) as Record<string, unknown>;
  const rawWinRate = metrics.winRate ?? metrics.win_rate;
  const parsedWinRate = parseMetricNumber(rawWinRate);
  const winRate = parsedWinRate === null ? 0.5 : parsedWinRate > 1 ? Math.min(1, parsedWinRate / 100) : Math.max(0, Math.min(1, parsedWinRate));
  const risk = String(node.risk || 'low').toLowerCase();
  const riskPenalty = risk === 'high' ? 0.24 : risk === 'medium' ? 0.12 : 0.02;
  const exploration = Math.sqrt(Math.log(parentBranching + 2) / (childCount + 1));
  return Math.max(0, Math.min(1, winRate * 0.62 + exploration * 0.33 - riskPenalty));
};

const parseTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
};

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const statusLabel = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (!normalized) return '-';
  return normalized[0] + normalized.slice(1).toLowerCase();
};

const findNodeRef = (row: Record<string, unknown>) => {
  const direct = row.nodeId ?? row.node_id ?? row.node ?? row.nodeRef;
  return typeof direct === 'string' ? direct : '';
};
const formatTimestamp = (value: unknown) => new Date(parseTimestamp(value)).toLocaleString();
const timelineCategoryMeta: Record<TimelineCategoryId, TimelineCategoryMeta> = {
  planning: { id: 'planning', zh: '规划', en: 'Planning', dotClass: 'bg-sky-500', badgeClass: 'bg-sky-100 text-sky-700' },
  execution: { id: 'execution', zh: '执行', en: 'Execution', dotClass: 'bg-indigo-500', badgeClass: 'bg-indigo-100 text-indigo-700' },
  safety: { id: 'safety', zh: '安全', en: 'Safety', dotClass: 'bg-amber-500', badgeClass: 'bg-amber-100 text-amber-700' },
  recovery: { id: 'recovery', zh: '恢复', en: 'Recovery', dotClass: 'bg-emerald-500', badgeClass: 'bg-emerald-100 text-emerald-700' },
  evaluation: { id: 'evaluation', zh: '评估', en: 'Evaluation', dotClass: 'bg-violet-500', badgeClass: 'bg-violet-100 text-violet-700' },
  other: { id: 'other', zh: '其他', en: 'Other', dotClass: 'bg-slate-400', badgeClass: 'bg-slate-100 text-slate-700' },
};
const timelineCategoryOrder: TimelineCategoryId[] = ['planning', 'execution', 'safety', 'recovery', 'evaluation', 'other'];
const detectTimelineCategory = (row: Record<string, unknown>, title: string, message: string): TimelineCategoryId => {
  const combined = `${String(row.phase || '')} ${String(row.event || '')} ${title} ${message}`.toLowerCase();
  if (combined.includes('approval') || combined.includes('blocked') || combined.includes('policy') || combined.includes('safety')) return 'safety';
  if (combined.includes('recover') || combined.includes('retry') || combined.includes('repair') || combined.includes('fallback')) return 'recovery';
  if (combined.includes('matrix') || combined.includes('league') || combined.includes('elo') || combined.includes('eval')) return 'evaluation';
  if (combined.includes('plan') || combined.includes('spec') || combined.includes('idea') || combined.includes('draft')) return 'planning';
  if (combined.includes('execute') || combined.includes('run') || combined.includes('train') || combined.includes('branch')) return 'execution';
  return 'other';
};

export const AgenticNodeEvidence: React.FC = () => {
  const navigate = useNavigate();
  const { tx } = useI18n();
  const params = useParams();

  const runId = decodeURIComponent(params.runId || '');
  const nodeId = decodeURIComponent(params.nodeId || '');

  const [detail, setDetail] = useState<AgenticRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'none' | 'refresh' | 'next' | 'branch'>('none');
  const [message, setMessage] = useState('');
  const [timelineFilter, setTimelineFilter] = useState<'all' | TimelineCategoryId>('all');

  const [branchDraft, setBranchDraft] = useState({
    title: '',
    hypothesis: '',
    executionPlan: '',
    risk: 'medium',
  });

  const loadRun = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const res = await api.getAgenticRun(runId);
      setDetail(res);
    } catch (error) {
      setMessage(toErrorMessage(error));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    loadRun().catch(() => undefined);
  }, [loadRun]);
  useEffect(() => {
    setTimelineFilter('all');
  }, [nodeId]);

  const nodeById = useMemo(() => {
    const map = new Map<string, AgenticNode>();
    (detail?.totTree || []).forEach(node => map.set(node.nodeId, node));
    return map;
  }, [detail]);

  const selectedNode = useMemo(() => nodeById.get(nodeId) || null, [nodeById, nodeId]);

  const childCountByParent = useMemo(() => {
    const map = new Map<string, number>();
    (detail?.totTree || []).forEach(node => {
      if (!node.parentId) return;
      map.set(node.parentId, (map.get(node.parentId) || 0) + 1);
    });
    return map;
  }, [detail]);

  const selectedNodeScore = useMemo(() => {
    if (!selectedNode) return 0;
    const parentCount = selectedNode.parentId ? childCountByParent.get(selectedNode.parentId) || 1 : 1;
    const childCount = childCountByParent.get(selectedNode.nodeId) || 0;
    return nodeScore(selectedNode, parentCount, childCount);
  }, [selectedNode, childCountByParent]);

  const selectedNodePath = useMemo(() => {
    if (!selectedNode) return [] as AgenticNode[];
    const path: AgenticNode[] = [];
    const seen = new Set<string>();
    let cursor: AgenticNode | undefined = selectedNode;
    while (cursor && !seen.has(cursor.nodeId)) {
      path.unshift(cursor);
      seen.add(cursor.nodeId);
      cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
    }
    return path;
  }, [selectedNode, nodeById]);
  const parentNode = useMemo(() => {
    if (!selectedNode?.parentId) return null;
    return nodeById.get(selectedNode.parentId) || null;
  }, [selectedNode, nodeById]);
  const siblingNodes = useMemo(() => {
    if (!selectedNode || !detail) return [] as AgenticNode[];
    return (detail.totTree || []).filter(node => node.parentId === selectedNode.parentId && node.nodeId !== selectedNode.nodeId);
  }, [selectedNode, detail]);
  const childNodes = useMemo(() => {
    if (!selectedNode || !detail) return [] as AgenticNode[];
    return (detail.totTree || []).filter(node => node.parentId === selectedNode.nodeId);
  }, [selectedNode, detail]);

  const nodeEvents = useMemo(() => {
    if (!detail || !nodeId) return [] as Array<Record<string, unknown>>;
    const merged = [...(detail.timeline || []), ...(detail.events || [])] as Array<Record<string, unknown>>;
    return merged
      .filter(item => {
        const ref = findNodeRef(item);
        if (ref && ref === nodeId) return true;
        const messageText = `${item.message || ''} ${item.title || ''}`;
        return messageText.includes(nodeId);
      })
      .sort((a, b) => parseTimestamp(a.ts) - parseTimestamp(b.ts));
  }, [detail, nodeId]);
  const timelineRows = useMemo(() => {
    return nodeEvents.map((item, idx) => {
      const title = String(item.event || item.phase || item.title || '-');
      const status = String(item.status || item.level || 'INFO').toUpperCase();
      const messageText = String(item.message || item.detail || '');
      const tsRaw = item.ts || item.timestamp || item.createdAt || item.updatedAt || '-';
      const category = detectTimelineCategory(item, title, messageText);
      return {
        key: `${String(tsRaw)}-${idx}`,
        category,
        title,
        message: messageText,
        status,
        tsRaw,
        ts: parseTimestamp(tsRaw),
      };
    });
  }, [nodeEvents]);
  const timelineCountByCategory = useMemo(() => {
    const counts: Record<TimelineCategoryId, number> = {
      planning: 0,
      execution: 0,
      safety: 0,
      recovery: 0,
      evaluation: 0,
      other: 0,
    };
    timelineRows.forEach(row => {
      counts[row.category] += 1;
    });
    return counts;
  }, [timelineRows]);
  const filteredTimelineRows = useMemo(() => {
    if (timelineFilter === 'all') return timelineRows;
    return timelineRows.filter(row => row.category === timelineFilter);
  }, [timelineRows, timelineFilter]);
  const layeredTimeline = useMemo(() => {
    return timelineCategoryOrder
      .map(category => ({
        category,
        rows: filteredTimelineRows.filter(row => row.category === category),
      }))
      .filter(layer => layer.rows.length > 0);
  }, [filteredTimelineRows]);

  const handleRefresh = async () => {
    setBusy('refresh');
    setMessage('');
    await loadRun();
    setBusy('none');
  };

  const handleRunNext = async () => {
    if (!runId) return;
    setBusy('next');
    setMessage('');
    try {
      const res = await api.executeAgenticRun(runId, { mode: 'next' });
      setDetail(res.detail);
      setMessage(res.message || tx('执行成功。', 'Execution succeeded.'));
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setBusy('none');
    }
  };

  const handleCreateBranch = async () => {
    if (!runId || !selectedNode) return;
    if (!branchDraft.title.trim() || !branchDraft.hypothesis.trim() || !branchDraft.executionPlan.trim()) {
      setMessage(tx('请补全分支标题/假设/计划。', 'Please complete branch title/hypothesis/plan.'));
      return;
    }

    setBusy('branch');
    setMessage('');
    try {
      const res = await api.addAgenticBranch(runId, selectedNode.nodeId, {
        title: branchDraft.title.trim(),
        hypothesis: branchDraft.hypothesis.trim(),
        executionPlan: branchDraft.executionPlan.trim(),
        risk: branchDraft.risk,
      });
      setDetail(res.detail);
      setBranchDraft({ title: '', hypothesis: '', executionPlan: '', risk: 'medium' });
      setMessage(res.message || tx('分支创建成功。', 'Branch created.'));
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setBusy('none');
    }
  };

  const registryRows = useMemo(() => {
    if (!detail) return [] as Array<[string, string]>;
    return Object.entries(detail.registryRecord || {}).slice(0, 12).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
  }, [detail]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/agentic')}
              className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {tx('返回树搜索', 'Back to Tree')}
            </button>
            <button
              type="button"
              onClick={() => runId && navigate(`/agentic/runs/${encodeURIComponent(runId)}/agents`)}
              className="inline-flex items-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-100"
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
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={busy !== 'none'}
              className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCcw className={`mr-1.5 h-4 w-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
              {tx('刷新', 'Refresh')}
            </button>
            <button
              type="button"
              onClick={handleRunNext}
              disabled={busy !== 'none'}
              className="inline-flex items-center rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              <Play className="mr-1.5 h-4 w-4" />
              {tx('执行下一步', 'Run Next')}
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
          {tx('加载节点证据中...', 'Loading node evidence...')}
        </section>
      ) : !detail ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
          {tx('未找到运行详情。', 'Run detail not found.')}
        </section>
      ) : !selectedNode ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-600">
            {tx('节点不存在，请从树图重新进入。', 'Node not found. Open it again from tree view.')}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(detail.totTree || []).slice(0, 20).map(node => (
              <button
                key={`node-fallback-${node.nodeId}`}
                type="button"
                onClick={() => navigate(`/agentic/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.nodeId)}`)}
                className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                {node.nodeId}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-4xl">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {selectedNodePath.map((node, idx) => (
                    <React.Fragment key={`path-${node.nodeId}`}>
                      <button
                        type="button"
                        onClick={() => navigate(`/agentic/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.nodeId)}`)}
                        className="rounded bg-slate-100 px-2 py-1 hover:bg-slate-200"
                      >
                        {node.nodeId}
                      </button>
                      {idx < selectedNodePath.length - 1 && <span>/</span>}
                    </React.Fragment>
                  ))}
                </div>
                <h1 className="display-title text-2xl font-semibold text-slate-900">{selectedNode.title || selectedNode.nodeId}</h1>
                <p className="mt-2 text-sm text-slate-600">{selectedNode.hypothesis || '-'}</p>
              </div>
              <div className="space-y-2 text-right">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(selectedNode.status)}`}>
                  {statusLabel(selectedNode.status)}
                </span>
                <div className="text-xs text-slate-500">
                  UCT-like: <span className="font-semibold text-blue-700">{Math.round(selectedNodeScore * 100)}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {tx('风险', 'Risk')}: <span className="font-semibold text-slate-700">{String(selectedNode.risk || 'low').toLowerCase()}</span>
                </div>
              </div>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('决策上下文导航', 'Decision Context Navigator')}</h2>
            <div className="mt-2 grid gap-2 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tx('父节点', 'Parent')}</div>
                {!parentNode ? (
                  <div className="mt-1 text-xs text-slate-500">{tx('无', 'None')}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate(`/agentic/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(parentNode.nodeId)}`)}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {parentNode.nodeId} · {parentNode.title || '-'}
                  </button>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tx('同级节点', 'Siblings')}</div>
                <div className="mt-1 max-h-24 space-y-1 overflow-auto">
                  {siblingNodes.length === 0 && <div className="text-xs text-slate-500">{tx('无', 'None')}</div>}
                  {siblingNodes.map(node => (
                    <button
                      key={`sibling-${node.nodeId}`}
                      type="button"
                      onClick={() => navigate(`/agentic/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.nodeId)}`)}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                    >
                      {node.nodeId}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tx('子节点', 'Children')}</div>
                <div className="mt-1 max-h-24 space-y-1 overflow-auto">
                  {childNodes.length === 0 && <div className="text-xs text-slate-500">{tx('无', 'None')}</div>}
                  {childNodes.map(node => (
                    <button
                      key={`child-${node.nodeId}`}
                      type="button"
                      onClick={() => navigate(`/agentic/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.nodeId)}`)}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                    >
                      {node.nodeId}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-12">
            <div className="space-y-4 xl:col-span-8">
              <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('执行计划', 'Execution Plan')}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{selectedNode.executionPlan || '-'}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tx('预期指标', 'Expected Metrics')}</div>
                    <pre className="mt-2 max-h-56 overflow-auto text-xs text-slate-700">{JSON.stringify(selectedNode.expectedMetrics || {}, null, 2)}</pre>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tx('预算约束', 'Budget')}</div>
                    <pre className="mt-2 max-h-56 overflow-auto text-xs text-slate-700">{JSON.stringify(selectedNode.budget || {}, null, 2)}</pre>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('节点证据', 'Node Evidence')}</h2>
                <pre className="mt-2 max-h-[22rem] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  {JSON.stringify(selectedNode.evidence || {}, null, 2)}
                </pre>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('节点事件回放', 'Node Event Replay')}</h2>
                <div className="mt-3">
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTimelineFilter('all')}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${timelineFilter === 'all' ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      {tx('全部', 'All')} ({timelineRows.length})
                    </button>
                    {timelineCategoryOrder.map(category => {
                      const count = timelineCountByCategory[category];
                      if (!count) return null;
                      const meta = timelineCategoryMeta[category];
                      const isActive = timelineFilter === category;
                      return (
                        <button
                          key={`timeline-filter-${category}`}
                          type="button"
                          onClick={() => setTimelineFilter(category)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${isActive ? meta.badgeClass : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                        >
                          {tx(meta.zh, meta.en)} ({count})
                        </button>
                      );
                    })}
                  </div>
                  {timelineRows.length === 0 && <div className="text-xs text-slate-500">{tx('当前节点没有匹配事件。', 'No events matched this node.')}</div>}
                  <div className="space-y-3">
                    {layeredTimeline.map(layer => {
                      const meta = timelineCategoryMeta[layer.category];
                      return (
                        <div key={`layer-${layer.category}`} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
                              <span className="text-xs font-semibold text-slate-700">{tx(meta.zh, meta.en)}</span>
                            </div>
                            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">{layer.rows.length}</span>
                          </div>
                          <div className="space-y-2">
                            {layer.rows.map(row => (
                              <div key={row.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-xs font-semibold text-slate-700">{row.title}</div>
                                  <div className="text-[11px] text-slate-500">{formatTimestamp(row.tsRaw)}</div>
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500">{row.status}</div>
                                {row.message && <div className="mt-1 text-xs text-slate-700">{row.message}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            </div>

            <aside className="space-y-4 xl:col-span-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('新增分支', 'Create Branch')}</h2>
                <div className="mt-2 space-y-2">
                  <input
                    value={branchDraft.title}
                    onChange={e => setBranchDraft(prev => ({ ...prev, title: e.target.value }))}
                    placeholder={tx('分支标题', 'Branch title')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={branchDraft.hypothesis}
                    onChange={e => setBranchDraft(prev => ({ ...prev, hypothesis: e.target.value }))}
                    placeholder={tx('分支假设', 'Hypothesis')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={branchDraft.executionPlan}
                    onChange={e => setBranchDraft(prev => ({ ...prev, executionPlan: e.target.value }))}
                    placeholder={tx('执行计划', 'Execution plan')}
                    rows={4}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <select
                    value={branchDraft.risk}
                    onChange={e => setBranchDraft(prev => ({ ...prev, risk: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleCreateBranch}
                    disabled={busy !== 'none'}
                    className="inline-flex w-full items-center justify-center rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    <GitBranchPlus className="mr-1.5 h-4 w-4" />
                    {busy === 'branch' ? tx('创建中...', 'Creating...') : tx('创建分支', 'Create Branch')}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('合同与注册账本', 'Contract & Registry')}</h2>
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <div>{tx('合同通过率', 'Pass rate')}: {Math.round(((detail.contract?.passRate || 0) * 100))}%</div>
                  <div>{tx('缺失项', 'Missing')}: {(detail.contract?.missing || []).length}</div>
                </div>
                <div className="mt-2 max-h-60 overflow-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-xs">
                    <tbody>
                      {registryRows.map(([key, value]) => (
                        <tr key={`registry-${key}`} className="border-b border-slate-100">
                          <td className="w-40 px-2 py-1.5 font-semibold text-slate-600">{key}</td>
                          <td className="px-2 py-1.5 text-slate-700">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </aside>
          </section>
        </>
      )}

      {message && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </section>
      )}
    </div>
  );
};

export default AgenticNodeEvidence;
