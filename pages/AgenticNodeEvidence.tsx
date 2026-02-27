import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, GitBranchPlus, Play, RefreshCcw, WandSparkles } from 'lucide-react';
import { api } from '../services/api';
import { useI18n } from '../services/i18n';
import type { AgenticLlmTraceRecord, AgenticNode, AgenticNodeRunRecord, AgenticRunDetail, AgenticSubAgentRecord } from '../types';

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

type NodeMutationPlan = {
  strategy: string;
  mutationKind: string;
  changeSummary: string;
  targetFiles: string[];
  validationCommand: string;
  risk: string;
  source: string;
};

type NodeRunDiffPreview = {
  patchFile: string;
  targets: string[];
  mutationKind: string;
  strategy: string;
  changeSummary: string;
  validationCommand: string;
  preview: string;
};

type NodeRunFileMutation = {
  target: string;
  mutationMode: string;
  syntaxValid?: boolean;
  syntaxError?: string;
};

type NodeRunArtifactEvidence = {
  diffFiles: number;
  resolvedTargets: number;
  unresolvedTargets: number;
  pythonSyntaxFailed: number;
  diffPreviews: NodeRunDiffPreview[];
  fileMutations: NodeRunFileMutation[];
};

type DiffPreviewLine = {
  kind: 'hunk' | 'add' | 'remove' | 'context';
  text: string;
};

type DiffSideBySideRow = {
  left: string;
  right: string;
  leftKind: 'hunk' | 'add' | 'remove' | 'context' | 'empty';
  rightKind: 'hunk' | 'add' | 'remove' | 'context' | 'empty';
};

type EvidenceTab = 'overview' | 'timeline' | 'llm' | 'branch' | 'contract';

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

const extractNodeRunMutationPlans = (run: AgenticNodeRunRecord): NodeMutationPlan[] => {
  const rows = Array.isArray(run.patchPlan) ? run.patchPlan : [];
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
      source: `node_run:${run.nodeRunId}`,
    }));
};

const mutationTagClass = (kind: string) => {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'architecture') return 'bg-cyan-100 text-cyan-700';
  if (normalized === 'loss' || normalized === 'objective') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'integration' || normalized === 'ops') return 'bg-amber-100 text-amber-700';
  if (normalized === 'evaluation') return 'bg-violet-100 text-violet-700';
  return 'bg-slate-100 text-slate-700';
};

const extractNodeRunArtifactEvidence = (run: AgenticNodeRunRecord): NodeRunArtifactEvidence => {
  const metrics = asRecord(run.metrics);
  const artifacts = asRecord(metrics.nodeRunArtifacts);
  const diffPreviews = (Array.isArray(artifacts.diffPreviews) ? artifacts.diffPreviews : [])
    .map(item => asRecord(item))
    .map(item => ({
      patchFile: String(item.patchFile || ''),
      targets: asStringArray(item.targets),
      mutationKind: String(item.mutationKind || 'code').toLowerCase(),
      strategy: String(item.strategy || ''),
      changeSummary: String(item.changeSummary || ''),
      validationCommand: String(item.validationCommand || ''),
      preview: String(item.preview || ''),
    }));
  const fileMutations = (Array.isArray(artifacts.fileMutations) ? artifacts.fileMutations : [])
    .map(item => asRecord(item))
    .map(item => ({
      target: String(item.target || ''),
      mutationMode: String(item.mutationMode || ''),
      syntaxValid: typeof item.syntaxValid === 'boolean' ? item.syntaxValid : undefined,
      syntaxError: String(item.syntaxError || ''),
    }));

  const parseCount = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return {
    diffFiles: parseCount(artifacts.diffFiles),
    resolvedTargets: parseCount(artifacts.resolvedTargets),
    unresolvedTargets: parseCount(artifacts.unresolvedTargets),
    pythonSyntaxFailed: parseCount(artifacts.pythonSyntaxFailed),
    diffPreviews,
    fileMutations,
  };
};

const parseDiffPreviewLines = (preview: string, maxLines = 36): DiffPreviewLine[] => {
  const rows = String(preview || '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);
  const lines: DiffPreviewLine[] = [];
  for (const line of rows) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@')) {
      lines.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('+')) {
      lines.push({ kind: 'add', text: line });
    } else if (line.startsWith('-')) {
      lines.push({ kind: 'remove', text: line });
    } else {
      lines.push({ kind: 'context', text: line });
    }
    if (lines.length >= maxLines) break;
  }
  return lines;
};

const toDiffSideBySideRows = (lines: DiffPreviewLine[], maxRows = 28, includeContext = true): DiffSideBySideRow[] => {
  const rows: DiffSideBySideRow[] = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const current = lines[idx];
    if (!current) continue;
    if (current.kind === 'hunk') {
      rows.push({
        left: current.text,
        right: current.text,
        leftKind: 'hunk',
        rightKind: 'hunk',
      });
      if (rows.length >= maxRows) break;
      continue;
    }
    if (current.kind === 'context') {
      if (!includeContext) continue;
      const text = current.text.startsWith(' ') ? current.text.slice(1) : current.text;
      rows.push({
        left: text,
        right: text,
        leftKind: 'context',
        rightKind: 'context',
      });
      if (rows.length >= maxRows) break;
      continue;
    }
    if (current.kind === 'remove') {
      const next = lines[idx + 1];
      if (next && next.kind === 'add') {
        rows.push({
          left: current.text,
          right: next.text,
          leftKind: 'remove',
          rightKind: 'add',
        });
        idx += 1;
      } else {
        rows.push({
          left: current.text,
          right: '',
          leftKind: 'remove',
          rightKind: 'empty',
        });
      }
      if (rows.length >= maxRows) break;
      continue;
    }
    if (current.kind === 'add') {
      rows.push({
        left: '',
        right: current.text,
        leftKind: 'empty',
        rightKind: 'add',
      });
      if (rows.length >= maxRows) break;
      continue;
    }
  }
  return rows;
};

const diffCellClass = (kind: DiffSideBySideRow['leftKind']) => {
  if (kind === 'add') return 'bg-emerald-50 text-emerald-800';
  if (kind === 'remove') return 'bg-rose-50 text-rose-800';
  if (kind === 'hunk') return 'bg-blue-50 text-blue-700';
  if (kind === 'empty') return 'bg-slate-50 text-slate-300';
  return 'text-slate-700';
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
  const [subAgentLoading, setSubAgentLoading] = useState(false);
  const [busy, setBusy] = useState<'none' | 'refresh' | 'next' | 'branch'>('none');
  const [message, setMessage] = useState('');
  const [timelineFilter, setTimelineFilter] = useState<'all' | TimelineCategoryId>('all');
  const [activeTab, setActiveTab] = useState<EvidenceTab>('overview');
  const [nodeSubAgents, setNodeSubAgents] = useState<AgenticSubAgentRecord[]>([]);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState('');
  const [diffIncludeContext, setDiffIncludeContext] = useState(false);
  const [expandedDiffKeys, setExpandedDiffKeys] = useState<Record<string, boolean>>({});

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
  const loadNodeSubAgents = useCallback(async () => {
    if (!runId || !nodeId) return;
    setSubAgentLoading(true);
    try {
      const res = await api.listAgenticSubAgents(runId, { page: 1, pageSize: 200, nodeId });
      setNodeSubAgents(Array.isArray(res.items) ? res.items : []);
    } catch (error) {
      setNodeSubAgents([]);
      setMessage(toErrorMessage(error));
    } finally {
      setSubAgentLoading(false);
    }
  }, [runId, nodeId]);
  useEffect(() => {
    loadNodeSubAgents().catch(() => undefined);
  }, [loadNodeSubAgents]);
  useEffect(() => {
    setTimelineFilter('all');
    setActiveTab('overview');
    setSelectedSubAgentId('');
    setExpandedDiffKeys({});
  }, [nodeId]);
  useEffect(() => {
    if (selectedSubAgentId) return;
    if (!nodeSubAgents.length) return;
    setSelectedSubAgentId(nodeSubAgents[0].subAgentId);
  }, [nodeSubAgents, selectedSubAgentId]);

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
  const nodeRunsForNode = useMemo(() => {
    if (!detail) return [] as AgenticNodeRunRecord[];
    return (detail.nodeRuns || [])
      .filter(item => String(item.nodeId || '') === nodeId)
      .sort((a, b) => parseTimestamp(b.startedAt) - parseTimestamp(a.startedAt));
  }, [detail, nodeId]);
  const mutationPlansForNode = useMemo(() => {
    if (!selectedNode) return [] as NodeMutationPlan[];
    return extractNodeMutationPlans(selectedNode);
  }, [selectedNode]);
  const mutationPlansFromNodeRuns = useMemo(
    () => nodeRunsForNode.flatMap(run => extractNodeRunMutationPlans(run)),
    [nodeRunsForNode],
  );
  const mergedMutationPlans = useMemo(() => {
    const map = new Map<string, NodeMutationPlan>();
    [...mutationPlansForNode, ...mutationPlansFromNodeRuns].forEach(plan => {
      const key = `${plan.mutationKind}|${plan.strategy}|${plan.changeSummary}|${plan.targetFiles.join(',')}`;
      if (!map.has(key)) map.set(key, plan);
    });
    return Array.from(map.values());
  }, [mutationPlansForNode, mutationPlansFromNodeRuns]);
  const llmTracesForNode = useMemo(() => {
    if (!detail) return [] as AgenticLlmTraceRecord[];
    return (detail.llmTraces || [])
      .filter(trace => {
        const traceNode = String(trace.nodeId || '');
        if (traceNode && traceNode === nodeId) return true;
        if (!traceNode) {
          const roleText = String(trace.role || '').toLowerCase();
          return roleText.includes('lane_planner');
        }
        return false;
      })
      .sort((a, b) => parseTimestamp(b.ts) - parseTimestamp(a.ts));
  }, [detail, nodeId]);
  const llmTraceSummary = useMemo(() => {
    const total = llmTracesForNode.length;
    const succeeded = llmTracesForNode.filter(item => String(item.status || '').toLowerCase() === 'succeeded').length;
    const failed = total - succeeded;
    const avgLatency =
      total === 0
        ? 0
        : Math.round(
            llmTracesForNode.reduce((sum, item) => {
              const value = typeof item.latencyMs === 'number' ? item.latencyMs : Number(item.latencyMs || 0);
              return sum + (Number.isFinite(value) ? value : 0);
            }, 0) / total,
          );
    return { total, succeeded, failed, avgLatency };
  }, [llmTracesForNode]);
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
  const nodeSubAgentStats = useMemo(() => {
    const total = nodeSubAgents.length;
    const running = nodeSubAgents.filter(item => String(item.status || '').toUpperCase() === 'RUNNING').length;
    const succeeded = nodeSubAgents.filter(item => String(item.status || '').toUpperCase() === 'SUCCEEDED').length;
    const failed = nodeSubAgents.filter(item => String(item.status || '').toUpperCase() === 'FAILED').length;
    return { total, running, succeeded, failed };
  }, [nodeSubAgents]);
  const selectedSubAgent = useMemo(
    () => nodeSubAgents.find(item => item.subAgentId === selectedSubAgentId) || null,
    [nodeSubAgents, selectedSubAgentId],
  );
  const nodeSubAgentGraph = useMemo(() => {
    if (!selectedNode) {
      return { width: 820, height: 240, nodes: [] as Array<Record<string, unknown>>, edges: [] as Array<{ from: string; to: string }> };
    }
    const byDepth = new Map<number, AgenticSubAgentRecord[]>();
    nodeSubAgents
      .slice()
      .sort((a, b) => parseTimestamp(a.startedAt) - parseTimestamp(b.startedAt))
      .forEach(item => {
        const depth = Math.max(1, Number(item.depth || 1));
        const rows = byDepth.get(depth) || [];
        rows.push(item);
        byDepth.set(depth, rows);
      });
    const depthKeys = Array.from(byDepth.keys()).sort((a, b) => a - b);
    const maxDepth = depthKeys.length > 0 ? Math.max(...depthKeys) : 1;
    const maxColumnCount = Math.max(1, ...depthKeys.map(depth => (byDepth.get(depth) || []).length));
    const width = Math.max(820, 240 + (maxDepth + 1) * 220);
    const height = Math.max(240, 120 + maxColumnCount * 88);
    const rootY = Math.round(height / 2);
    const nodes: Array<Record<string, unknown>> = [
      {
        id: selectedNode.nodeId,
        label: selectedNode.nodeId,
        role: selectedNode.agent,
        status: selectedNode.status,
        depth: 0,
        parentId: null,
        x: 28,
        y: rootY,
        kind: 'root',
      },
    ];
    const edges: Array<{ from: string; to: string }> = [];
    depthKeys.forEach(depth => {
      const rows = byDepth.get(depth) || [];
      const x = 28 + depth * 220;
      const startY = Math.round((height - (rows.length - 1) * 86) / 2);
      rows.forEach((item, idx) => {
        const y = startY + idx * 86;
        nodes.push({
          id: item.subAgentId,
          label: item.subAgentId,
          role: item.role,
          status: item.status,
          depth,
          parentId: item.parentSubAgentId || selectedNode.nodeId,
          x,
          y,
          kind: 'sub',
        });
        edges.push({ from: String(item.parentSubAgentId || selectedNode.nodeId), to: item.subAgentId });
      });
    });
    return { width, height, nodes, edges };
  }, [nodeSubAgents, selectedNode]);
  const nodeSubAgentNodeMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    nodeSubAgentGraph.nodes.forEach(node => {
      const key = String(node.id || '');
      if (!key) return;
      map.set(key, node);
    });
    return map;
  }, [nodeSubAgentGraph.nodes]);

  const handleRefresh = async () => {
    setBusy('refresh');
    setMessage('');
    await Promise.all([loadRun(), loadNodeSubAgents()]);
    setBusy('none');
  };

  const handleRunNext = async () => {
    if (!runId) return;
    setBusy('next');
    setMessage('');
    try {
      const res = await api.executeAgenticRun(runId, { mode: 'next' });
      setDetail(res.detail);
      await loadNodeSubAgents();
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
      await loadNodeSubAgents();
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
                  {tx('搜索评分', 'Search score')}: <span className="font-semibold text-blue-700">{Math.round(selectedNodeScore * 100)}</span>
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

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[12px]">
              {([
                ['overview', tx('概览', 'Overview')],
                ['timeline', tx('时间线', 'Timeline')],
                ['llm', tx('LLM 调用', 'LLM Trace')],
                ['branch', tx('分支操作', 'Branch')],
                ['contract', tx('合同账本', 'Contract')],
              ] as Array<[EvidenceTab, string]>).map(([tabId, label]) => (
                <button
                  key={`node-tab-${tabId}`}
                  type="button"
                  onClick={() => setActiveTab(tabId)}
                  className={`rounded-md px-3 py-1.5 font-medium ${activeTab === tabId ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {activeTab === 'overview' && (
            <section className="grid gap-4 xl:grid-cols-12">
              <div className="space-y-4 xl:col-span-8">
                <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('代码变更探索（非超参搜索）', 'Code Mutation Exploration (Not Hyper-parameter Sweep)')}</h2>
                  <p className="mt-2 text-xs text-slate-600">
                    {tx(
                      '该节点的核心是“代码改动分支”：每个分支都应有 mutation kind、改动摘要、目标文件和校验命令。',
                      'This node is a code-mutation branch: each branch should include mutation kind, change summary, target files, and validation command.',
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                      {tx('节点计划', 'Node plans')}: {mutationPlansForNode.length}
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                      {tx('Run 证据计划', 'Run evidence plans')}: {mutationPlansFromNodeRuns.length}
                    </span>
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">
                      {tx('合并唯一计划', 'Merged unique plans')}: {mergedMutationPlans.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {mergedMutationPlans.length === 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        {tx(
                          '当前节点还没有结构化的代码变更计划，建议先执行该节点以生成 patch plan 证据。',
                          'No structured code-mutation plan for this node yet. Execute this node to generate patch-plan evidence.',
                        )}
                      </div>
                    )}
                    {mergedMutationPlans.map((plan, idx) => (
                      <div key={`mutation-plan-${idx}-${plan.strategy}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${mutationTagClass(plan.mutationKind)}`}>
                            {String(plan.mutationKind || 'code').toUpperCase()}
                          </span>
                          <span className="rounded bg-white px-1.5 py-0.5 text-slate-700">{plan.strategy}</span>
                          <span className="rounded bg-white px-1.5 py-0.5 text-slate-500">{plan.source}</span>
                          {plan.risk && (
                            <span className="rounded bg-white px-1.5 py-0.5 text-slate-500">
                              {tx('风险', 'Risk')}: {plan.risk}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-700">
                          {plan.changeSummary || tx('无变更摘要。', 'No change summary.')}
                        </div>
                        {plan.targetFiles.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {plan.targetFiles.map(path => (
                              <span key={`target-${idx}-${path}`} className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                                {path}
                              </span>
                            ))}
                          </div>
                        )}
                        {plan.validationCommand && (
                          <div className="mt-2 rounded bg-white px-2 py-1 font-mono text-[11px] text-slate-600">
                            {plan.validationCommand}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('Sub-agent 探索链路', 'Sub-agent Exploration Chain')}</h2>
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">{tx('总数', 'Total')}: {nodeSubAgentStats.total}</span>
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">{tx('运行中', 'Running')}: {nodeSubAgentStats.running}</span>
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">{tx('成功', 'Succeeded')}: {nodeSubAgentStats.succeeded}</span>
                      <span className="rounded bg-rose-100 px-2 py-0.5 text-rose-700">{tx('失败', 'Failed')}: {nodeSubAgentStats.failed}</span>
                    </div>
                  </div>
                  {subAgentLoading ? (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      {tx('加载 sub-agent 链路中...', 'Loading sub-agent chain...')}
                    </div>
                  ) : nodeSubAgentGraph.nodes.length <= 1 ? (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      {tx('当前节点暂无 sub-agent 执行记录。执行节点后会展示真实链路。', 'No sub-agent execution records yet for this node. Execute the node to populate live chain evidence.')}
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 overflow-auto rounded-lg border border-slate-200 bg-[radial-gradient(circle_at_0%_0%,rgba(219,234,254,.25),transparent_40%),linear-gradient(180deg,rgba(248,250,252,.82),rgba(255,255,255,.98))]">
                        <svg width={nodeSubAgentGraph.width} height={nodeSubAgentGraph.height} viewBox={`0 0 ${nodeSubAgentGraph.width} ${nodeSubAgentGraph.height}`}>
                          <defs>
                            <linearGradient id="node-sub-agent-edge" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.55" />
                              <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.2" />
                            </linearGradient>
                          </defs>
                          {nodeSubAgentGraph.edges.map((edge, idx) => {
                            const from = nodeSubAgentNodeMap.get(edge.from);
                            const to = nodeSubAgentNodeMap.get(edge.to);
                            if (!from || !to) return null;
                            const fromX = Number(from.x || 0) + 154;
                            const fromY = Number(from.y || 0);
                            const toX = Number(to.x || 0);
                            const toY = Number(to.y || 0);
                            const path = `M ${fromX} ${fromY} C ${fromX + 54} ${fromY}, ${toX - 24} ${toY}, ${toX} ${toY}`;
                            return <path key={`node-sub-edge-${idx}`} d={path} fill="none" stroke="url(#node-sub-agent-edge)" strokeWidth={1.35} />;
                          })}
                          {nodeSubAgentGraph.nodes.map(node => {
                            const id = String(node.id || '');
                            const role = String(node.role || '');
                            const status = String(node.status || '').toUpperCase();
                            const kind = String(node.kind || 'sub');
                            const selected = id === selectedSubAgentId;
                            const fill = kind === 'root'
                              ? 'rgba(226,232,240,.92)'
                              : status === 'FAILED'
                              ? 'rgba(255,228,230,.92)'
                              : status === 'SUCCEEDED'
                              ? 'rgba(220,252,231,.92)'
                              : status === 'RUNNING'
                              ? 'rgba(219,234,254,.92)'
                              : 'rgba(248,250,252,.94)';
                            const stroke = selected ? '#2563eb' : 'rgba(148,163,184,.76)';
                            return (
                              <g
                                key={`node-sub-${id}`}
                                transform={`translate(${Number(node.x || 0)}, ${Number(node.y || 0) - 29})`}
                                className={kind === 'sub' ? 'cursor-pointer' : ''}
                                onClick={() => {
                                  if (kind !== 'sub') return;
                                  setSelectedSubAgentId(id);
                                }}
                              >
                                <rect width={154} height={58} rx={11} fill={fill} stroke={stroke} strokeWidth={selected ? 1.8 : 1.2} />
                                <text x={10} y={20} fontSize={9.4} fontWeight={700} fill="#1e293b">{id}</text>
                                <text x={10} y={35} fontSize={8.4} fill="#475569">{role || '-'}</text>
                                <text x={10} y={48} fontSize={8.1} fill="#64748b">{kind === 'root' ? 'ROOT' : status}</text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700">
                        {!selectedSubAgent ? (
                          <div>{tx('点击子代理节点查看执行细节。', 'Click a sub-agent node to inspect execution details.')}</div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-700">{selectedSubAgent.subAgentId}</span>
                              <span className="rounded bg-white px-1.5 py-0.5 text-slate-600">{selectedSubAgent.role}</span>
                              <span className={`rounded px-1.5 py-0.5 font-semibold ${statusBadgeClass(selectedSubAgent.status)}`}>{selectedSubAgent.status}</span>
                            </div>
                            <div className="mt-1 text-slate-700">{selectedSubAgent.objective || '-'}</div>
                            <pre className="mt-2 max-h-40 overflow-auto rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-700">
                              {JSON.stringify(selectedSubAgent.evidence || {}, null, 2)}
                            </pre>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </article>

                <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('节点独立 Runs', 'Node Runs')}</h2>
                  <div className="mt-2 space-y-2">
                    {nodeRunsForNode.length === 0 && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                        {tx('当前节点还没有独立 run 记录。', 'No node-run records yet for this node.')}
                      </div>
                    )}
                    {nodeRunsForNode.map(run => (
                      <div key={`node-run-${run.nodeRunId}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        {(() => {
                          const artifactEvidence = extractNodeRunArtifactEvidence(run);
                          const runPlans = extractNodeRunMutationPlans(run);
                          return (
                            <>
                              <div className="mb-2 flex flex-wrap gap-1 text-[10px]">
                                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700">{tx('Diff 文件', 'Diff files')}: {artifactEvidence.diffFiles}</span>
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">{tx('命中目标', 'Resolved targets')}: {artifactEvidence.resolvedTargets}</span>
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">{tx('未命中', 'Unresolved')}: {artifactEvidence.unresolvedTargets}</span>
                                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">{tx('语法失败', 'Syntax failed')}: {artifactEvidence.pythonSyntaxFailed}</span>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-slate-700">{run.nodeRunId}</div>
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass(run.status)}`}>{run.status}</span>
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {tx('开始', 'Start')}: {formatTimestamp(run.startedAt)} · {tx('结束', 'End')}: {run.finishedAt ? formatTimestamp(run.finishedAt) : '-'}
                              </div>
                              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                                <div className="rounded border border-slate-200 bg-white p-2">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{tx('Patch 计划', 'Patch Plan')}</div>
                                  <div className="mt-1 max-h-40 space-y-1 overflow-auto text-[11px] text-slate-700">
                                    {runPlans.length === 0 && <div className="rounded bg-slate-50 px-1.5 py-1 text-slate-500">-</div>}
                                    {runPlans.map((plan, idx) => (
                                      <div key={`run-plan-${run.nodeRunId}-${idx}`} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
                                        <div className="font-semibold text-slate-700">
                                          {String(plan.mutationKind || 'code').toUpperCase()} · {plan.strategy}
                                        </div>
                                        <div className="mt-0.5 text-slate-600">{plan.changeSummary || '-'}</div>
                                        {plan.targetFiles.length > 0 && (
                                          <div className="mt-0.5 font-mono text-[10px] text-slate-500">{plan.targetFiles.join(', ')}</div>
                                        )}
                                        {plan.validationCommand && (
                                          <div className="mt-0.5 font-mono text-[10px] text-slate-500">{plan.validationCommand}</div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="rounded border border-slate-200 bg-white p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{tx('代码改动证据', 'Code Mutation Evidence')}</div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setDiffIncludeContext(false)}
                                        className={`rounded border px-1.5 py-0.5 text-[10px] ${!diffIncludeContext ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}
                                      >
                                        {tx('仅变更', 'Changes only')}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDiffIncludeContext(true)}
                                        className={`rounded border px-1.5 py-0.5 text-[10px] ${diffIncludeContext ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}
                                      >
                                        {tx('含上下文', 'With context')}
                                      </button>
                                    </div>
                                  </div>
                                  <div className="mt-1 max-h-40 space-y-1 overflow-auto text-[11px] text-slate-700">
                                    {artifactEvidence.diffPreviews.length === 0 && (
                                      <div className="rounded bg-slate-50 px-1.5 py-1 text-slate-500">
                                        {tx('暂无 diff 预览。', 'No diff previews yet.')}
                                      </div>
                                    )}
                                    {artifactEvidence.diffPreviews.map((diff, idx) => {
                                      const diffKey = `${run.nodeRunId}:${idx}:${diff.patchFile || diff.targets.join(',') || diff.mutationKind}`;
                                      const expanded = !!expandedDiffKeys[diffKey];
                                      return (
                                        <div key={`diff-preview-${run.nodeRunId}-${idx}`} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
                                          <div className="flex flex-wrap items-center justify-between gap-1 text-[10px]">
                                            <div className="flex flex-wrap items-center gap-1">
                                              <span className={`rounded px-1.5 py-0.5 font-semibold ${mutationTagClass(diff.mutationKind)}`}>
                                                {String(diff.mutationKind || 'code').toUpperCase()}
                                              </span>
                                              {diff.strategy && <span className="rounded bg-white px-1.5 py-0.5 text-slate-700">{diff.strategy}</span>}
                                              {diff.patchFile && <span className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-500">{diff.patchFile}</span>}
                                            </div>
                                            {diff.preview && (
                                              <button
                                                type="button"
                                                onClick={() => setExpandedDiffKeys(prev => ({ ...prev, [diffKey]: !prev[diffKey] }))}
                                                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                                              >
                                                {expanded ? tx('收起', 'Collapse') : tx('展开', 'Expand')}
                                              </button>
                                            )}
                                          </div>
                                          {diff.changeSummary && <div className="mt-0.5 text-slate-700">{diff.changeSummary}</div>}
                                          {diff.targets.length > 0 && (
                                            <div className="mt-0.5 font-mono text-[10px] text-slate-500">{diff.targets.join(', ')}</div>
                                          )}
                                          {diff.preview && (
                                            <div className={`mt-1 overflow-auto rounded border border-slate-200 bg-white p-1 text-[10px] ${expanded ? 'max-h-64' : 'max-h-28'}`}>
                                              {(() => {
                                                const lines = parseDiffPreviewLines(diff.preview, expanded ? 160 : 60);
                                                const rows = toDiffSideBySideRows(lines, expanded ? 120 : 28, diffIncludeContext);
                                                if (rows.length === 0) {
                                                  return <div className="rounded px-1 py-0.5 font-mono text-slate-500">-</div>;
                                                }
                                                return (
                                                  <div className="space-y-0.5">
                                                    <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                                                      <div>{tx('变更前', 'Before')}</div>
                                                      <div>{tx('变更后', 'After')}</div>
                                                    </div>
                                                    {rows.map((row, rowIdx) => (
                                                      <div key={`diff-line-${run.nodeRunId}-${idx}-${rowIdx}`} className="grid grid-cols-2 gap-1">
                                                        <div className={`rounded px-1 py-0.5 font-mono ${diffCellClass(row.leftKind)}`}>
                                                          {row.left || ' '}
                                                        </div>
                                                        <div className={`rounded px-1 py-0.5 font-mono ${diffCellClass(row.rightKind)}`}>
                                                          {row.right || ' '}
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                );
                                              })()}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                              {artifactEvidence.fileMutations.length > 0 && (
                                <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{tx('文件级变更', 'File-level Mutations')}</div>
                                  <div className="mt-1 max-h-24 space-y-1 overflow-auto text-[11px] text-slate-600">
                                    {artifactEvidence.fileMutations.slice(0, 12).map((file, idx) => (
                                      <div key={`file-mutation-${run.nodeRunId}-${idx}`} className="rounded bg-slate-50 px-1.5 py-0.5">
                                        <span className="font-mono">{file.target || '-'}</span>
                                        {file.mutationMode && <span className="ml-1 text-slate-500">· {file.mutationMode}</span>}
                                        {typeof file.syntaxValid === 'boolean' && (
                                          <span className={`ml-1 ${file.syntaxValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            {file.syntaxValid ? tx('语法通过', 'syntax ok') : tx('语法失败', 'syntax failed')}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{tx('产物路径', 'Artifact Paths')}</div>
                                <div className="mt-1 max-h-24 space-y-1 overflow-auto text-[11px] text-slate-600">
                                  {(run.artifactPaths || []).map(path => (
                                    <div key={`artifact-${run.nodeRunId}-${path}`} className="rounded bg-slate-50 px-1.5 py-0.5 font-mono">{path}</div>
                                  ))}
                                </div>
                              </div>
                              <details className="mt-2 rounded border border-slate-200 bg-white p-2">
                                <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">{tx('展开完整运行指标 JSON', 'Expand full run metrics JSON')}</summary>
                                <pre className="mt-2 max-h-40 overflow-auto text-[11px] text-slate-700">{JSON.stringify(run.metrics || {}, null, 2)}</pre>
                              </details>
                            </>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('节点证据（原始）', 'Node Evidence (Raw)')}</h2>
                  <pre className="mt-2 max-h-[22rem] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    {JSON.stringify(selectedNode.evidence || {}, null, 2)}
                  </pre>
                </article>
              </div>
              <aside className="space-y-4 xl:col-span-4">
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('快速导航', 'Quick Navigation')}</h2>
                  <div className="mt-2 space-y-2">
                    {parentNode && (
                      <button
                        type="button"
                        onClick={() => navigate(`/agentic/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(parentNode.nodeId)}`)}
                        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                      >
                        {tx('父节点', 'Parent')}: {parentNode.nodeId}
                      </button>
                    )}
                    {childNodes.slice(0, 4).map(node => (
                      <button
                        key={`overview-child-${node.nodeId}`}
                        type="button"
                        onClick={() => navigate(`/agentic/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.nodeId)}`)}
                        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                      >
                        {tx('子节点', 'Child')}: {node.nodeId}
                      </button>
                    ))}
                  </div>
                </section>
              </aside>
            </section>
          )}

          {activeTab === 'timeline' && (
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
          )}

          {activeTab === 'llm' && (
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('LLM 调用证据', 'LLM Trace Evidence')}</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {tx('调用总数', 'Total calls')}: <span className="font-semibold">{llmTraceSummary.total}</span>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {tx('成功', 'Succeeded')}: <span className="font-semibold">{llmTraceSummary.succeeded}</span>
                </div>
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {tx('失败', 'Failed')}: <span className="font-semibold">{llmTraceSummary.failed}</span>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  {tx('平均延迟', 'Avg latency')}: <span className="font-semibold">{llmTraceSummary.avgLatency}ms</span>
                </div>
              </div>
              <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5 text-left">{tx('时间', 'Time')}</th>
                      <th className="px-2 py-1.5 text-left">{tx('任务', 'Task')}</th>
                      <th className="px-2 py-1.5 text-left">{tx('状态', 'Status')}</th>
                      <th className="px-2 py-1.5 text-left">{tx('模型', 'Model')}</th>
                      <th className="px-2 py-1.5 text-left">{tx('节点', 'Node')}</th>
                      <th className="px-2 py-1.5 text-left">{tx('角色', 'Role')}</th>
                      <th className="px-2 py-1.5 text-left">{tx('延迟', 'Latency')}</th>
                      <th className="px-2 py-1.5 text-left">{tx('错误', 'Error')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {llmTracesForNode.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-500">
                          {tx('当前节点暂无 LLM 调用记录。', 'No LLM traces for this node yet.')}
                        </td>
                      </tr>
                    )}
                    {llmTracesForNode.map((trace, idx) => {
                      const ok = String(trace.status || '').toLowerCase() === 'succeeded';
                      return (
                        <tr key={`llm-trace-${idx}-${trace.task}-${trace.ts}`} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-slate-600">{formatTimestamp(trace.ts)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{trace.task}</td>
                          <td className="px-2 py-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {trace.status}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">{trace.model}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-600">{trace.nodeId || '-'}</td>
                          <td className="px-2 py-1.5 text-slate-600">{trace.role || '-'}</td>
                          <td className="px-2 py-1.5 text-slate-600">{Math.max(0, Number(trace.latencyMs || 0))}ms</td>
                          <td className="max-w-md truncate px-2 py-1.5 text-slate-600" title={String(trace.error || '')}>
                            {trace.error || '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          )}

          {activeTab === 'branch' && (
            <section className="grid gap-4 xl:grid-cols-12">
              <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-7">
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
                    rows={5}
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
              </article>
              <aside className="space-y-4 xl:col-span-5">
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('可参考上下文', 'Suggested Context')}</h2>
                  <div className="mt-2 space-y-2 text-xs text-slate-700">
                    <div>{tx('父节点', 'Parent')}: {parentNode?.nodeId || '-'}</div>
                    <div>{tx('同级节点数', 'Sibling count')}: {siblingNodes.length}</div>
                    <div>{tx('子节点数', 'Children count')}: {childNodes.length}</div>
                  </div>
                </section>
              </aside>
            </section>
          )}

          {activeTab === 'contract' && (
            <section className="grid gap-4 xl:grid-cols-12">
              <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('合同状态', 'Contract Status')}</h2>
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <div>{tx('合同通过率', 'Pass rate')}: {Math.round(((detail.contract?.passRate || 0) * 100))}%</div>
                  <div>{tx('缺失项', 'Missing')}: {(detail.contract?.missing || []).length}</div>
                </div>
                {(detail.contract?.missing || []).length > 0 && (
                  <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white p-2 text-xs text-rose-700">
                    {(detail.contract?.missing || []).map(item => (
                      <div key={`missing-${item}`}>- {item}</div>
                    ))}
                  </div>
                )}
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-8">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('注册账本', 'Registry Ledger')}</h2>
                <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-xs">
                    <tbody>
                      {registryRows.map(([key, value]) => (
                        <tr key={`registry-${key}`} className="border-b border-slate-100">
                          <td className="w-44 px-2 py-1.5 font-semibold text-slate-600">{key}</td>
                          <td className="px-2 py-1.5 text-slate-700">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          )}
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
