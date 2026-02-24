import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isDemoMode, setDemoMode } from '../services/api';
import { useNavigate } from 'react-router-dom';
import type {
  AgenticApproverRecord,
  AgenticApprovalPolicyTemplate,
  AgenticAuditReplayResponse,
  AgenticIdeaInput,
  AgenticMatrix,
  AgenticMatrixCell,
  AgenticNode,
  AgenticRunReportModel,
  AgenticRunReportResponse,
  AgenticRunDetail,
  AgenticRunSummary,
  AgenticSubAgentRecord,
} from '../types';
import { AlertTriangle, CheckCircle2, Play, Plus, RefreshCcw, Search, ShieldAlert, Trash2, WandSparkles } from 'lucide-react';
import { useI18n } from '../services/i18n';

type AgenticSubAgentPolicy = NonNullable<AgenticIdeaInput['subAgentPolicy']>;
type AgenticApprovalPolicy = NonNullable<AgenticIdeaInput['approvalPolicy']>;
type RightPanelTab = 'dialogue' | 'approvals' | 'subagents' | 'report' | 'audit';
type LayoutMode = 'balanced' | 'focus_tree' | 'focus_evidence';
type UxMode = 'guided' | 'expert';
type WorkspaceDensity = 'focused' | 'full';
type SurfaceMode = 'tree_first' | 'classic';
type TopInputMode = 'idea' | 'search';
type ApprovalActorRole = 'admin' | 'ops' | 'security';
type UiTone = 'neutral' | 'success' | 'warn' | 'danger' | 'info';
type ApprovalActorOption = {
  actorId: string;
  actorRole: ApprovalActorRole;
  label: string;
  note?: string;
  scopes?: string[];
  actionAllowlist?: string[];
  actionDenylist?: string[];
};

type TotGraphNodeLayout = {
  nodeId: string;
  x: number;
  y: number;
  depth: number;
};

type GraphViewportBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TimelineReplayRow = {
  kind: 'timeline' | 'event';
  key: string;
  ts: unknown;
  title: string;
  subtitle: string;
  nodeId: string;
  status: string;
  cost: number;
  message: string;
};

type TimelineCategory = {
  id: string;
  label: string;
  dotClass: string;
};

type TimelineMilestone = {
  key: string;
  index: number;
  title: string;
  timestamp: unknown;
  category: TimelineCategory;
};

type SubAgentGraphNode = {
  id: string;
  kind: 'root' | 'sub';
  x: number;
  y: number;
  depth: number;
  label: string;
  parentNodeId: string;
  subAgentId?: string;
  role?: string;
  status?: string;
  objective?: string;
  children: number;
};

const defaultSubAgentPolicy: AgenticSubAgentPolicy = {
  enabled: true,
  maxDepth: 2,
  maxPerNode: 3,
  maxTotal: 24,
  timeoutMs: 1500,
};

const defaultApprovalPolicy: AgenticApprovalPolicy = {
  mode: 'balanced',
  highRiskActions: ['unknown_script_execution'],
  blockedActionRoles: ['admin', 'security'],
  highRiskActionRoles: ['admin', 'ops', 'security'],
  requireApprovalForUnknownActions: true,
  minApprovals: 1,
  requireDistinctRoles: false,
  approvalTtlMinutes: 120,
};

const fallbackApprovalPolicyTemplates: AgenticApprovalPolicyTemplate[] = [
  {
    templateId: 'strict',
    label: 'Strict',
    description: 'Unknown actions and blocked actions require stricter approval gates.',
    rationale: 'Fallback template without server-side context.',
    recommended: false,
    policy: {
      mode: 'strict',
      highRiskActions: ['external_dependency_install', 'unknown_script_execution', 'data_exfiltration'],
      blockedActionRoles: ['security'],
      highRiskActionRoles: ['admin', 'security'],
      requireApprovalForUnknownActions: true,
      minApprovals: 1,
      requireDistinctRoles: true,
      approvalTtlMinutes: 120,
    },
  },
  {
    templateId: 'balanced',
    label: 'Balanced',
    description: 'Default production profile balancing safety and execution throughput.',
    rationale: 'Fallback template without server-side context.',
    recommended: true,
    policy: defaultApprovalPolicy,
  },
  {
    templateId: 'permissive',
    label: 'Permissive',
    description: 'Allows faster local iteration while keeping explicit high-risk approvals.',
    rationale: 'Fallback template without server-side context.',
    recommended: false,
    policy: {
      mode: 'permissive',
      highRiskActions: ['external_dependency_install', 'unknown_script_execution', 'data_exfiltration'],
      blockedActionRoles: ['admin'],
      highRiskActionRoles: ['admin', 'ops', 'security'],
      requireApprovalForUnknownActions: false,
      minApprovals: 1,
      requireDistinctRoles: false,
      approvalTtlMinutes: 180,
    },
  },
];

const fallbackApprovalActors: ApprovalActorOption[] = [
  { actorId: 'ui:local_admin', actorRole: 'admin', label: 'Local Admin', note: 'default local approver', actionAllowlist: ['*'], actionDenylist: [] },
  { actorId: 'ui:local_ops', actorRole: 'ops', label: 'Local Ops', note: 'ops approver', actionAllowlist: ['switch_offline_stub', 'reduce_scope', 'retry_with_debug'], actionDenylist: [] },
  { actorId: 'ui:local_security', actorRole: 'security', label: 'Local Security', note: 'security approver', actionAllowlist: ['*'], actionDenylist: [] },
];

const defaultIdea: AgenticIdeaInput = {
  title: 'SMAC Win-Rate Lift under Budget',
  taskGoal: 'Improve MARL win rate while controlling GPU and time budget.',
  environment: 'pettingzoo.smac_v2:3s5z',
  dataSources: ['registry://baseline_runs'],
  successMetrics: { winRate: '>=0.62', eloLift: '>=30' },
  budget: { gpuHours: 2, wallclockMinutes: 90 },
  constraints: {
    compliance: ['no_pii', 'no_external_data_push'],
    forbiddenActions: ['data_exfiltration'],
    allowNetwork: false,
    allowDependencyInstall: false,
  },
  executionMode: 'offline_stub',
  localCommand: '',
  requestedActions: [],
  subAgentPolicy: defaultSubAgentPolicy,
  approvalPolicy: defaultApprovalPolicy,
};

const statusColor = (status: string) => {
  const normalized = status.toUpperCase();
  if (normalized === 'SUCCEEDED') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'FAILED') return 'bg-rose-100 text-rose-700';
  if (normalized === 'BLOCKED') return 'bg-amber-100 text-amber-800';
  if (normalized === 'RUNNING') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-600';
};

const statusDotColor = (status: string) => {
  const normalized = status.toUpperCase();
  if (normalized === 'SUCCEEDED') return '#10b981';
  if (normalized === 'FAILED') return '#f43f5e';
  if (normalized === 'BLOCKED') return '#f59e0b';
  if (normalized === 'RUNNING') return '#3b82f6';
  return '#94a3b8';
};

const riskColor = (risk: string) => {
  const normalized = risk.toLowerCase();
  if (normalized === 'high') return 'text-rose-700 bg-rose-50 border-rose-200';
  if (normalized === 'medium') return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-emerald-700 bg-emerald-50 border-emerald-200';
};
const toneBadgeClass = (tone: UiTone, active: boolean) => {
  if (tone === 'success') return active ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-50 text-emerald-700';
  if (tone === 'warn') return active ? 'bg-amber-100 text-amber-700' : 'bg-amber-50 text-amber-700';
  if (tone === 'danger') return active ? 'bg-rose-100 text-rose-700' : 'bg-rose-50 text-rose-700';
  if (tone === 'info') return active ? 'bg-blue-100 text-blue-700' : 'bg-blue-50 text-blue-700';
  return active ? 'bg-slate-200 text-slate-700' : 'bg-slate-200 text-slate-600';
};
const toneCardClass = (tone: UiTone) => {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50/80 text-emerald-800';
  if (tone === 'warn') return 'border-amber-200 bg-amber-50/85 text-amber-800';
  if (tone === 'danger') return 'border-rose-200 bg-rose-50/85 text-rose-800';
  if (tone === 'info') return 'border-blue-200 bg-blue-50/85 text-blue-800';
  return 'border-slate-200 bg-slate-50/85 text-slate-700';
};

const toPrettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
const matrixCellKey = (row: string, col: string) => `${row}::${col}`;
const parseTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
};
const formatTimestamp = (value: unknown) => {
  const ts = parseTimestamp(value);
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
const parseMetricNumber = (raw: unknown): number | null => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw.replace(/[^\d.+-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
const timelineCategory = (phaseOrEvent: string): TimelineCategory => {
  const normalized = String(phaseOrEvent || '').toLowerCase();
  if (normalized.includes('blocked') || normalized.includes('fail') || normalized.includes('reject')) {
    return { id: 'failure', label: 'Failure', dotClass: 'bg-rose-500' };
  }
  if (normalized.includes('repair') || normalized.includes('retry') || normalized.includes('recover') || normalized.includes('reopen')) {
    return { id: 'recovery', label: 'Recovery', dotClass: 'bg-amber-500' };
  }
  if (normalized.includes('matrix') || normalized.includes('eval') || normalized.includes('league') || normalized.includes('ranking')) {
    return { id: 'evaluation', label: 'Evaluation', dotClass: 'bg-blue-500' };
  }
  if (normalized.includes('safety') || normalized.includes('approval') || normalized.includes('policy') || normalized.includes('audit')) {
    return { id: 'safety', label: 'Safety', dotClass: 'bg-violet-500' };
  }
  if (normalized.includes('plan') || normalized.includes('spec') || normalized.includes('branch')) {
    return { id: 'planning', label: 'Planning', dotClass: 'bg-cyan-500' };
  }
  return { id: 'execution', label: 'Execution', dotClass: 'bg-emerald-500' };
};
const timelineTone = (phaseOrEvent: string) => timelineCategory(phaseOrEvent).dotClass;
const matrixHeatColor = (winRate: number | null) => {
  if (winRate === null) return 'rgba(148, 163, 184, 0.14)';
  if (winRate >= 0.5) {
    const t = (winRate - 0.5) / 0.5;
    return `rgba(16, 185, 129, ${0.15 + t * 0.6})`;
  }
  const t = (0.5 - winRate) / 0.5;
  return `rgba(244, 63, 94, ${0.15 + t * 0.58})`;
};
const splitLabelLines = (value: string, maxChars: number, maxLines = 2): string[] => {
  const source = String(value || '').trim().replace(/\s+/g, ' ');
  if (!source) return ['-'];
  const rows: string[] = [];
  let cursor = source;
  while (cursor.length > 0 && rows.length < maxLines) {
    if (cursor.length <= maxChars) {
      rows.push(cursor);
      cursor = '';
      break;
    }
    const splitAt = cursor.lastIndexOf(' ', maxChars);
    const index = splitAt >= Math.floor(maxChars * 0.55) ? splitAt : maxChars;
    rows.push(cursor.slice(0, index).trim());
    cursor = cursor.slice(index).trim();
  }
  if (cursor.length > 0 && rows.length > 0) {
    const tail = rows[rows.length - 1];
    rows[rows.length - 1] = `${tail.slice(0, Math.max(1, maxChars - 1)).trim()}...`;
  }
  return rows;
};
const copyTextToClipboard = async (text: string) => {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.left = '-10000px';
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
};
const wildcardToRegex = (pattern: string) => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
};
const matchesPolicyPattern = (value: string, pattern: string) => {
  const candidate = String(value || '').trim();
  const token = String(pattern || '').trim();
  if (!token) return false;
  if (token === '*') return true;
  try {
    return wildcardToRegex(token).test(candidate);
  } catch {
    return candidate === token;
  }
};
const actorSupportsActions = (actor: ApprovalActorOption, actions: string[]) => {
  const normalized = actions.map(item => String(item || '').trim()).filter(Boolean);
  if (normalized.length === 0) return true;
  const denylist = (actor.actionDenylist || []).map(item => String(item || '').trim()).filter(Boolean);
  const allowlist = (actor.actionAllowlist || []).map(item => String(item || '').trim()).filter(Boolean);
  for (const action of normalized) {
    if (denylist.some(pattern => matchesPolicyPattern(action, pattern))) return false;
    if (allowlist.length > 0 && !allowlist.some(pattern => matchesPolicyPattern(action, pattern))) return false;
  }
  return true;
};

export const AgenticLab: React.FC = () => {
  const { t, tx } = useI18n();
  const navigate = useNavigate();
  const boolLabel = useCallback((value: boolean) => (value ? tx('是', 'true') : tx('否', 'false')), [tx]);
  const statusLabel = useCallback(
    (value: string) => {
      const normalized = String(value || '').toUpperCase();
      if (normalized === 'SUCCEEDED') return tx('成功', 'SUCCEEDED');
      if (normalized === 'FAILED') return tx('失败', 'FAILED');
      if (normalized === 'BLOCKED') return tx('阻塞', 'BLOCKED');
      if (normalized === 'RUNNING') return tx('运行中', 'RUNNING');
      if (normalized === 'PENDING') return tx('待执行', 'PENDING');
      return value || '-';
    },
    [tx],
  );
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
  const [idea, setIdea] = useState<AgenticIdeaInput>(defaultIdea);
  const [runs, setRuns] = useState<AgenticRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [detail, setDetail] = useState<AgenticRunDetail | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('n0');
  const [validationText, setValidationText] = useState<string>('');
  const [busy, setBusy] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [selectedMatrixCellKey, setSelectedMatrixCellKey] = useState<string>('');
  const [subAgentItems, setSubAgentItems] = useState<AgenticSubAgentRecord[]>([]);
  const [subAgentGraphItems, setSubAgentGraphItems] = useState<AgenticSubAgentRecord[]>([]);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState<string>('');
  const [subAgentPage, setSubAgentPage] = useState<number>(1);
  const [subAgentTotal, setSubAgentTotal] = useState<number>(0);
  const [subAgentStatus, setSubAgentStatus] = useState<'ALL' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'>('ALL');
  const [subAgentScope, setSubAgentScope] = useState<'all' | 'selected'>('selected');
  const [showSubAgentGraph, setShowSubAgentGraph] = useState<boolean>(true);
  const [auditReplay, setAuditReplay] = useState<AgenticAuditReplayResponse | null>(null);
  const [approvalComment, setApprovalComment] = useState<string>('');
  const [approvalPolicyTemplates, setApprovalPolicyTemplates] = useState<AgenticApprovalPolicyTemplate[]>(fallbackApprovalPolicyTemplates);
  const [selectedApprovalTemplateId, setSelectedApprovalTemplateId] = useState<string>('balanced');
  const [approvalPolicyContextSummary, setApprovalPolicyContextSummary] = useState<Record<string, unknown>>({});
  const [showAdvancedConfig, setShowAdvancedConfig] = useState<boolean>(false);
  const [showSafetyConfig, setShowSafetyConfig] = useState<boolean>(false);
  const [showSubAgentConfig, setShowSubAgentConfig] = useState<boolean>(false);
  const [showApprovalConfig, setShowApprovalConfig] = useState<boolean>(false);
  const [showAgenticGuide, setShowAgenticGuide] = useState<boolean>(true);
  const [showQuickStart, setShowQuickStart] = useState<boolean>(true);
  const [showSpecWorkspace, setShowSpecWorkspace] = useState<boolean>(false);
  const [compactTree, setCompactTree] = useState<boolean>(true);
  const [showTreeControls, setShowTreeControls] = useState<boolean>(false);
  const [showTreeMiniMap, setShowTreeMiniMap] = useState<boolean>(true);
  const [graphZoomPct, setGraphZoomPct] = useState<number>(100);
  const [graphMotionEnabled, setGraphMotionEnabled] = useState<boolean>(true);
  const [graphAutoCenter, setGraphAutoCenter] = useState<boolean>(true);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Record<string, boolean>>({});
  const [graphViewportBox, setGraphViewportBox] = useState<GraphViewportBox>({ x: 0, y: 0, width: 0, height: 0 });
  const [nodeQuery, setNodeQuery] = useState<string>('');
  const [showSucceededNodes, setShowSucceededNodes] = useState<boolean>(true);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('dialogue');
  const [showApprovalTimeline, setShowApprovalTimeline] = useState<boolean>(false);
  const [showReportPreview, setShowReportPreview] = useState<boolean>(false);
  const [showAuditEvents, setShowAuditEvents] = useState<boolean>(false);
  const [showAllPendingApprovals, setShowAllPendingApprovals] = useState<boolean>(false);
  const [timelineCursor, setTimelineCursor] = useState<number>(0);
  const [timelinePlaying, setTimelinePlaying] = useState<boolean>(false);
  const [timelineReplayMs, setTimelineReplayMs] = useState<number>(800);
  const [timelineSyncNode, setTimelineSyncNode] = useState<boolean>(true);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('balanced');
  const [uxMode, setUxMode] = useState<UxMode>('guided');
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('tree_first');
  const [showContextPanel, setShowContextPanel] = useState<boolean>(false);
  const [topInputMode, setTopInputMode] = useState<TopInputMode>('idea');
  const [topInputValue, setTopInputValue] = useState<string>(defaultIdea.title);
  const [workspaceDensity, setWorkspaceDensity] = useState<WorkspaceDensity>(() => {
    if (typeof window === 'undefined') return 'focused';
    const saved = window.localStorage.getItem('agentic_workspace_density');
    return saved === 'full' ? 'full' : 'focused';
  });
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string>('');
  const [runReport, setRunReport] = useState<AgenticRunReportResponse | null>(null);
  const [approvalActorOptions, setApprovalActorOptions] = useState<ApprovalActorOption[]>(fallbackApprovalActors);
  const [selectedApprovalActorKey, setSelectedApprovalActorKey] = useState<string>(
    `${fallbackApprovalActors[0].actorId}::${fallbackApprovalActors[0].actorRole}`,
  );
  const [approvalStrictMode, setApprovalStrictMode] = useState<boolean>(true);

  const subAgentPageSize = 8;
  const isTreeFirst = surfaceMode === 'tree_first';
  const isFocusedWorkspace = workspaceDensity === 'focused';
  const resolvedSubAgentPolicy = useMemo<AgenticSubAgentPolicy>(
    () => ({ ...defaultSubAgentPolicy, ...(idea.subAgentPolicy || {}) }),
    [idea.subAgentPolicy],
  );
  const resolvedApprovalPolicy = useMemo<AgenticApprovalPolicy>(
    () => ({ ...defaultApprovalPolicy, ...(idea.approvalPolicy || {}) }),
    [idea.approvalPolicy],
  );
  const activeSubAgentNodeFilter = subAgentScope === 'selected' ? selectedNodeId : '';

  const patchSubAgentPolicy = (patch: Partial<AgenticSubAgentPolicy>) => {
    setIdea(prev => ({
      ...prev,
      subAgentPolicy: {
        ...defaultSubAgentPolicy,
        ...(prev.subAgentPolicy || {}),
        ...patch,
      },
    }));
  };

  const patchApprovalPolicy = (patch: Partial<AgenticApprovalPolicy>) => {
    setIdea(prev => ({
      ...prev,
      approvalPolicy: {
        ...defaultApprovalPolicy,
        ...(prev.approvalPolicy || {}),
        ...patch,
      },
    }));
  };

  const selectedApprovalActor = useMemo(() => {
    const found = approvalActorOptions.find(option => `${option.actorId}::${option.actorRole}` === selectedApprovalActorKey);
    return found || approvalActorOptions[0] || fallbackApprovalActors[0];
  }, [approvalActorOptions, selectedApprovalActorKey]);

  const resolveApprovalActor = useCallback(
    (
      preferred: ApprovalActorOption | null | undefined,
      requiredRoles?: ApprovalActorRole[],
      excludeKeys?: Set<string>,
      actions?: string[],
    ): ApprovalActorOption => {
      const required = new Set((requiredRoles || []).map(role => String(role).toLowerCase()));
      const blocked = excludeKeys || new Set<string>();
      const options = approvalActorOptions.length > 0 ? approvalActorOptions : fallbackApprovalActors;
      const isAllowedRole = (role: string) => required.size === 0 || required.has(String(role).toLowerCase());
      const actionRows = (actions || []).map(item => String(item || '').trim()).filter(Boolean);
      const canUse = (actor: ApprovalActorOption) =>
        isAllowedRole(actor.actorRole)
        && !blocked.has(`${actor.actorId}::${actor.actorRole}`)
        && actorSupportsActions(actor, actionRows);
      if (preferred && canUse(preferred)) {
        return preferred;
      }
      const found = options.find(option => canUse(option));
      if (found) return found;
      const roleFallback = options.find(option => isAllowedRole(option.actorRole) && !blocked.has(`${option.actorId}::${option.actorRole}`));
      if (roleFallback) return roleFallback;
      const fallback = options.find(option => !blocked.has(`${option.actorId}::${option.actorRole}`));
      return fallback || fallbackApprovalActors[0];
    },
    [approvalActorOptions],
  );

  const refreshApprovers = async () => {
    try {
      const payload = await api.listAgenticApprovers();
      const flattened: ApprovalActorOption[] = [];
      (payload.items || []).forEach((row: AgenticApproverRecord) => {
        if (!row.active) return;
        const actorId = String(row.actorId || '').trim();
        if (!actorId) return;
        const roles = Array.isArray(row.roles) ? row.roles : [];
        const actionAllowlist = Array.isArray(row.actionAllowlist) ? row.actionAllowlist.map(item => String(item)) : ['*'];
        const actionDenylist = Array.isArray(row.actionDenylist) ? row.actionDenylist.map(item => String(item)) : [];
        roles.forEach(role => {
          const normalized = String(role || '').trim().toLowerCase();
          if (normalized !== 'admin' && normalized !== 'ops' && normalized !== 'security') return;
          flattened.push({
            actorId,
            actorRole: normalized as ApprovalActorRole,
            label: `${actorId} (${normalized})`,
            note: row.note ? String(row.note) : undefined,
            scopes: Array.isArray(row.scopes) ? row.scopes.map(item => String(item)) : undefined,
            actionAllowlist,
            actionDenylist,
          });
        });
      });
      const dedup = new Map<string, ApprovalActorOption>();
      flattened.forEach(item => {
        const key = `${item.actorId}::${item.actorRole}`;
        if (!dedup.has(key)) dedup.set(key, item);
      });
      const rows = Array.from(dedup.values()).sort((a, b) => {
        if (a.actorRole !== b.actorRole) return a.actorRole.localeCompare(b.actorRole);
        return a.actorId.localeCompare(b.actorId);
      });
      const next = rows.length > 0 ? rows : fallbackApprovalActors;
      setApprovalActorOptions(next);
      setApprovalStrictMode(Boolean(payload.strictMode));
    } catch {
      setApprovalActorOptions(fallbackApprovalActors);
      setApprovalStrictMode(true);
    }
  };

  const patchConstraintsFromCsv = (field: 'compliance' | 'forbiddenActions', value: string) => {
    const rows = value.split(',').map(item => item.trim()).filter(Boolean);
    setIdea(prev => ({
      ...prev,
      constraints: {
        ...prev.constraints,
        [field]: rows,
      },
    }));
  };

  const patchRequestedActionsFromCsv = (value: string) => {
    const rows = value.split(',').map(item => item.trim()).filter(Boolean);
    setIdea(prev => ({ ...prev, requestedActions: rows }));
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('agentic_workspace_density', workspaceDensity);
  }, [workspaceDensity]);
  useEffect(() => {
    if (workspaceDensity !== 'focused') return;
    setShowApprovalTimeline(false);
    setShowReportPreview(false);
    setShowAuditEvents(false);
    setShowAllPendingApprovals(false);
  }, [workspaceDensity]);
  useEffect(() => {
    if (topInputMode !== 'search') return;
    setTopInputValue(nodeQuery);
  }, [topInputMode, nodeQuery]);
  useEffect(() => {
    if (topInputMode !== 'idea') return;
    setTopInputValue((idea.title || idea.taskGoal || '').trim());
  }, [topInputMode, idea.title, idea.taskGoal]);
  useEffect(() => {
    if (surfaceMode !== 'tree_first') return;
    setLayoutMode('focus_tree');
    setUxMode('guided');
    setWorkspaceDensity('focused');
    setShowSpecWorkspace(false);
    setShowQuickStart(false);
    setShowAgenticGuide(false);
  }, [surfaceMode]);

  const applyApprovalTemplate = (templateId: string) => {
    const selected = approvalPolicyTemplates.find(item => item.templateId === templateId);
    if (!selected) return;
    setSelectedApprovalTemplateId(templateId);
    patchApprovalPolicy(selected.policy || defaultApprovalPolicy);
  };

  const refreshApprovalTemplates = async (nextIdea?: AgenticIdeaInput) => {
    const payload = nextIdea || idea;
    const res = nextIdea
      ? await api.suggestAgenticApprovalPolicyTemplates(payload)
      : await api.listAgenticApprovalPolicyTemplates();
    const rows = (res.items || []).length > 0 ? (res.items || []) : fallbackApprovalPolicyTemplates;
    setApprovalPolicyTemplates(rows);
    setApprovalPolicyContextSummary(res.contextSummary || {});
    const recommended = res.recommendedTemplateId || rows.find(item => item.recommended)?.templateId || rows[0]?.templateId;
    if (recommended) {
      setSelectedApprovalTemplateId(recommended);
    }
    return {
      recommendedTemplateId: recommended || null,
      contextSummary: (res.contextSummary || {}) as Record<string, unknown>,
    };
  };

  const refreshRuns = async () => {
    const list = await api.listAgenticRuns({ page: 1, pageSize: 50 });
    setRuns(list.items || []);
    if (!selectedRunId && list.items.length > 0) {
      setSelectedRunId(list.items[0].runId);
    }
  };

  const loadRun = async (runId: string, options?: { includeReport?: boolean }) => {
    const includeReport = options?.includeReport ?? true;
    const run = await api.getAgenticRun(runId);
    setDetail(run);
    if (!run.totTree.find(node => node.nodeId === selectedNodeId)) {
      setSelectedNodeId(run.totTree[0]?.nodeId || 'n0');
    }
    if (includeReport) {
      try {
        const nextReport = await api.getAgenticRunReport(runId);
        setRunReport(nextReport);
      } catch {
        setRunReport(null);
      }
    }
  };

  useEffect(() => {
    refreshRuns().catch(err => setMessage(String(err)));
    refreshApprovalTemplates().catch(() => {
      // Keep local fallback templates if API is unavailable.
    });
    refreshApprovers().catch(() => {
      // Keep local fallback approvers if API is unavailable.
    });
  }, []);

  useEffect(() => {
    if (approvalActorOptions.length === 0) return;
    if (!approvalActorOptions.some(option => `${option.actorId}::${option.actorRole}` === selectedApprovalActorKey)) {
      const first = approvalActorOptions[0];
      setSelectedApprovalActorKey(`${first.actorId}::${first.actorRole}`);
    }
  }, [approvalActorOptions, selectedApprovalActorKey]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      setRunReport(null);
      return;
    }
    loadRun(selectedRunId).catch(err => setMessage(String(err)));
  }, [selectedRunId]);

  useEffect(() => {
    if (uxMode === 'guided') {
      setShowSpecWorkspace(false);
      setShowAdvancedConfig(false);
      setShowSafetyConfig(false);
      setShowSubAgentConfig(false);
      setShowApprovalConfig(false);
      setShowAgenticGuide(true);
      setShowQuickStart(true);
      setShowTreeControls(false);
      setShowTreeMiniMap(false);
      setCompactTree(true);
      setLayoutMode('balanced');
      return;
    }
    setShowTreeMiniMap(true);
  }, [uxMode]);

  useEffect(() => {
    if (!selectedRunId) return;
    const status = String(detail?.status || '').toUpperCase();
    const shouldPoll = status === 'RUNNING' || status === 'PENDING' || status === 'BLOCKED';
    if (!shouldPoll) return;
    const timer = window.setInterval(() => {
      loadRun(selectedRunId).catch(err => setMessage(String(err)));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedRunId, detail?.status]);

  useEffect(() => {
    setSubAgentPage(1);
    setSelectedSubAgentId('');
    setReportGeneratedAt('');
    setRunReport(null);
    setAuditReplay(null);
    setCollapsedNodeIds({});
  }, [selectedRunId]);

  const nodeById = useMemo(() => {
    const map = new Map<string, AgenticNode>();
    (detail?.totTree || []).forEach(node => map.set(node.nodeId, node));
    return map;
  }, [detail]);

  const sortedNodes = useMemo(() => {
    const nodes = detail?.totTree || [];
    const depthCache = new Map<string, number>();
    const depthOf = (node: AgenticNode): number => {
      if (depthCache.has(node.nodeId)) return depthCache.get(node.nodeId)!;
      if (!node.parentId) {
        depthCache.set(node.nodeId, 0);
        return 0;
      }
      const parent = nodeById.get(node.parentId);
      const depth = parent ? depthOf(parent) + 1 : 0;
      depthCache.set(node.nodeId, depth);
      return depth;
    };
    return nodes.map(node => ({ node, depth: depthOf(node) }));
  }, [detail, nodeById]);
  const filteredNodes = useMemo(() => {
    const query = nodeQuery.trim().toLowerCase();
    return sortedNodes.filter(({ node }) => {
      if (!showSucceededNodes && String(node.status).toUpperCase() === 'SUCCEEDED') return false;
      if (!query) return true;
      return `${node.nodeId} ${node.title} ${node.hypothesis}`.toLowerCase().includes(query);
    });
  }, [sortedNodes, nodeQuery, showSucceededNodes]);
  const filteredNodeMap = useMemo(() => {
    return new Map(filteredNodes.map(({ node }) => [node.nodeId, node]));
  }, [filteredNodes]);
  const childCountByNode = useMemo(() => {
    const counts = new Map<string, number>();
    filteredNodes.forEach(({ node }) => {
      if (!node.parentId || !filteredNodeMap.has(node.parentId)) return;
      counts.set(node.parentId, (counts.get(node.parentId) || 0) + 1);
    });
    return counts;
  }, [filteredNodes, filteredNodeMap]);
  const visibleNodes = useMemo(() => {
    return filteredNodes.filter(({ node }) => {
      if (node.nodeId === selectedNodeId) return true;
      let parentId = node.parentId || null;
      while (parentId) {
        if (collapsedNodeIds[parentId] && filteredNodeMap.has(parentId)) return false;
        parentId = filteredNodeMap.get(parentId)?.parentId || nodeById.get(parentId)?.parentId || null;
      }
      return true;
    });
  }, [filteredNodes, collapsedNodeIds, selectedNodeId, filteredNodeMap, nodeById]);
  const visibleNodeMap = useMemo(() => {
    return new Map(visibleNodes.map(({ node }) => [node.nodeId, node]));
  }, [visibleNodes]);
  const collapsedHiddenCount = useMemo(() => {
    const collapsed = new Set<string>(
      Object.entries(collapsedNodeIds)
        .filter(([nodeId, on]) => Boolean(on) && filteredNodeMap.has(nodeId))
        .map(([nodeId]) => nodeId),
    );
    const counts = new Map<string, number>();
    if (collapsed.size === 0) return counts;
    filteredNodes.forEach(({ node }) => {
      let parentId = node.parentId || null;
      while (parentId) {
        if (collapsed.has(parentId)) {
          counts.set(parentId, (counts.get(parentId) || 0) + 1);
          break;
        }
        parentId = filteredNodeMap.get(parentId)?.parentId || nodeById.get(parentId)?.parentId || null;
      }
    });
    return counts;
  }, [collapsedNodeIds, filteredNodes, filteredNodeMap, nodeById]);
  const collapsedBranchSummaries = useMemo(() => {
    return Array.from(collapsedHiddenCount.entries())
      .filter(([, hidden]) => hidden > 0)
      .map(([nodeId, hidden]) => {
        const node = nodeById.get(nodeId);
        return {
          nodeId,
          title: node?.title || nodeId,
          hidden,
          status: String(node?.status || 'PENDING'),
        };
      })
      .sort((a, b) => b.hidden - a.hidden)
      .slice(0, 8);
  }, [collapsedHiddenCount, nodeById]);
  const totGraph = useMemo(() => {
    const laneWidth = compactTree ? 244 : 296;
    const leafHeight = compactTree ? 148 : 184;
    const cardWidth = compactTree ? 212 : 248;
    const cardHeight = compactTree ? 96 : 114;
    const childrenByParent = new Map<string, AgenticNode[]>();
    visibleNodes.forEach(({ node }) => {
      const key = node.parentId && visibleNodeMap.has(node.parentId) ? node.parentId : '__root__';
      const rows = childrenByParent.get(key) || [];
      rows.push(node);
      childrenByParent.set(key, rows);
    });
    childrenByParent.forEach(children => {
      children.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    });

    const layout = new Map<string, TotGraphNodeLayout>();
    let leafCursor = 0;
    let maxDepth = 0;

    const placeNode = (node: AgenticNode, depth: number): number => {
      maxDepth = Math.max(maxDepth, depth);
      const children = childrenByParent.get(node.nodeId) || [];
      let y = leafCursor * leafHeight + 40;
      if (children.length === 0) {
        leafCursor += 1;
      } else {
        const ys = children.map(child => placeNode(child, depth + 1));
        y = ys.reduce((acc, item) => acc + item, 0) / ys.length;
      }
      layout.set(node.nodeId, {
        nodeId: node.nodeId,
        x: depth * laneWidth + 28,
        y,
        depth,
      });
      return y;
    };

    (childrenByParent.get('__root__') || []).forEach(root => {
      placeNode(root, 0);
    });

    const edges: Array<{ from: string; to: string }> = [];
    visibleNodes.forEach(({ node }) => {
      if (!node.parentId || !visibleNodeMap.has(node.parentId)) return;
      edges.push({ from: node.parentId, to: node.nodeId });
    });

    return {
      layout,
      edges,
      cardWidth,
      cardHeight,
      width: Math.max(460, (maxDepth + 1) * laneWidth + 260),
      height: Math.max(260, leafCursor * leafHeight + 100),
    };
  }, [visibleNodes, visibleNodeMap, compactTree]);
  const centerNodeInViewport = useCallback((nodeId?: string, behavior: ScrollBehavior = 'smooth') => {
    const targetId = nodeId || selectedNodeId;
    if (!targetId) return;
    const viewport = graphViewportRef.current;
    const point = totGraph.layout.get(targetId);
    if (!viewport || !point) return;
    const scale = graphZoomPct / 100;
    const centerX = (point.x + totGraph.cardWidth / 2) * scale;
    const centerY = point.y * scale;
    viewport.scrollTo({
      left: Math.max(0, centerX - viewport.clientWidth / 2),
      top: Math.max(0, centerY - viewport.clientHeight / 2),
      behavior,
    });
  }, [selectedNodeId, totGraph.layout, totGraph.cardWidth, graphZoomPct]);
  const fitGraphToViewport = useCallback(() => {
    const viewport = graphViewportRef.current;
    if (!viewport) return;
    const widthZoom = ((viewport.clientWidth - 24) / Math.max(1, totGraph.width)) * 100;
    const heightZoom = ((viewport.clientHeight - 24) / Math.max(1, totGraph.height)) * 100;
    const target = Math.min(widthZoom, heightZoom);
    const snapped = Math.round(target / 5) * 5;
    const clamped = Math.max(70, Math.min(150, snapped || 100));
    setGraphZoomPct(clamped);
  }, [totGraph.width, totGraph.height]);
  const toggleNodeCollapsed = useCallback((nodeId: string) => {
    setCollapsedNodeIds(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
  }, []);
  const expandCollapsedBranch = useCallback((nodeId: string) => {
    setCollapsedNodeIds(prev => ({ ...prev, [nodeId]: false }));
    setSelectedNodeId(nodeId);
    window.setTimeout(() => centerNodeInViewport(nodeId, 'smooth'), 30);
  }, [centerNodeInViewport]);
  const collapseAllBranches = useCallback(() => {
    const next: Record<string, boolean> = {};
    childCountByNode.forEach((count, nodeId) => {
      if (count > 0) next[nodeId] = true;
    });
    setCollapsedNodeIds(next);
  }, [childCountByNode]);
  const expandAllBranches = useCallback(() => {
    setCollapsedNodeIds({});
  }, []);
  const miniMapLayout = useMemo(() => {
    const width = 176;
    const height = 112;
    const scale = Math.min(width / Math.max(1, totGraph.width), height / Math.max(1, totGraph.height));
    const renderWidth = totGraph.width * scale;
    const renderHeight = totGraph.height * scale;
    return {
      width,
      height,
      scale,
      offsetX: (width - renderWidth) / 2,
      offsetY: (height - renderHeight) / 2,
    };
  }, [totGraph.width, totGraph.height]);
  const refreshGraphViewportBox = useCallback(() => {
    const viewport = graphViewportRef.current;
    if (!viewport) return;
    const scale = graphZoomPct / 100;
    setGraphViewportBox({
      x: viewport.scrollLeft / scale,
      y: viewport.scrollTop / scale,
      width: viewport.clientWidth / scale,
      height: viewport.clientHeight / scale,
    });
  }, [graphZoomPct]);
  const handleMiniMapClick = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    const viewport = graphViewportRef.current;
    if (!viewport || miniMapLayout.scale <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left - miniMapLayout.offsetX;
    const localY = event.clientY - rect.top - miniMapLayout.offsetY;
    const graphX = Math.max(0, Math.min(totGraph.width, localX / miniMapLayout.scale));
    const graphY = Math.max(0, Math.min(totGraph.height, localY / miniMapLayout.scale));
    const zoomScale = graphZoomPct / 100;
    viewport.scrollTo({
      left: Math.max(0, graphX * zoomScale - viewport.clientWidth / 2),
      top: Math.max(0, graphY * zoomScale - viewport.clientHeight / 2),
      behavior: 'smooth',
    });
  }, [miniMapLayout, totGraph.width, totGraph.height, graphZoomPct]);

  const selectedNode = useMemo(() => {
    if (!detail) return null;
    return detail.totTree.find(node => node.nodeId === selectedNodeId) || detail.totTree[0] || null;
  }, [detail, selectedNodeId]);
  const selectedPathSet = useMemo(() => {
    const rows = new Set<string>();
    if (!selectedNode) return rows;
    let current: AgenticNode | undefined = selectedNode;
    while (current) {
      rows.add(current.nodeId);
      if (!current.parentId) break;
      const parent = nodeById.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return rows;
  }, [selectedNode, nodeById]);
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
  const siblingNodes = useMemo(() => {
    if (!selectedNode) return [] as AgenticNode[];
    return (detail?.totTree || []).filter(node => node.parentId === selectedNode.parentId);
  }, [detail?.totTree, selectedNode]);
  const selectedSiblingIndex = useMemo(
    () => siblingNodes.findIndex(node => node.nodeId === selectedNode?.nodeId),
    [siblingNodes, selectedNode?.nodeId],
  );
  const prevSiblingId = selectedSiblingIndex > 0 ? siblingNodes[selectedSiblingIndex - 1].nodeId : '';
  const nextSiblingId = selectedSiblingIndex >= 0 && selectedSiblingIndex < siblingNodes.length - 1
    ? siblingNodes[selectedSiblingIndex + 1].nodeId
    : '';
  const selectedSubtreeNodeIds = useMemo(() => {
    const rows = new Set<string>();
    if (!detail || !selectedNode) return rows;
    const childMap = new Map<string, string[]>();
    detail.totTree.forEach(node => {
      if (!node.parentId) return;
      const children = childMap.get(node.parentId) || [];
      children.push(node.nodeId);
      childMap.set(node.parentId, children);
    });
    const queue: string[] = [selectedNode.nodeId];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (rows.has(nodeId)) continue;
      rows.add(nodeId);
      (childMap.get(nodeId) || []).forEach(child => queue.push(child));
    }
    return rows;
  }, [detail, selectedNode]);
  const selectedSubtreeSummary = useMemo(() => {
    if (!detail || !selectedNode || selectedSubtreeNodeIds.size === 0) return null;
    const subtreeNodes = detail.totTree.filter(node => selectedSubtreeNodeIds.has(node.nodeId));
    const statusCounts = { pending: 0, running: 0, succeeded: 0, failed: 0, blocked: 0 };
    let budgetGpu = 0;
    let budgetMinutes = 0;
    let winRateCount = 0;
    let winRateSum = 0;
    let riskScore = 0;
    subtreeNodes.forEach(node => {
      const status = String(node.status || '').toUpperCase();
      if (status === 'PENDING' || status === 'RETRY_PENDING') statusCounts.pending += 1;
      else if (status === 'RUNNING') statusCounts.running += 1;
      else if (status === 'SUCCEEDED') statusCounts.succeeded += 1;
      else if (status === 'FAILED') statusCounts.failed += 1;
      else if (status === 'BLOCKED') statusCounts.blocked += 1;

      const budget = (node.budget || {}) as Record<string, unknown>;
      const gpu = parseMetricNumber(budget.gpuHours || budget.gpu_hours || budget.gpu);
      const mins = parseMetricNumber(budget.wallclockMinutes || budget.wallclock_minutes || budget.minutes);
      if (gpu !== null) budgetGpu += gpu;
      if (mins !== null) budgetMinutes += mins;

      const expected = (node.expectedMetrics || {}) as Record<string, unknown>;
      const winRate = parseMetricNumber(expected.winRate || expected.win_rate);
      if (winRate !== null) {
        winRateCount += 1;
        winRateSum += winRate;
      }
      const risk = String(node.risk || 'low').toLowerCase();
      riskScore += risk === 'high' ? 3 : risk === 'medium' ? 2 : 1;
    });
    const avgWinRate = winRateCount > 0 ? winRateSum / winRateCount : null;
    const riskIndex = subtreeNodes.length > 0 ? riskScore / subtreeNodes.length : 0;
    return {
      nodeCount: subtreeNodes.length,
      depth: selectedNodePath.length - 1,
      statusCounts,
      budgetGpu,
      budgetMinutes,
      avgWinRate,
      riskIndex,
    };
  }, [detail, selectedNode, selectedNodePath.length, selectedSubtreeNodeIds]);
  const leftColClass = isTreeFirst
    ? (showContextPanel ? 'xl:col-span-7' : 'xl:col-span-8')
    : uxMode === 'guided'
    ? 'xl:col-span-3'
    : layoutMode === 'focus_tree'
    ? 'xl:col-span-4'
    : 'xl:col-span-2';
  const centerColClass = isTreeFirst
    ? (showContextPanel ? 'xl:col-span-3' : 'xl:col-span-4')
    : uxMode === 'guided'
    ? 'xl:col-span-6'
    : layoutMode === 'focus_evidence'
    ? 'xl:col-span-8'
    : layoutMode === 'focus_tree'
    ? 'xl:col-span-5'
    : 'xl:col-span-7';
  const rightColClass = isTreeFirst
    ? 'xl:col-span-2'
    : uxMode === 'guided'
    ? 'xl:col-span-3'
    : layoutMode === 'focus_evidence'
    ? 'xl:col-span-2'
    : 'xl:col-span-3';

  const selectedRunSummary = useMemo(() => {
    return runs.find(run => run.runId === selectedRunId) || null;
  }, [runs, selectedRunId]);

  const subAgentStats = useMemo(() => {
    const stats = { total: 0, running: 0, succeeded: 0, failed: 0 };
    (detail?.totTree || []).forEach(node => {
      (node.subAgents || []).forEach(item => {
        stats.total += 1;
        const status = String((item as Record<string, unknown>).status || '').toUpperCase();
        if (status === 'RUNNING') stats.running += 1;
        else if (status === 'SUCCEEDED') stats.succeeded += 1;
        else if (status === 'FAILED') stats.failed += 1;
      });
    });
    return stats;
  }, [detail]);
  const subAgentById = useMemo(() => {
    return new Map(subAgentGraphItems.map(item => [item.subAgentId, item]));
  }, [subAgentGraphItems]);
  const selectedSubAgent = useMemo(() => {
    if (subAgentGraphItems.length === 0) return null;
    if (selectedSubAgentId && subAgentById.has(selectedSubAgentId)) return subAgentById.get(selectedSubAgentId) || null;
    return subAgentGraphItems[0];
  }, [subAgentGraphItems, selectedSubAgentId, subAgentById]);
  const selectedSubAgentLineage = useMemo(() => {
    if (!selectedSubAgent) return [] as AgenticSubAgentRecord[];
    const rows: AgenticSubAgentRecord[] = [];
    const seen = new Set<string>();
    let cursor: AgenticSubAgentRecord | undefined | null = selectedSubAgent;
    while (cursor && !seen.has(cursor.subAgentId)) {
      rows.unshift(cursor);
      seen.add(cursor.subAgentId);
      cursor = cursor.parentSubAgentId ? subAgentById.get(cursor.parentSubAgentId) : null;
    }
    return rows;
  }, [selectedSubAgent, subAgentById]);
  const selectedSubAgentEvidenceKeys = useMemo(() => {
    if (!selectedSubAgent) return [] as string[];
    return Object.keys(selectedSubAgent.evidence || {}).slice(0, 6);
  }, [selectedSubAgent]);
  const subAgentRoleMix = useMemo(() => {
    const counts = new Map<string, number>();
    subAgentGraphItems.forEach(item => {
      const role = String(item.role || 'SubAgent');
      counts.set(role, (counts.get(role) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [subAgentGraphItems]);
  const subAgentGraph = useMemo(() => {
    const cardWidth = 176;
    const cardHeight = 54;
    const laneWidth = 206;
    const leafHeight = 70;
    const sorted = [...subAgentGraphItems].sort((a, b) => parseTimestamp(a.startedAt) - parseTimestamp(b.startedAt));
    const itemsById = new Map(sorted.map(item => [item.subAgentId, item]));
    const childrenByParentSub = new Map<string, AgenticSubAgentRecord[]>();
    const topByParentNode = new Map<string, AgenticSubAgentRecord[]>();
    sorted.forEach(item => {
      const parentSub = String(item.parentSubAgentId || '');
      if (parentSub && itemsById.has(parentSub)) {
        const children = childrenByParentSub.get(parentSub) || [];
        children.push(item);
        childrenByParentSub.set(parentSub, children);
        return;
      }
      const key = String(item.parentNodeId || 'unknown_node');
      const rows = topByParentNode.get(key) || [];
      rows.push(item);
      topByParentNode.set(key, rows);
    });
    childrenByParentSub.forEach(children => {
      children.sort((a, b) => parseTimestamp(a.startedAt) - parseTimestamp(b.startedAt));
    });
    topByParentNode.forEach(children => {
      children.sort((a, b) => parseTimestamp(a.startedAt) - parseTimestamp(b.startedAt));
    });

    const nodes: SubAgentGraphNode[] = [];
    const edges: Array<{ from: string; to: string }> = [];
    let leafCursor = 0;
    let maxDepth = 0;
    const placeSub = (
      item: AgenticSubAgentRecord,
      depth: number,
      parentGraphId: string,
      parentNodeId: string,
    ): number => {
      maxDepth = Math.max(maxDepth, depth);
      const children = childrenByParentSub.get(item.subAgentId) || [];
      let y = leafCursor * leafHeight + 42;
      if (children.length === 0) {
        leafCursor += 1;
      } else {
        const ys = children.map(child => placeSub(child, depth + 1, `sa:${item.subAgentId}`, parentNodeId));
        y = ys.reduce((acc, point) => acc + point, 0) / ys.length;
      }
      nodes.push({
        id: `sa:${item.subAgentId}`,
        kind: 'sub',
        x: depth * laneWidth + 30,
        y,
        depth,
        label: item.subAgentId,
        parentNodeId,
        subAgentId: item.subAgentId,
        role: item.role,
        status: item.status,
        objective: item.objective,
        children: children.length,
      });
      edges.push({ from: parentGraphId, to: `sa:${item.subAgentId}` });
      return y;
    };

    const parentNodes = Array.from(topByParentNode.keys()).sort();
    parentNodes.forEach(parentNodeId => {
      const rootId = `node:${parentNodeId}`;
      const rootChildren = topByParentNode.get(parentNodeId) || [];
      let rootY = leafCursor * leafHeight + 42;
      if (rootChildren.length === 0) {
        leafCursor += 1;
      } else {
        const ys = rootChildren.map(item => placeSub(item, 1, rootId, parentNodeId));
        rootY = ys.reduce((acc, point) => acc + point, 0) / ys.length;
      }
      const rootNode = nodeById.get(parentNodeId);
      nodes.push({
        id: rootId,
        kind: 'root',
        x: 30,
        y: rootY,
        depth: 0,
        label: rootNode ? `${parentNodeId} · ${rootNode.title}` : parentNodeId,
        parentNodeId,
        children: rootChildren.length,
      });
    });

    const nodeMap = new Map(nodes.map(item => [item.id, item]));
    return {
      nodes,
      nodeMap,
      edges,
      cardWidth,
      cardHeight,
      width: Math.max(460, (maxDepth + 1) * laneWidth + 240),
      height: Math.max(180, leafCursor * leafHeight + 86),
      truncated: subAgentTotal > sorted.length,
      visibleCount: sorted.length,
      totalCount: subAgentTotal,
    };
  }, [subAgentGraphItems, nodeById, subAgentTotal]);
  const selectedSubAgentChainSet = useMemo(() => {
    const rows = new Set<string>();
    if (!selectedSubAgent) return rows;
    let cursor: AgenticSubAgentRecord | undefined | null = selectedSubAgent;
    while (cursor) {
      rows.add(`sa:${cursor.subAgentId}`);
      if (!cursor.parentSubAgentId) {
        rows.add(`node:${cursor.parentNodeId}`);
        break;
      }
      cursor = subAgentById.get(cursor.parentSubAgentId) || null;
    }
    return rows;
  }, [selectedSubAgent, subAgentById]);

  const pendingApprovals = detail?.pendingApprovals?.filter(item => String(item.status) === 'PENDING') || [];
  const visiblePendingApprovals = useMemo(() => {
    if (!isFocusedWorkspace) return pendingApprovals;
    if (showAllPendingApprovals) return pendingApprovals;
    return pendingApprovals.slice(0, 4);
  }, [pendingApprovals, isFocusedWorkspace, showAllPendingApprovals]);
  const pendingApprovalActions = useMemo(() => {
    const rows = new Set<string>();
    pendingApprovals.forEach(item => {
      const action = String((item as Record<string, unknown>).action || '').trim();
      if (action) rows.add(action);
    });
    return Array.from(rows).sort();
  }, [pendingApprovals]);
  useEffect(() => {
    if (pendingApprovals.length <= 4) {
      setShowAllPendingApprovals(false);
    }
  }, [pendingApprovals.length]);
  const selectedActorActionScopeOk = useMemo(() => {
    return actorSupportsActions(selectedApprovalActor, pendingApprovalActions);
  }, [selectedApprovalActor, pendingApprovalActions]);
  const approvalHistory = useMemo(() => {
    const rows = [...(detail?.pendingApprovals || [])];
    rows.sort((a, b) => {
      const ta = Date.parse(String((a as Record<string, unknown>).decidedAt || (a as Record<string, unknown>).decided_at || (a as Record<string, unknown>).createdAt || (a as Record<string, unknown>).created_at || ''));
      const tb = Date.parse(String((b as Record<string, unknown>).decidedAt || (b as Record<string, unknown>).decided_at || (b as Record<string, unknown>).createdAt || (b as Record<string, unknown>).created_at || ''));
      return Number.isFinite(tb) && Number.isFinite(ta) ? tb - ta : 0;
    });
    return rows;
  }, [detail?.pendingApprovals]);

  const matrixData: AgenticMatrix | null = detail?.matrix || null;
  const matrixCellByKey = useMemo(() => {
    const map = new Map<string, AgenticMatrixCell>();
    (matrixData?.cells || []).forEach(cell => map.set(matrixCellKey(cell.row, cell.col), cell));
    return map;
  }, [matrixData]);

  const selectedMatrixCell = useMemo(() => {
    if (!matrixData || matrixData.cells.length === 0) return null;
    if (!selectedMatrixCellKey) return matrixData.cells[0];
    return matrixCellByKey.get(selectedMatrixCellKey) || matrixData.cells[0];
  }, [matrixData, matrixCellByKey, selectedMatrixCellKey]);
  const timelineRows = useMemo<TimelineReplayRow[]>(() => {
    const timelineBase = (detail?.timeline || []).map((item, idx) => {
      const row = item as Record<string, unknown>;
      return {
        kind: 'timeline' as const,
        key: `t-${idx}-${String(row.ts || '')}`,
        ts: row.ts || '',
        title: String(row.phase || 'phase'),
        subtitle: String(row.agent || '-'),
        nodeId: String(row.nodeId || row.node_id || '-'),
        status: String(row.status || '-'),
        cost: Number(row.cost || 0),
        message: '',
      };
    });
    const eventsBase = (detail?.events || []).map((item, idx) => {
      const row = item as Record<string, unknown>;
      const payload = (row.payload || {}) as Record<string, unknown>;
      return {
        kind: 'event' as const,
        key: `e-${idx}-${String(row.seq || row.ts || '')}`,
        ts: row.ts || '',
        title: String(row.event || 'event'),
        subtitle: String(row.actor || 'system'),
        nodeId: String(payload.nodeId || payload.node_id || '-'),
        status: String(payload.status || '-'),
        cost: Number(payload.cost || 0),
        message: String(row.message || ''),
      };
    });
    const rows = [...timelineBase, ...eventsBase];
    rows.sort((a, b) => parseTimestamp(a.ts) - parseTimestamp(b.ts));
    return rows;
  }, [detail?.timeline, detail?.events]);
  const selectedTimelineRow = useMemo<TimelineReplayRow | null>(() => {
    if (timelineRows.length === 0) return null;
    const index = Math.max(0, Math.min(timelineRows.length - 1, timelineCursor));
    return timelineRows[index];
  }, [timelineRows, timelineCursor]);
  const timelineIndexByKey = useMemo(() => {
    return new Map(timelineRows.map((row, index) => [row.key, index]));
  }, [timelineRows]);
  const timelineLegend = useMemo(() => {
    const map = new Map<string, TimelineCategory & { count: number }>();
    timelineRows.forEach(row => {
      const category = timelineCategory(`${row.title} ${row.status}`);
      const prev = map.get(category.id);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(category.id, { ...category, count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [timelineRows]);
  const timelineMilestones = useMemo<TimelineMilestone[]>(() => {
    const candidates = timelineRows
      .map((row, index) => ({ row, index }))
      .filter(item => {
        const blob = `${item.row.title} ${item.row.status} ${item.row.message}`.toLowerCase();
        return (
          blob.includes('fail') ||
          blob.includes('blocked') ||
          blob.includes('retry') ||
          blob.includes('repair') ||
          blob.includes('recover') ||
          blob.includes('approval') ||
          blob.includes('safety') ||
          blob.includes('matrix') ||
          blob.includes('league') ||
          blob.includes('repro') ||
          blob.includes('branch')
        );
      });
    const rows = candidates.length > 0 ? candidates : timelineRows.map((row, index) => ({ row, index }));
    const tail = rows.slice(Math.max(0, rows.length - 8));
    return tail.map(item => ({
      key: item.row.key,
      index: item.index,
      title: item.row.title,
      timestamp: item.row.ts,
      category: timelineCategory(`${item.row.title} ${item.row.status}`),
    }));
  }, [timelineRows]);
  const subtreeTimelineSeries = useMemo(() => {
    if (timelineRows.length === 0 || selectedSubtreeNodeIds.size === 0) return [] as Array<{
      index: number;
      cumulativeCost: number;
      successRate: number;
      activity: number;
      success: number;
      failed: number;
      blocked: number;
    }>;
    let cumulativeCost = 0;
    let activity = 0;
    let success = 0;
    let failed = 0;
    let blocked = 0;
    return timelineRows.map((row, index) => {
      const nodeId = String(row.nodeId || '');
      if (selectedSubtreeNodeIds.has(nodeId)) {
        activity += 1;
        cumulativeCost += Number(row.cost || 0);
        const status = String(row.status || '').toUpperCase();
        if (status === 'SUCCEEDED') success += 1;
        else if (status === 'FAILED') failed += 1;
        else if (status === 'BLOCKED') blocked += 1;
      }
      const denom = success + failed + blocked;
      return {
        index,
        cumulativeCost,
        successRate: denom > 0 ? success / denom : 0,
        activity,
        success,
        failed,
        blocked,
      };
    });
  }, [timelineRows, selectedSubtreeNodeIds]);
  const subtreeTimelineView = useMemo(() => {
    if (subtreeTimelineSeries.length < 2) return null;
    const width = 420;
    const height = 112;
    const padX = 8;
    const padY = 8;
    const maxX = Math.max(1, subtreeTimelineSeries.length - 1);
    const maxCost = Math.max(1, ...subtreeTimelineSeries.map(point => point.cumulativeCost));
    const mkPath = (values: number[], maxValue: number) =>
      values
        .map((value, idx) => {
          const x = padX + (idx / maxX) * (width - padX * 2);
          const normalized = maxValue <= 0 ? 0 : value / maxValue;
          const y = height - padY - normalized * (height - padY * 2);
          return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(' ');
    const costPath = mkPath(subtreeTimelineSeries.map(point => point.cumulativeCost), maxCost);
    const successPath = mkPath(subtreeTimelineSeries.map(point => point.successRate), 1);
    const cursorIdx = Math.max(0, Math.min(subtreeTimelineSeries.length - 1, timelineCursor));
    const cursorX = padX + (cursorIdx / maxX) * (width - padX * 2);
    const snapshot = subtreeTimelineSeries[cursorIdx];
    return { width, height, padX, padY, costPath, successPath, cursorX, snapshot, maxCost };
  }, [subtreeTimelineSeries, timelineCursor]);
  const comparedBranchNodes = useMemo(() => {
    if (!detail || !selectedNode) return [];
    const rows = detail.totTree.filter(node => node.parentId === selectedNode.parentId);
    return rows.map(node => {
      const metrics = (node.expectedMetrics || {}) as Record<string, unknown>;
      const budget = (node.budget || {}) as Record<string, unknown>;
      const expectedWin = parseMetricNumber(metrics.winRate || metrics.win_rate);
      const budgetGpu = parseMetricNumber(budget.gpuHours || budget.gpu_hours);
      const budgetMinutes = parseMetricNumber(budget.wallclockMinutes || budget.wallclock_minutes);
      return { node, expectedWin, budgetGpu, budgetMinutes };
    });
  }, [detail, selectedNode]);
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { total: 0, pending: 0, running: 0, succeeded: 0, failed: 0, blocked: 0 };
    (detail?.totTree || []).forEach(node => {
      const status = String(node.status || '').toUpperCase();
      counts.total += 1;
      if (status === 'PENDING' || status === 'RETRY_PENDING') counts.pending += 1;
      else if (status === 'RUNNING') counts.running += 1;
      else if (status === 'SUCCEEDED') counts.succeeded += 1;
      else if (status === 'FAILED') counts.failed += 1;
      else if (status === 'BLOCKED') counts.blocked += 1;
    });
    return counts;
  }, [detail?.totTree]);
  const completionRate = useMemo(() => {
    if (statusCounts.total <= 0) return 0;
    return Math.round((statusCounts.succeeded / statusCounts.total) * 100);
  }, [statusCounts]);
  const workflowStages = useMemo(() => {
    const hasPlan = (detail?.totTree || []).length > 0;
    const hasTimeline = timelineRows.length > 0;
    const hasMatrix = Boolean(matrixData && matrixData.cells && matrixData.cells.length > 0);
    const hasRepro = Boolean(detail?.reproBundleUri);
    const pending = pendingApprovals.length;
    return [
      {
        key: 'plan',
        label: 'Plan',
        hint: hasPlan ? `${detail?.totTree.length || 0} nodes` : 'waiting for run',
        tone: hasPlan ? 'bg-cyan-50 text-cyan-700 border-cyan-200' : 'bg-slate-50 text-slate-500 border-slate-200',
      },
      {
        key: 'execute',
        label: 'Execute',
        hint: hasTimeline ? `${timelineRows.length} events` : 'not started',
        tone: hasTimeline ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200',
      },
      {
        key: 'safety',
        label: 'Safety',
        hint: pending > 0 ? `${pending} approvals pending` : 'clear',
        tone: pending > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
      },
      {
        key: 'league',
        label: 'League',
        hint: hasMatrix ? `${matrixData?.labels.length || 0}x${matrixData?.labels.length || 0}` : 'not generated',
        tone: hasMatrix ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-500 border-slate-200',
      },
      {
        key: 'repro',
        label: 'Repro',
        hint: hasRepro ? 'bundle ready' : 'not exported',
        tone: hasRepro ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-slate-50 text-slate-500 border-slate-200',
      },
    ];
  }, [detail?.totTree.length, detail?.reproBundleUri, matrixData, pendingApprovals.length, timelineRows.length]);
  const quickStartSteps = useMemo(() => {
    const specValid = validationText.toLowerCase().includes('spec valid: true');
    const hasRun = Boolean(selectedRunSummary || detail);
    const hasExecution = timelineRows.length > 0;
    const approvalsCleared = pendingApprovals.length === 0;
    const hasMatrix = Boolean(matrixData && matrixData.cells && matrixData.cells.length > 0);
    const hasRepro = Boolean((detail as Record<string, unknown> | null)?.reproBundleUri || detail?.reproBundle);
    return [
      {
        id: 'spec',
        title: '1) Validate Spec',
        hint: t('agentic.quickstep.spec', 'Constrain the idea and generate an executable spec.'),
        done: specValid,
      },
      {
        id: 'run',
        title: '2) Create Run',
        hint: t('agentic.quickstep.run', 'Create one ToT research run context.'),
        done: hasRun,
      },
      {
        id: 'execute',
        title: '3) Execute ToT',
        hint: t('agentic.quickstep.execute', 'Execute nodes and generate timeline/evidence.'),
        done: hasExecution,
      },
      {
        id: 'approve',
        title: '4) Clear Safety',
        hint: t('agentic.quickstep.approve', 'Clear blocked approvals before continuing.'),
        done: hasRun ? approvalsCleared : false,
      },
      {
        id: 'matrix',
        title: '5) Generate League',
        hint: t('agentic.quickstep.matrix', 'Generate league matrix and inspect cell evidence.'),
        done: hasMatrix,
      },
      {
        id: 'repro',
        title: '6) Export Repro',
        hint: t('agentic.quickstep.repro', 'Export reproducibility bundle.'),
        done: hasRepro,
      },
    ];
  }, [validationText, selectedRunSummary, detail, timelineRows.length, pendingApprovals.length, matrixData, t]);
  const nextQuickStep = useMemo(() => {
    return quickStartSteps.find(step => !step.done) || null;
  }, [quickStartSteps]);
  const approvalStatusBreakdown = useMemo(() => {
    const rows = {
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      reopened: 0,
    };
    (detail?.pendingApprovals || []).forEach(item => {
      const status = String((item as Record<string, unknown>).status || '').toUpperCase();
      if (status === 'PENDING') rows.pending += 1;
      else if (status === 'APPROVED') rows.approved += 1;
      else if (status === 'REJECTED') rows.rejected += 1;
      else if (status === 'EXPIRED') rows.expired += 1;
      else if (status === 'REOPENED') rows.reopened += 1;
    });
    return rows;
  }, [detail?.pendingApprovals]);
  const approvalRulesVersion = String(approvalPolicyContextSummary.policyRulesVersion || '-');
  const approvalRulesHash = String(approvalPolicyContextSummary.policyRulesHash || '');
  const approvalRulesHashShort = approvalRulesHash ? `${approvalRulesHash.slice(0, 12)}...` : '-';
  const approvalDecisionTotal = useMemo(
    () =>
      approvalStatusBreakdown.pending
      + approvalStatusBreakdown.approved
      + approvalStatusBreakdown.rejected
      + approvalStatusBreakdown.expired
      + approvalStatusBreakdown.reopened,
    [approvalStatusBreakdown],
  );
  const approvalHealth = useMemo(() => {
    const stale = approvalStatusBreakdown.expired + approvalStatusBreakdown.reopened;
    if (approvalStatusBreakdown.rejected > 0) {
      return {
        tone: 'danger' as UiTone,
        label: tx('高风险', 'Critical'),
        hint: tx('存在拒绝决策，请处理失败路径。', 'Rejected decisions detected. Resolve failure branches first.'),
      };
    }
    if (approvalStatusBreakdown.pending > 0 || stale > 0) {
      return {
        tone: 'warn' as UiTone,
        label: tx('需处理', 'Attention'),
        hint: tx('存在待审批或过期项，建议尽快闭环。', 'Pending or stale approvals detected. Clear them to unblock execution.'),
      };
    }
    return {
      tone: 'success' as UiTone,
      label: tx('健康', 'Healthy'),
      hint: tx('审批链路已清空，可继续推进执行。', 'Approval queue is clear and execution can proceed.'),
    };
  }, [approvalStatusBreakdown, tx]);
  const approvalKpiCards = useMemo(
    () => [
      {
        key: 'pending',
        label: tx('待处理', 'Pending'),
        value: approvalStatusBreakdown.pending,
        tone: approvalStatusBreakdown.pending > 0 ? ('warn' as UiTone) : ('neutral' as UiTone),
      },
      {
        key: 'approved',
        label: tx('已通过', 'Approved'),
        value: approvalStatusBreakdown.approved,
        tone: approvalStatusBreakdown.approved > 0 ? ('success' as UiTone) : ('neutral' as UiTone),
      },
      {
        key: 'rejected',
        label: tx('已拒绝', 'Rejected'),
        value: approvalStatusBreakdown.rejected,
        tone: approvalStatusBreakdown.rejected > 0 ? ('danger' as UiTone) : ('neutral' as UiTone),
      },
      {
        key: 'stale',
        label: tx('过期/重开', 'Expired/Reopen'),
        value: approvalStatusBreakdown.expired + approvalStatusBreakdown.reopened,
        tone: (approvalStatusBreakdown.expired + approvalStatusBreakdown.reopened) > 0 ? ('warn' as UiTone) : ('neutral' as UiTone),
      },
    ],
    [approvalStatusBreakdown, tx],
  );
  const timelinePhaseStats = useMemo(() => {
    const stats = { failures: 0, recoveries: 0, safetyEvents: 0, leagueEvents: 0 };
    timelineRows.forEach(row => {
      const blob = `${row.title} ${row.status} ${row.message}`.toLowerCase();
      if (blob.includes('fail') || blob.includes('blocked') || blob.includes('error')) stats.failures += 1;
      if (blob.includes('repair') || blob.includes('retry') || blob.includes('recover')) stats.recoveries += 1;
      if (blob.includes('approval') || blob.includes('safety') || blob.includes('policy')) stats.safetyEvents += 1;
      if (blob.includes('matrix') || blob.includes('league') || blob.includes('ranking')) stats.leagueEvents += 1;
    });
    return stats;
  }, [timelineRows]);
  const reportModel = useMemo<AgenticRunReportModel | null>(() => {
    if (runReport?.report && typeof runReport.report === 'object') {
      return runReport.report as AgenticRunReportModel;
    }
    if (!detail) return null;
    const rankingPreview = (matrixData?.ranking || []).slice(0, 5).map((item, idx) => ({
      rank: idx + 1,
      id: item.id,
      score: item.score,
    }));
    return {
      runId: detail.runId,
      title: selectedRunSummary?.title || String((detail.idea as Record<string, unknown>)?.title || 'Untitled Run'),
      status: detail.status,
      generatedAt: reportGeneratedAt || detail.updatedAt || new Date().toISOString(),
      objective: String((detail.idea as Record<string, unknown>)?.taskGoal || selectedRunSummary?.objective || '-'),
      contractPassRate: detail.contract.passRate,
      contractMissing: detail.contract.missing || [],
      totNodes: detail.totTree.length,
      timelineEvents: timelineRows.length,
      failureEvents: timelinePhaseStats.failures,
      recoveryEvents: timelinePhaseStats.recoveries,
      safetyEvents: timelinePhaseStats.safetyEvents,
      leagueEvents: timelinePhaseStats.leagueEvents,
      approvals: approvalStatusBreakdown,
      subAgents: {
        ...subAgentStats,
        topRoles: subAgentRoleMix,
      },
      matrix: {
        labels: matrixData?.labels.length || 0,
        topRanking: rankingPreview,
      },
      reproScript: `.local/agentic_os/runs/${detail.runId}/repro_bundle/reproduce.sh`,
      replayCommand: `python scripts/agentic_marl_os.py replay --run-id ${detail.runId}`,
      approvalPolicyMeta: ((detail.researchSpec as Record<string, unknown>)?.approvalPolicyMeta || {}) as Record<string, unknown>,
    };
  }, [
    runReport,
    detail,
    selectedRunSummary,
    reportGeneratedAt,
    matrixData,
    timelineRows.length,
    timelinePhaseStats,
    approvalStatusBreakdown,
    subAgentStats,
    subAgentRoleMix,
  ]);
  const reportMarkdown = useMemo(() => {
    if (runReport?.markdown) return runReport.markdown;
    if (!reportModel) return '';
    const lines = [
      `# Agentic Run Report - ${reportModel.runId}`,
      '',
      `- generated_at: ${reportModel.generatedAt}`,
      `- title: ${reportModel.title}`,
      `- status: ${reportModel.status}`,
      `- objective: ${reportModel.objective}`,
      `- contract_pass_rate: ${reportModel.contractPassRate.toFixed(2)}%`,
      '',
      '## Execution Overview',
      `- ToT nodes: ${reportModel.totNodes}`,
      `- timeline events: ${reportModel.timelineEvents}`,
      `- failure events: ${reportModel.failureEvents}`,
      `- recovery events: ${reportModel.recoveryEvents}`,
      `- safety events: ${reportModel.safetyEvents}`,
      `- league events: ${reportModel.leagueEvents}`,
      '',
      '## Safety & Approval',
      `- pending: ${reportModel.approvals.pending}`,
      `- approved: ${reportModel.approvals.approved}`,
      `- rejected: ${reportModel.approvals.rejected}`,
      `- expired: ${reportModel.approvals.expired}`,
      `- reopened: ${reportModel.approvals.reopened}`,
      '',
      '## Sub-Agent Orchestration',
      `- total: ${reportModel.subAgents.total}`,
      `- running: ${reportModel.subAgents.running}`,
      `- succeeded: ${reportModel.subAgents.succeeded}`,
      `- failed: ${reportModel.subAgents.failed}`,
      '- top roles:',
      ...reportModel.subAgents.topRoles.map(item => `  - ${item.role}: ${item.count}`),
      '',
      '## League Matrix',
      `- labels: ${reportModel.matrix.labels}`,
      '- top ranking:',
      ...reportModel.matrix.topRanking.map(item => `  - #${item.rank} ${item.id}: ${item.score.toFixed(2)}`),
      '',
      '## Contract Missing',
      ...(reportModel.contractMissing.length > 0 ? reportModel.contractMissing.map(item => `- ${item}`) : ['- none']),
      '',
      '## Repro & Replay',
      `- reproduce_script: ${reportModel.reproScript}`,
      `- replay_command: ${reportModel.replayCommand}`,
      '',
    ];
    return lines.join('\n');
  }, [runReport?.markdown, reportModel]);
  const reportPolicyMeta = useMemo(() => {
    if (reportModel && typeof reportModel.approvalPolicyMeta === 'object' && reportModel.approvalPolicyMeta) {
      return reportModel.approvalPolicyMeta as Record<string, unknown>;
    }
    const spec = (detail?.researchSpec || {}) as Record<string, unknown>;
    const meta = spec.approvalPolicyMeta;
    if (meta && typeof meta === 'object') return meta as Record<string, unknown>;
    return {};
  }, [reportModel, detail?.researchSpec]);

  useEffect(() => {
    if (!matrixData || matrixData.cells.length === 0) {
      if (selectedMatrixCellKey) setSelectedMatrixCellKey('');
      return;
    }
    if (!selectedMatrixCellKey || !matrixCellByKey.has(selectedMatrixCellKey)) {
      const first = matrixData.cells[0];
      setSelectedMatrixCellKey(matrixCellKey(first.row, first.col));
    }
  }, [matrixData, matrixCellByKey, selectedMatrixCellKey]);
  useEffect(() => {
    if (timelineRows.length === 0) {
      setTimelineCursor(0);
      setTimelinePlaying(false);
      return;
    }
    setTimelineCursor(timelineRows.length - 1);
  }, [detail?.updatedAt, timelineRows.length]);
  useEffect(() => {
    if (!timelinePlaying) return;
    if (timelineRows.length === 0) return;
    if (timelineCursor >= timelineRows.length - 1) {
      setTimelinePlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setTimelineCursor(prev => Math.min(timelineRows.length - 1, prev + 1));
    }, Math.max(160, timelineReplayMs));
    return () => window.clearTimeout(timer);
  }, [timelinePlaying, timelineRows.length, timelineCursor, timelineReplayMs]);
  useEffect(() => {
    if (!timelineSyncNode) return;
    if (!selectedTimelineRow) return;
    const nodeId = String(selectedTimelineRow.nodeId || '');
    if (!nodeId || nodeId === '-' || !nodeById.has(nodeId)) return;
    if (selectedNodeId !== nodeId) {
      setSelectedNodeId(nodeId);
    }
  }, [timelineSyncNode, selectedTimelineRow?.key, selectedNodeId, nodeById, selectedTimelineRow]);
  useEffect(() => {
    if (!graphAutoCenter) return;
    if (!selectedNodeId) return;
    const timer = window.setTimeout(() => {
      centerNodeInViewport(selectedNodeId, 'smooth');
    }, 60);
    return () => window.clearTimeout(timer);
  }, [graphAutoCenter, selectedNodeId, graphZoomPct, totGraph.width, totGraph.height, centerNodeInViewport]);
  useEffect(() => {
    refreshGraphViewportBox();
    const viewport = graphViewportRef.current;
    if (!viewport) return;
    const onScroll = () => refreshGraphViewportBox();
    viewport.addEventListener('scroll', onScroll);
    window.addEventListener('resize', refreshGraphViewportBox);
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', refreshGraphViewportBox);
    };
  }, [refreshGraphViewportBox, totGraph.width, totGraph.height, graphZoomPct]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = (target?.tagName || '').toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable) return;

      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        fitGraphToViewport();
        return;
      }
      if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        centerNodeInViewport(selectedNodeId, 'smooth');
        return;
      }
      if (event.key === '[') {
        event.preventDefault();
        setTimelinePlaying(false);
        setTimelineCursor(prev => Math.max(0, prev - 1));
        return;
      }
      if (event.key === ']') {
        event.preventDefault();
        setTimelinePlaying(false);
        setTimelineCursor(prev => Math.min(Math.max(0, timelineRows.length - 1), prev + 1));
        return;
      }
      if (event.code === 'Space') {
        if (timelineRows.length === 0) return;
        event.preventDefault();
        setTimelinePlaying(prev => {
          if (!prev && timelineCursor >= timelineRows.length - 1) {
            setTimelineCursor(0);
          }
          return !prev;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fitGraphToViewport, centerNodeInViewport, selectedNodeId, timelineRows.length, timelineCursor]);

  useEffect(() => {
    if (!detail) {
      setSubAgentItems([]);
      setSubAgentGraphItems([]);
      setSubAgentTotal(0);
      return;
    }
    let canceled = false;
    Promise.all([
      api.listAgenticSubAgents(detail.runId, {
        page: subAgentPage,
        pageSize: subAgentPageSize,
        nodeId: activeSubAgentNodeFilter || undefined,
        status: subAgentStatus === 'ALL' ? undefined : subAgentStatus,
      }),
      api.listAgenticSubAgents(detail.runId, {
        page: 1,
        pageSize: 200,
        nodeId: activeSubAgentNodeFilter || undefined,
        status: subAgentStatus === 'ALL' ? undefined : subAgentStatus,
      }),
    ]).then(([pageRes, graphRes]) => {
      if (canceled) return;
      setSubAgentItems(pageRes.items || []);
      setSubAgentTotal(pageRes.total || 0);
      setSubAgentGraphItems(graphRes.items || []);
      if (subAgentPage > 1 && (pageRes.items || []).length === 0 && (pageRes.total || 0) > 0) {
        setSubAgentPage(Math.max(1, subAgentPage - 1));
      }
    }).catch(err => {
      if (canceled) return;
      setMessage(String(err));
    });
    return () => {
      canceled = true;
    };
  }, [detail?.runId, detail?.updatedAt, activeSubAgentNodeFilter, subAgentPage, subAgentStatus, subAgentPageSize]);

  useEffect(() => {
    if (subAgentGraphItems.length === 0) {
      if (selectedSubAgentId) setSelectedSubAgentId('');
      return;
    }
    if (!selectedSubAgentId || !subAgentGraphItems.find(item => item.subAgentId === selectedSubAgentId)) {
      setSelectedSubAgentId(subAgentGraphItems[0].subAgentId);
    }
  }, [subAgentGraphItems, selectedSubAgentId]);

  const runAction = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    try {
      setBusy(label);
      setMessage('');
      await fn();
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy('');
    }
  };

  const buildValidationText = (res: Record<string, any>) => {
    return [
      `${tx('规范校验', 'Spec valid')}: ${boolLabel(Boolean(res.valid))}`,
      `${tx('环境', 'Environment')}: ${(res.normalizedSpec as any)?.environment?.name || '-'}`,
      `${tx('评估指标', 'Metric')}: ${(res.evalProtocolDraft as any)?.metric || '-'}`,
      `${tx('Sub-Agent 策略', 'Sub-Agent Policy')}: ${JSON.stringify((res.normalizedSpec as any)?.subAgentPolicy || {})}`,
      `${tx('审批策略', 'Approval Policy')}: ${JSON.stringify((res.normalizedSpec as any)?.approvalPolicy || {})}`,
      `${tx('检索命中', 'Retrieval hits')}: ${res.retrievalContext?.length || 0}`,
    ].join('\n');
  };

  const pendingRowsFromDetail = (run: AgenticRunDetail) => {
    return (run.pendingApprovals || []).filter(item => String((item as Record<string, unknown>).status || '').toUpperCase() === 'PENDING');
  };
  const buildIdeaDraftFromPrompt = (prompt: string): AgenticIdeaInput => {
    const text = prompt.trim();
    if (!text) return idea;
    return {
      ...idea,
      title: text,
      taskGoal: text,
    };
  };

  const handleValidate = () => runAction('validate', async () => {
    const res = await api.validateAgenticSpec(idea);
    setValidationText(buildValidationText(res as Record<string, any>));
  });

  const handleSuggestApprovalPolicy = () => runAction('policy-suggest', async () => {
    const suggestion = await refreshApprovalTemplates(idea);
    const riskScore = Number(suggestion.contextSummary.riskScore ?? 0);
    setShowSpecWorkspace(true);
    setShowApprovalConfig(true);
    setShowAdvancedConfig(true);
    setMessage(`${tx('建议策略', 'Suggested policy')}: ${suggestion.recommendedTemplateId || '-'} (${tx('风险分', 'risk score')}=${riskScore}).`);
  });

  const handleCreateRun = () => runAction('create', async () => {
    const created = await api.createAgenticRun({ idea, autoExecute: false, induceFailure: false });
    await refreshRuns();
    setSelectedRunId(created.runId);
    setMessage(`${tx('已创建运行', 'Created run')} ${created.runId}`);
  });
  const handleTopIdeaValidate = () => runAction('idea-validate', async () => {
    const draft = buildIdeaDraftFromPrompt(topInputValue);
    setIdea(draft);
    const res = await api.validateAgenticSpec(draft);
    setValidationText(buildValidationText(res as Record<string, any>));
    setMessage(tx('已根据顶部 Idea 生成规范草案。', 'Spec draft generated from top Idea input.'));
  });
  const handleTopIdeaCreateRun = () => runAction('idea-create-run', async () => {
    const draft = buildIdeaDraftFromPrompt(topInputValue);
    setIdea(draft);
    const created = await api.createAgenticRun({ idea: draft, autoExecute: false, induceFailure: false });
    await refreshRuns();
    setSelectedRunId(created.runId);
    setMessage(`${tx('已创建运行', 'Created run')} ${created.runId}`);
  });
  const handleTopSearch = () => {
    const query = topInputValue.trim();
    setNodeQuery(query);
    if (!query) {
      setMessage(tx('请输入节点关键词。', 'Enter a node keyword.'));
      return;
    }
    const lowered = query.toLowerCase();
    const firstMatch = sortedNodes.find(({ node }) =>
      `${node.nodeId} ${node.title} ${node.hypothesis}`.toLowerCase().includes(lowered),
    );
    if (!firstMatch) {
      setMessage(tx('未找到匹配节点。', 'No matching node found.'));
      return;
    }
    setSelectedNodeId(firstMatch.node.nodeId);
    window.setTimeout(() => centerNodeInViewport(firstMatch.node.nodeId, 'smooth'), 30);
    setMessage(`${tx('已定位节点', 'Focused node')}: ${firstMatch.node.nodeId}`);
  };
  const handleTopInputSubmit = () => {
    if (topInputMode === 'search') {
      handleTopSearch();
      return;
    }
    handleTopIdeaValidate();
  };

  const handleExecute = (mode: 'all' | 'next') => runAction('execute', async () => {
    if (!detail) return;
    const res = await api.executeAgenticRun(detail.runId, { mode });
    setDetail(res.detail);
    await refreshRuns();
    setMessage(res.message);
  });

  const approvePendingForRun = async (
    runId: string,
    rows: Array<Record<string, unknown>>,
    comment?: string,
  ): Promise<AgenticRunDetail> => {
    if (rows.length === 0) {
      return api.getAgenticRun(runId);
    }
    const approvalIds = rows.map(item => String(item.id));
    const requiredRoles = new Set<ApprovalActorRole>();
    const actions = new Set<string>();
    rows.forEach(row => {
      const rowRoles = Array.isArray(row.requiredRoles)
        ? row.requiredRoles
        : (Array.isArray(row.required_roles) ? row.required_roles : []);
      rowRoles.forEach(role => {
        const normalized = String(role || '').trim().toLowerCase();
        if (normalized === 'admin' || normalized === 'ops' || normalized === 'security') {
          requiredRoles.add(normalized as ApprovalActorRole);
        }
      });
      const action = String(row.action || '').trim();
      if (action) actions.add(action);
    });
    const maxRequired = rows.reduce(
      (acc, item) => Math.max(acc, Number(item.requiredApprovals || item.required_approvals || 1)),
      1,
    );
    const distinctRequired = rows.some(item => Boolean(item.requireDistinctRoles || item.require_distinct_roles || false));
    const preferredActor = selectedApprovalActor || fallbackApprovalActors[0];
    const primaryActor = resolveApprovalActor(
      preferredActor,
      requiredRoles.size > 0 ? Array.from(requiredRoles) : undefined,
      undefined,
      Array.from(actions),
    );

    let res = await api.approveAgenticActions(runId, {
      approvalIds,
      decision: 'approve',
      actorId: primaryActor.actorId,
      actorRole: primaryActor.actorRole,
      idempotencyKey: `approve-${runId}-${Date.now()}`,
      comment,
    });

    if (distinctRequired && maxRequired >= 2) {
      const used = new Set<string>([`${primaryActor.actorId}::${primaryActor.actorRole}`]);
      const secondaryRoles = requiredRoles.size > 0
        ? Array.from(requiredRoles).filter(role => role !== primaryActor.actorRole)
        : undefined;
      const secondaryActor = resolveApprovalActor(
        undefined,
        secondaryRoles && secondaryRoles.length > 0 ? secondaryRoles : undefined,
        used,
        Array.from(actions),
      );
      if (`${secondaryActor.actorId}::${secondaryActor.actorRole}` !== `${primaryActor.actorId}::${primaryActor.actorRole}`) {
        res = await api.approveAgenticActions(runId, {
          approvalIds,
          decision: 'approve',
          actorId: secondaryActor.actorId,
          actorRole: secondaryActor.actorRole,
          idempotencyKey: `approve2-${runId}-${Date.now()}`,
          comment,
        });
      }
    }

    return res.detail;
  };

  const handleApproveAll = () => runAction('approve', async () => {
    if (!detail || pendingApprovals.length === 0) return;
    const rows = pendingApprovals.map(item => item as Record<string, unknown>);
    const nextDetail = await approvePendingForRun(detail.runId, rows, approvalComment || undefined);
    setDetail(nextDetail);
    setApprovalComment('');
    setMessage(tx('已批准待处理高风险动作。', 'Approved pending high-risk actions.'));
  });

  const handleRejectAll = () => runAction('reject', async () => {
    if (!detail || pendingApprovals.length === 0) return;
    const approvalIds = pendingApprovals.map(item => String(item.id));
    const actions = pendingApprovals
      .map(item => String((item as Record<string, unknown>).action || '').trim())
      .filter(Boolean);
    const actor = resolveApprovalActor(selectedApprovalActor || fallbackApprovalActors[0], ['admin', 'ops', 'security'], undefined, actions);
    const res = await api.approveAgenticActions(detail.runId, {
      approvalIds,
      decision: 'reject',
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      idempotencyKey: `reject-${detail.runId}-${Date.now()}`,
      comment: approvalComment || 'Rejected in UI review',
    });
    setDetail(res.detail);
    setApprovalComment('');
    setMessage(tx('已拒绝待处理审批。', 'Rejected pending approvals.'));
  });

  const handleReopenAll = () => runAction('reopen', async () => {
    if (!detail) return;
    const candidates = (detail.pendingApprovals || []).filter(item => {
      const status = String((item as Record<string, unknown>).status || '').toUpperCase();
      return status === 'REJECTED' || status === 'EXPIRED' || status === 'APPROVED';
    });
    if (candidates.length === 0) return;
    const actions = candidates
      .map(item => String((item as Record<string, unknown>).action || '').trim())
      .filter(Boolean);
    const actor = resolveApprovalActor(selectedApprovalActor || fallbackApprovalActors[0], ['admin', 'security'], undefined, actions);
    const res = await api.approveAgenticActions(detail.runId, {
      approvalIds: candidates.map(item => String((item as Record<string, unknown>).id)),
      decision: 'reopen',
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      idempotencyKey: `reopen-${detail.runId}-${Date.now()}`,
      comment: approvalComment || 'Reopened for resubmission',
    });
    setDetail(res.detail);
    setApprovalComment('');
    setMessage(tx('审批已重新打开，可重新提交。', 'Reopened approvals for resubmission.'));
  });

  const handleRecover = () => runAction('recover', async () => {
    if (!detail) return;
    const res = await api.recoverAgenticRun(detail.runId);
    setDetail(res.detail);
    setMessage(res.message);
  });

  const handleAddBranch = () => runAction('branch', async () => {
    if (!detail || !selectedNode) return;
    const title = window.prompt(tx('分支标题', 'Branch title'), tx(`从 ${selectedNode.nodeId} 分支`, `Branch from ${selectedNode.nodeId}`));
    if (!title) return;
    const hypothesis = window.prompt(tx('假设', 'Hypothesis'), tx('该分支可在更低成本下提升胜率。', 'This branch can improve win rate with lower cost.'));
    if (!hypothesis) return;
    const executionPlan = window.prompt(tx('执行计划', 'Execution plan'), tx('调整 rollout 长度并重试评估。', 'Adjust rollout length and retry evaluation.'));
    if (!executionPlan) return;
    const res = await api.addAgenticBranch(detail.runId, selectedNode.nodeId, {
      title,
      hypothesis,
      executionPlan,
      expectedMetrics: { winRate: '>=0.63' },
      budget: { gpuHours: 0.4, wallclockMinutes: 20 },
      risk: 'medium',
    });
    setDetail(res.detail);
    setSelectedNodeId(res.detail.totTree[res.detail.totTree.length - 1]?.nodeId || selectedNode.nodeId);
  });

  const handleDeleteNode = () => runAction('delete', async () => {
    if (!detail || !selectedNode || selectedNode.nodeId === 'n0') return;
    if (!window.confirm(tx(`确认删除节点 ${selectedNode.nodeId} 及其所有后代吗？`, `Delete node ${selectedNode.nodeId} and descendants?`))) return;
    const res = await api.deleteAgenticBranch(detail.runId, selectedNode.nodeId);
    setDetail(res.detail);
    setSelectedNodeId('n0');
  });

  const handleMatrix = () => runAction('matrix', async () => {
    if (!detail) return;
    await api.generateAgenticMatrix(detail.runId, { downsample: true, maxSize: 8 });
    await loadRun(detail.runId);
    setMessage(tx('矩阵已生成。', 'Matrix generated.'));
  });

  const handleExportRepro = () => runAction('repro', async () => {
    if (!detail) return;
    const res = await api.exportAgenticReproBundle(detail.runId);
    setMessage(`${tx('复现包已导出', 'Repro bundle exported')}: ${res.bundlePath}`);
    await loadRun(detail.runId);
  });

  const handleAuditReplay = () => runAction('audit', async () => {
    if (!detail) return;
    const replay = await api.replayAgenticAudit(detail.runId);
    setAuditReplay(replay);
    if (replay.verified) {
      setMessage(`${tx('审计验证通过', 'Audit verified')} (${replay.checkedEvents} ${tx('条事件', 'events')}).`);
      return;
    }
    setMessage(`${tx('审计回放失败', 'Audit replay failed')}: ${replay.failureReason || tx('未知原因', 'unknown_reason')}`);
  });
  const handleRefreshReportSnapshot = () => runAction('report', async () => {
    if (!detail) return;
    try {
      const payload = await api.getAgenticRunReport(detail.runId);
      setRunReport(payload);
      setMessage(tx('报告快照已从后端产物刷新。', 'Report snapshot refreshed from backend artifacts.'));
    } catch (err) {
      setRunReport(null);
      setReportGeneratedAt(new Date().toISOString());
      setMessage(`${tx('报告 API 不可用，已切换本地快照', 'Report API unavailable, switched to local snapshot')}: ${String(err)}`);
    }
  });
  const handleCopyReproCommand = async () => {
    if (!reportModel) return;
    try {
      await copyTextToClipboard(`bash ${reportModel.reproScript}`);
      setMessage(tx('复现命令已复制。', 'Repro command copied.'));
    } catch (err) {
      setMessage(`${tx('复制命令失败', 'Failed to copy command')}: ${String(err)}`);
    }
  };
  const handleExportReportMarkdown = () => {
    if (!reportModel || !reportMarkdown) return;
    const blob = new Blob([reportMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `agentic_report_${reportModel.runId}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setMessage(`${tx('报告已导出', 'Report exported')}: agentic_report_${reportModel.runId}.md`);
  };

  const handleRunQuickDemo = () => runAction('quick-demo', async () => {
    const validationRes = await api.validateAgenticSpec(idea);
    setValidationText(buildValidationText(validationRes as Record<string, any>));

    const created = await api.createAgenticRun({ idea, autoExecute: false, induceFailure: false });
    await refreshRuns();
    setSelectedRunId(created.runId);

    let current = await api.getAgenticRun(created.runId);
    let attempts = 0;
    while (attempts < 6) {
      attempts += 1;
      const execRes = await api.executeAgenticRun(created.runId, { mode: 'all' });
      current = execRes.detail;
      const pending = pendingRowsFromDetail(current).map(item => item as Record<string, unknown>);
      if (pending.length > 0) {
        current = await approvePendingForRun(created.runId, pending, 'quick_demo_auto_approval');
        const retryRes = await api.executeAgenticRun(created.runId, { mode: 'all' });
        current = retryRes.detail;
      }
      const runStatus = String(current.status || '').toUpperCase();
      if (runStatus === 'SUCCEEDED' || runStatus === 'FAILED') break;
    }

    await api.generateAgenticMatrix(created.runId, { downsample: true, maxSize: 8 });
    const reproRes = await api.exportAgenticReproBundle(created.runId);
    current = await api.getAgenticRun(created.runId);
    setDetail(current);
    setMessage(`${tx('快速链路完成', 'Quick demo complete')}: ${created.runId} | repro: ${reproRes.bundlePath}`);
  });

  const runQuickStartStep = (stepId: string) => {
    if (stepId === 'spec') {
      handleValidate();
      return;
    }
    if (stepId === 'run') {
      handleCreateRun();
      return;
    }
    if (stepId === 'execute') {
      handleExecute('all');
      return;
    }
    if (stepId === 'approve') {
      handleApproveAll();
      return;
    }
    if (stepId === 'matrix') {
      handleMatrix();
      return;
    }
    if (stepId === 'repro') {
      handleExportRepro();
    }
  };

  const subAgentPageCount = Math.max(1, Math.ceil(subAgentTotal / subAgentPageSize));
  const auditReplayData = auditReplay?.replay || {};
  const auditSemanticIssues = Array.isArray(auditReplayData.semanticIssues) ? auditReplayData.semanticIssues : [];
  const auditHealth = useMemo(() => {
    if (!auditReplay) {
      return {
        tone: 'neutral' as UiTone,
        label: tx('待验证', 'Not Verified'),
        hint: tx('尚未执行审计回放验证。', 'Audit replay has not been verified yet.'),
      };
    }
    if (!auditReplay.verified || auditSemanticIssues.length > 0 || Boolean(auditReplay.failureReason)) {
      const hasFailure = !auditReplay.verified || Boolean(auditReplay.failureReason);
      return {
        tone: hasFailure ? ('danger' as UiTone) : ('warn' as UiTone),
        label: hasFailure ? tx('失败', 'Failed') : tx('告警', 'Warning'),
        hint: hasFailure
          ? tx('审计校验未通过，请排查证据链完整性。', 'Audit verification failed. Check evidence-chain integrity.')
          : tx('检测到语义问题，建议复核事件序列。', 'Semantic issues detected. Review replayed event sequence.'),
      };
    }
    return {
      tone: 'success' as UiTone,
      label: tx('通过', 'Passed'),
      hint: tx('审计链路与回放语义一致。', 'Audit chain and replay semantics are consistent.'),
    };
  }, [auditReplay, auditSemanticIssues, tx]);
  const auditKpiCards = useMemo(
    () => [
      {
        key: 'checked',
        label: tx('已检查事件', 'Checked'),
        value: auditReplay ? auditReplay.checkedEvents : '-',
        tone: auditReplay ? ('info' as UiTone) : ('neutral' as UiTone),
      },
      {
        key: 'semantic',
        label: tx('语义问题', 'Semantic Issues'),
        value: auditSemanticIssues.length,
        tone: auditSemanticIssues.length > 0 ? ('warn' as UiTone) : ('success' as UiTone),
      },
      {
        key: 'subagent_fail',
        label: tx('SubAgent 失败', 'SubAgent Failed'),
        value: Number(auditReplayData.subAgentsFailed || 0),
        tone: Number(auditReplayData.subAgentsFailed || 0) > 0 ? ('danger' as UiTone) : ('neutral' as UiTone),
      },
      {
        key: 'replay',
        label: tx('回放状态', 'Replay'),
        value: String(auditReplayData.replayStatus || '-'),
        tone: auditReplay?.verified ? ('success' as UiTone) : ('neutral' as UiTone),
      },
    ],
    [auditReplay, auditReplayData.replayStatus, auditReplayData.subAgentsFailed, auditSemanticIssues.length, tx],
  );
  const rightPanelTabHint = useMemo(() => {
    if (rightPanelTab === 'dialogue') return tx('建议与快速动作', 'Suggestions and quick actions');
    if (rightPanelTab === 'approvals') return tx('安全审批与决策轨迹', 'Safety approvals and decision trail');
    if (rightPanelTab === 'subagents') return tx('Sub-Agent 编排与链路', 'Sub-agent orchestration and lineage');
    if (rightPanelTab === 'report') return tx('运行报告与复现实验摘要', 'Run report and reproducibility summary');
    return tx('审计验证与事件回放', 'Audit verification and event replay');
  }, [rightPanelTab, tx]);
  const rightPanelTabs = useMemo(
    () => [
      { id: 'dialogue' as RightPanelTab, label: tx('对话', 'Dialogue'), badgeTone: 'neutral' as UiTone },
      {
        id: 'approvals' as RightPanelTab,
        label: tx('审批', 'Approvals'),
        badge: pendingApprovals.length > 0 ? String(pendingApprovals.length) : undefined,
        badgeTone: pendingApprovals.length > 0 ? ('warn' as UiTone) : ('success' as UiTone),
      },
      {
        id: 'subagents' as RightPanelTab,
        label: tx('SubAgent', 'SubAgents'),
        badge: subAgentStats.running > 0 ? String(subAgentStats.running) : undefined,
        badgeTone: subAgentStats.running > 0 ? ('info' as UiTone) : ('neutral' as UiTone),
      },
      {
        id: 'report' as RightPanelTab,
        label: tx('报告', 'Report'),
        badge: reportModel ? `${Math.round(reportModel.contractPassRate)}%` : undefined,
        badgeTone: reportModel
          ? (reportModel.contractPassRate < 95 ? ('warn' as UiTone) : ('success' as UiTone))
          : ('neutral' as UiTone),
      },
      {
        id: 'audit' as RightPanelTab,
        label: tx('审计', 'Audit'),
        badge: auditReplay ? (auditReplay.verified ? tx('OK', 'OK') : tx('WARN', 'WARN')) : undefined,
        badgeTone: auditHealth.tone,
      },
    ],
    [tx, pendingApprovals.length, subAgentStats.running, reportModel, auditReplay, auditHealth.tone],
  );

  return (
    <div className={`agentic-lab space-y-5 ${isFocusedWorkspace ? 'agentic-lab-focused' : 'agentic-lab-full'}`}>
      <div className="agentic-hero rounded-3xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="agentic-pill mb-2 inline-flex rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase">
              {t('agentic.hero.badge', 'Agentic Research Workspace')}
            </div>
            <h1 className="display-title">{t('agentic.hero.title', 'Agentic MARL Lab')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('agentic.hero.subtitle', 'ToT-first workspace for idea-to-league execution, replay, and repro bundle export.')}</p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white/85 px-2 py-1 text-[11px] text-slate-600">
              <span className="font-semibold">{t('agentic.hero.chainSource', 'Chain Source')}:</span>
              <span className={`rounded px-1.5 py-0.5 font-semibold ${isDemoMode ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {isDemoMode
                  ? t('agentic.hero.chainSource.demo', 'Demo Mock')
                  : t('agentic.hero.chainSource.live', 'Live API')}
              </span>
              <button
                type="button"
                onClick={() => setDemoMode(!isDemoMode)}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
              >
                {isDemoMode
                  ? t('agentic.hero.switchLive', 'Use Live')
                  : t('agentic.hero.switchDemo', 'Use Demo')}
              </button>
            </div>
          </div>
          <div className="agentic-toolbar flex flex-wrap gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setSurfaceMode('tree_first')}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                  isTreeFirst ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                {tx('树优先', 'Tree-First')}
              </button>
              <button
                type="button"
                onClick={() => setSurfaceMode('classic')}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                  !isTreeFirst ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                {tx('工作室', 'Studio')}
              </button>
            </div>
            {isTreeFirst ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowContextPanel(prev => !prev)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    showContextPanel
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {showContextPanel ? tx('隐藏上下文', 'Hide Context') : tx('显示上下文', 'Show Context')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSurfaceMode('classic');
                    setShowSpecWorkspace(true);
                    setShowAdvancedConfig(true);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {tx('打开高级配置', 'Open Advanced Config')}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                  <button
                    type="button"
                    onClick={() => setUxMode('guided')}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                      uxMode === 'guided' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    {tx('引导模式', 'Guided')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setUxMode('expert')}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                      uxMode === 'expert' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    {tx('专家模式', 'Expert')}
                  </button>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                  <button
                    type="button"
                    onClick={() => setWorkspaceDensity('focused')}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                      workspaceDensity === 'focused' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    {tx('简洁视图', 'Focused')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceDensity('full')}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                      workspaceDensity === 'full' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    {tx('完整视图', 'Full')}
                  </button>
                </div>
                <button
                  onClick={handleRunQuickDemo}
                  disabled={Boolean(busy)}
                  className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('agentic.hero.quickChain', 'One-click Full Chain')}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/settings?panel=docs')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {tx('什么是 ToT？', 'What is ToT?')}
                </button>
                <button
                  onClick={() => setShowSpecWorkspace(prev => !prev)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    showSpecWorkspace
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {showSpecWorkspace ? tx('收起规范工作区', 'Hide Spec Workspace') : tx('打开规范工作区', 'Open Spec Workspace')}
                </button>
                {uxMode === 'expert' && (
                  <>
                    <button onClick={handleValidate} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      {tx('校验规范', 'Validate Spec')}
                    </button>
                    <button onClick={handleSuggestApprovalPolicy} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      <WandSparkles className="mr-1 inline h-4 w-4" />{tx('建议策略', 'Suggest Policy')}
                    </button>
                    <button onClick={handleCreateRun} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
                      {tx('创建运行', 'Create Run')}
                    </button>
                    <button onClick={() => refreshRuns()} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      <RefreshCcw className="mr-1 inline h-4 w-4" />{tx('刷新', 'Refresh')}
                    </button>
                  </>
                )}
                <label className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-500">
                  {tx('运行', 'Run')}
                  <select
                    value={selectedRunId}
                    onChange={e => setSelectedRunId(e.target.value)}
                    className="max-w-48 bg-transparent text-xs text-gray-700 outline-none"
                  >
                    <option value="">{tx('选择', 'select')}</option>
                    {runs.map(run => (
                      <option key={run.runId} value={run.runId}>
                        {run.title}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </div>

        {isTreeFirst && (
          <div className="agentic-ribbon mt-4 rounded-2xl border border-slate-200 p-3">
            <div className="grid gap-2 lg:grid-cols-[auto_auto_1fr_auto_auto_auto]">
              <label className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-500">
                {tx('运行', 'Run')}
                <select
                  value={selectedRunId}
                  onChange={e => setSelectedRunId(e.target.value)}
                  className="max-w-52 bg-transparent text-xs text-gray-700 outline-none"
                >
                  <option value="">{tx('选择', 'select')}</option>
                  {runs.map(run => (
                    <option key={run.runId} value={run.runId}>
                      {run.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setTopInputMode('idea');
                    setTopInputValue((idea.title || idea.taskGoal || '').trim());
                  }}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                    topInputMode === 'idea' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  {tx('Idea', 'Idea')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTopInputMode('search');
                    setTopInputValue(nodeQuery);
                  }}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                    topInputMode === 'search' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  {tx('检索树', 'Search Tree')}
                </button>
              </div>
              <input
                value={topInputValue}
                onChange={e => setTopInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleTopInputSubmit();
                  }
                }}
                placeholder={
                  topInputMode === 'idea'
                    ? tx('输入 Idea，回车生成规范草案…', 'Type your idea and press Enter to draft spec...')
                    : tx('搜索节点ID/标题/假设…', 'Search by node id/title/hypothesis...')
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-300"
              />
              <button
                type="button"
                onClick={handleTopInputSubmit}
                className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                {topInputMode === 'idea' ? tx('生成规范', 'Draft Spec') : tx('定位节点', 'Locate Node')}
              </button>
              <button
                type="button"
                onClick={handleTopIdeaCreateRun}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                {tx('创建运行', 'Create Run')}
              </button>
              <button
                type="button"
                onClick={() => handleExecute('next')}
                disabled={!detail}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {tx('执行下一步', 'Run Next')}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>
                {tx(
                  '主路径：输入 Idea -> 生成树 -> 选节点 -> 执行/分支。',
                  'Main flow: Idea -> Tree -> Node -> Execute/Branch.',
                )}
              </span>
              {selectedRunSummary && (
                <span className={`rounded px-1.5 py-0.5 font-semibold ${statusColor(selectedRunSummary.status)}`}>
                  {selectedRunSummary.title} · {statusLabel(selectedRunSummary.status)}
                </span>
              )}
            </div>
          </div>
        )}

        {!isTreeFirst && (
        <>
        {showSpecWorkspace ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{tx('运行配置', 'Run Setup')}</div>
              <button
                type="button"
                onClick={() => setShowAdvancedConfig(prev => !prev)}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-white"
              >
                {showAdvancedConfig ? tx('收起高级项', 'Hide Advanced') : tx('显示高级项', 'Show Advanced')}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {tx('标题', 'Title')}
                <input
                  value={idea.title}
                  onChange={e => setIdea(prev => ({ ...prev, title: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {tx('环境', 'Environment')}
                <input
                  value={idea.environment}
                  onChange={e => setIdea(prev => ({ ...prev, environment: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {tx('GPU 小时', 'GPU Hours')}
                <input
                  type="number"
                  value={idea.budget.gpuHours}
                  onChange={e => setIdea(prev => ({ ...prev, budget: { ...prev.budget, gpuHours: Number(e.target.value || 0) } }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {tx('时长预算（分钟）', 'Wallclock (min)')}
                <input
                  type="number"
                  value={idea.budget.wallclockMinutes}
                  onChange={e => setIdea(prev => ({ ...prev, budget: { ...prev.budget, wallclockMinutes: Number(e.target.value || 0) } }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {tx('执行模式', 'Execution Mode')}
	                <select
	                  value={idea.executionMode || 'offline_stub'}
	                  onChange={e => setIdea(prev => ({ ...prev, executionMode: e.target.value as AgenticIdeaInput['executionMode'] }))}
	                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
	                >
	                  <option value="offline_stub">{tx('离线模拟（offline_stub）', 'Offline Stub (offline_stub)')}</option>
	                  <option value="local_shell">{tx('本地命令（local_shell）', 'Local Shell (local_shell)')}</option>
	                  <option value="mle_runner">{tx('MLE Runner（mle_runner）', 'MLE Runner (mle_runner)')}</option>
	                </select>
	              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {tx('本地命令', 'Local Command')}
                <input
                  value={idea.localCommand || ''}
                  onChange={e => setIdea(prev => ({ ...prev, localCommand: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder={tx('python -c "print(\'agentic_local_shell_ok\')"（仅 local_shell）', 'python -c "print(\'agentic_local_shell_ok\')" (local_shell only)')}
                />
              </label>
            </div>

            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              {tx('任务目标', 'Task Goal')}
              <textarea
                value={idea.taskGoal}
                onChange={e => setIdea(prev => ({ ...prev, taskGoal: e.target.value }))}
                className="mt-1 h-20 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowSafetyConfig(prev => !prev)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${showSafetyConfig ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-white'}`}
              >
                {tx('安全输入', 'Safety Inputs')}
              </button>
              <button
                type="button"
                onClick={() => setShowSubAgentConfig(prev => !prev)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${showSubAgentConfig ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-white'}`}
              >
                {tx('Sub-Agent 策略', 'Sub-Agent Policy')}
              </button>
              <button
                type="button"
                onClick={() => setShowApprovalConfig(prev => !prev)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${showApprovalConfig ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-white'}`}
              >
                {tx('审批策略', 'Approval Policy')}
              </button>
            </div>

            {(showSafetyConfig || showAdvancedConfig) && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{tx('策略建议的安全输入', 'Safety Inputs for Policy Suggestion')}</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('请求动作（CSV）', 'Requested Actions (CSV)')}
                    <input
                      value={(idea.requestedActions || []).join(',')}
                      onChange={e => patchRequestedActionsFromCsv(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
	                      placeholder={tx('unknown_script_execution,custom_action_x（示例）', 'unknown_script_execution,custom_action_x (example)')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('禁止动作（CSV）', 'Forbidden Actions (CSV)')}
                    <input
                      value={idea.constraints.forbiddenActions.join(',')}
                      onChange={e => patchConstraintsFromCsv('forbiddenActions', e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
	                      placeholder={tx('data_exfiltration（示例）', 'data_exfiltration (example)')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('合规条目（CSV）', 'Compliance (CSV)')}
                    <input
                      value={idea.constraints.compliance.join(',')}
                      onChange={e => patchConstraintsFromCsv('compliance', e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
	                      placeholder={tx('no_pii,no_external_data_push（示例）', 'no_pii,no_external_data_push (example)')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('允许网络', 'Allow Network')}
                    <select
                      value={idea.constraints.allowNetwork ? 'true' : 'false'}
                      onChange={e => setIdea(prev => ({ ...prev, constraints: { ...prev.constraints, allowNetwork: e.target.value === 'true' } }))}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="false">{tx('否', 'false')}</option>
                      <option value="true">{tx('是', 'true')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('允许依赖安装', 'Allow Dependency Install')}
                    <select
                      value={idea.constraints.allowDependencyInstall ? 'true' : 'false'}
                      onChange={e =>
                        setIdea(prev => ({ ...prev, constraints: { ...prev.constraints, allowDependencyInstall: e.target.value === 'true' } }))
                      }
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="false">{tx('否', 'false')}</option>
                      <option value="true">{tx('是', 'true')}</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {(showSubAgentConfig || showAdvancedConfig) && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{tx('Sub-Agent 策略', 'Sub-Agent Policy')}</div>
                <div className="grid gap-3 md:grid-cols-5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('启用', 'Enabled')}
                    <select
                      value={resolvedSubAgentPolicy.enabled ? 'true' : 'false'}
                      onChange={e => patchSubAgentPolicy({ enabled: e.target.value === 'true' })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="true">{tx('是', 'true')}</option>
                      <option value="false">{tx('否', 'false')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('最大深度', 'Max Depth')}
                    <input
                      type="number"
                      min={1}
                      max={4}
                      value={resolvedSubAgentPolicy.maxDepth}
                      onChange={e => patchSubAgentPolicy({ maxDepth: Number(e.target.value || 1) })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('每节点上限', 'Max Per Node')}
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={resolvedSubAgentPolicy.maxPerNode}
                      onChange={e => patchSubAgentPolicy({ maxPerNode: Number(e.target.value || 1) })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('总上限', 'Max Total')}
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={resolvedSubAgentPolicy.maxTotal}
                      onChange={e => patchSubAgentPolicy({ maxTotal: Number(e.target.value || 1) })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('超时（毫秒）', 'Timeout (ms)')}
                    <input
                      type="number"
                      min={50}
                      max={10000}
                      step={50}
                      value={resolvedSubAgentPolicy.timeoutMs}
                      onChange={e => patchSubAgentPolicy({ timeoutMs: Number(e.target.value || 50) })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>
              </div>
            )}

            {(showApprovalConfig || showAdvancedConfig) && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{tx('审批策略', 'Approval Policy')}</div>
                <div className="mb-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('策略预设', 'Policy Preset')}
                    <select
                      value={selectedApprovalTemplateId}
                      onChange={e => setSelectedApprovalTemplateId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {approvalPolicyTemplates.map(item => (
                        <option key={item.templateId} value={item.templateId}>
                          {item.label}{item.recommended ? ` (${tx('推荐', 'Recommended')})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => applyApprovalTemplate(selectedApprovalTemplateId)}
                    className="mt-5 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {tx('应用预设', 'Apply Preset')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSuggestApprovalPolicy}
                    className="mt-5 rounded-md border border-blue-300 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  >
                    {tx('按 Idea 建议', 'Suggest by Idea')}
                  </button>
                </div>
                <div className="mb-2 text-[11px] text-gray-500">
                  {(approvalPolicyTemplates.find(item => item.templateId === selectedApprovalTemplateId)?.description) || tx('自定义审批策略', 'Custom approval policy')}
                </div>
                <div className="mb-2 text-[11px] text-gray-500">
                  {(approvalPolicyTemplates.find(item => item.templateId === selectedApprovalTemplateId)?.rationale) || tx('暂无策略说明。', 'No rationale available.')}
                </div>
                <div className="mb-2 text-[11px] text-gray-500">
                  {tx('风险分', 'riskScore')}: {Number(approvalPolicyContextSummary.riskScore ?? 0)}
                  {' '}| {tx('阻塞请求', 'blockedRequested')}: {Array.isArray(approvalPolicyContextSummary.blockedRequestedActions) ? approvalPolicyContextSummary.blockedRequestedActions.length : 0}
                  {' '}| {tx('未知动作', 'unknownActions')}: {Array.isArray(approvalPolicyContextSummary.unknownActions) ? approvalPolicyContextSummary.unknownActions.length : 0}
                </div>
                <div className="mb-2 text-[11px] text-gray-500">
                  {tx('规则版本', 'rulesVersion')}: {approvalRulesVersion}
                  {' '}| {tx('规则哈希', 'rulesHash')}: <span className="font-mono">{approvalRulesHashShort}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('模式', 'Mode')}
                    <select
                      value={resolvedApprovalPolicy.mode}
                      onChange={e => patchApprovalPolicy({ mode: e.target.value as AgenticApprovalPolicy['mode'] })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="strict">{tx('严格', 'strict')}</option>
                      <option value="balanced">{tx('均衡', 'balanced')}</option>
                      <option value="permissive">{tx('宽松', 'permissive')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('未知动作', 'Unknown Actions')}
                    <select
                      value={resolvedApprovalPolicy.requireApprovalForUnknownActions ? 'true' : 'false'}
                      onChange={e => patchApprovalPolicy({ requireApprovalForUnknownActions: e.target.value === 'true' })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="true">{tx('需要审批', 'require approval')}</option>
                      <option value="false">{tx('默认允许', 'allow by default')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('高风险角色', 'High-Risk Roles')}
                    <input
                      value={resolvedApprovalPolicy.highRiskActionRoles.join(',')}
                      onChange={e => patchApprovalPolicy({
                        highRiskActionRoles: e.target.value.split(',').map(v => v.trim()).filter(Boolean) as Array<'admin' | 'ops' | 'security'>,
                      })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
	                      placeholder={tx('admin,ops,security（示例）', 'admin,ops,security (example)')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('拦截角色', 'Blocked Roles')}
                    <input
                      value={resolvedApprovalPolicy.blockedActionRoles.join(',')}
                      onChange={e => patchApprovalPolicy({
                        blockedActionRoles: e.target.value.split(',').map(v => v.trim()).filter(Boolean) as Array<'admin' | 'ops' | 'security'>,
                      })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
	                      placeholder={tx('admin,security（示例）', 'admin,security (example)')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('最少审批数', 'Min Approvals')}
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={Number(resolvedApprovalPolicy.minApprovals || 1)}
                      onChange={e => patchApprovalPolicy({ minApprovals: Math.max(1, Math.min(3, Number(e.target.value || 1))) })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('角色需不同', 'Distinct Roles')}
                    <select
                      value={resolvedApprovalPolicy.requireDistinctRoles ? 'true' : 'false'}
                      onChange={e => patchApprovalPolicy({ requireDistinctRoles: e.target.value === 'true' })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="false">{tx('否', 'false')}</option>
                      <option value="true">{tx('是', 'true')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tx('审批 TTL（分钟）', 'Approval TTL (min)')}
                    <input
                      type="number"
                      min={5}
                      max={10080}
                      value={Number(resolvedApprovalPolicy.approvalTtlMinutes || 120)}
                      onChange={e => patchApprovalPolicy({ approvalTtlMinutes: Math.max(5, Math.min(10080, Number(e.target.value || 120))) })}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">{tx('运行上下文', 'Run Context')}</div>
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-blue-700">
              {tx('选中运行', 'Selected Run')}
              <select
                value={selectedRunId}
                onChange={e => setSelectedRunId(e.target.value)}
                className="mt-1 w-full rounded-md border border-blue-200 bg-white px-2 py-1.5 text-sm text-gray-700"
              >
                <option value="">{tx('选择运行', 'Select run')}</option>
                {runs.map(run => (
                  <option key={run.runId} value={run.runId}>
                    {run.title} ({run.runId.slice(0, 8)})
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-blue-200 bg-white p-2 text-blue-800">
                <div className="text-[10px] uppercase tracking-wide text-blue-500">{tx('运行数', 'Runs')}</div>
                <div className="mt-1 text-sm font-semibold">{runs.length}</div>
              </div>
              <div className="rounded-md border border-blue-200 bg-white p-2 text-blue-800">
                <div className="text-[10px] uppercase tracking-wide text-blue-500">{tx('待审批', 'Pending Approvals')}</div>
                <div className="mt-1 text-sm font-semibold">{pendingApprovals.length}</div>
              </div>
              <div className="rounded-md border border-blue-200 bg-white p-2 text-blue-800">
                <div className="text-[10px] uppercase tracking-wide text-blue-500">{tx('Sub-Agent', 'Sub-Agents')}</div>
                <div className="mt-1 text-sm font-semibold">{subAgentStats.total}</div>
              </div>
              <div className="rounded-md border border-blue-200 bg-white p-2 text-blue-800">
                <div className="text-[10px] uppercase tracking-wide text-blue-500">{tx('契约通过率', 'Contract')}</div>
                <div className="mt-1 text-sm font-semibold">{detail ? `${detail.contract.passRate.toFixed(1)}%` : '-'}</div>
              </div>
            </div>

            {selectedRunSummary ? (
              <div className="mt-3 rounded-md border border-blue-200 bg-white p-2 text-xs text-gray-700">
                <div className="font-semibold text-gray-800">{selectedRunSummary.title}</div>
                <div className="mt-1 flex items-center justify-between">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(selectedRunSummary.status)}`}>
                    {statusLabel(selectedRunSummary.status)}
                  </span>
                  <span className="font-mono text-[10px] text-gray-500">{selectedRunSummary.runId.slice(0, 12)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-blue-200 bg-white p-3 text-xs text-blue-700">
                {tx('创建或选择一个运行来查看 ToT 工作区。', 'Create or select a run to inspect the ToT workspace.')}
              </div>
            )}

            {detail && (
              <div className="mt-3 rounded-md border border-blue-200 bg-white p-2 text-[11px] text-gray-600">
                {tx('树节点', 'tree nodes')}: {detail.totTree.length} | {tx('事件', 'events')}: {(detail.events || []).length} | {tx('状态', 'status')}: {statusLabel(detail.status)}
              </div>
            )}
          </div>
          </div>
        ) : (
          <div className="agentic-ribbon mt-4 rounded-2xl border border-slate-200/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-800">{tx('规范摘要', 'Spec Summary')}</div>
              <button
                type="button"
                onClick={() => setShowSpecWorkspace(true)}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {tx('编辑完整规范', 'Edit Full Spec')}
              </button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{tx('标题', 'Title')}</div>
                <div className="mt-1 truncate font-medium">{idea.title}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{tx('环境', 'Environment')}</div>
                <div className="mt-1 truncate font-medium">{idea.environment}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{tx('预算', 'Budget')}</div>
                <div className="mt-1 font-medium">{idea.budget.gpuHours} GPUh / {idea.budget.wallclockMinutes} min</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{tx('执行', 'Execution')}</div>
                <div className="mt-1 font-medium">{idea.executionMode || 'offline_stub'}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{tx('选中运行', 'Selected Run')}</div>
                <div className="mt-1 truncate font-medium">{selectedRunSummary ? selectedRunSummary.title : tx('无', 'None')}</div>
              </div>
            </div>
          </div>
        )}

        {validationText && <pre className="mt-3 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-200">{validationText}</pre>}
        </>
        )}
      </div>

      {!isTreeFirst && workspaceDensity === 'full' && showAgenticGuide && (
        <section className="agentic-ribbon rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-800">{tx('如何阅读 Agentic Lab', 'How To Read Agentic Lab')}</div>
              <div className="mt-1 text-xs text-slate-500">
                {tx('左侧是 ToT 策略图，中间是证据与时间线，右侧是 Agent 决策与审批。', 'Left = ToT strategy graph, Middle = evidence and timeline, Right = agent decisions and approvals.')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAgenticGuide(false)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {tx('隐藏说明', 'Hide Guide')}
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {workflowStages.map(stage => (
              <div key={stage.key} className={`rounded-lg border px-2.5 py-2 text-xs ${stage.tone}`}>
                <div className="text-[10px] uppercase tracking-wide">{stage.label}</div>
                <div className="mt-1 font-semibold">{stage.hint}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      {!isTreeFirst && workspaceDensity === 'full' && !showAgenticGuide && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowAgenticGuide(true)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {tx('显示说明', 'Show Guide')}
          </button>
        </div>
      )}
      {!isTreeFirst && workspaceDensity === 'full' && showQuickStart && (
        <section className="agentic-ribbon rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-800">{t('agentic.quickstart.title', 'Agentic-Lab Quick Start (run in order)')}</div>
              <div className="mt-1 text-xs text-slate-500">{t('agentic.quickstart.subtitle', 'Start here if this page is unclear. Each step maps to a button.')}</div>
            </div>
            <button
              type="button"
              onClick={() => setShowQuickStart(false)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {tx('隐藏', 'Hide')}
            </button>
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <div className="min-w-0">
              {nextQuickStep ? (
                <span className="block truncate">
                  {t('agentic.quickstart.next', 'Recommended next')}: {nextQuickStep.title} - {nextQuickStep.hint}
                </span>
              ) : (
                <span>{t('agentic.quickstart.done', 'Current run already completed the full chain. Continue branching or export audit replay.')}</span>
              )}
            </div>
            {nextQuickStep && (
              <button
                type="button"
                onClick={() => runQuickStartStep(nextQuickStep.id)}
                disabled={Boolean(busy)}
                className="rounded border border-blue-300 bg-white px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('agentic.quickstart.runNext', 'Run Next Step')}
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {quickStartSteps.map(step => (
              <div
                key={step.id}
                className={`agentic-step-card rounded-lg border px-3 py-2 text-xs ${step.done ? 'is-done border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 break-words font-semibold leading-tight text-slate-800">{step.title}</div>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {step.done ? tx('已完成', 'Done') : tx('待处理', 'Pending')}
                  </span>
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-slate-600">{step.hint}</div>
                <div className="mt-2">
                  {step.id === 'spec' && (
                    <button onClick={() => runQuickStartStep(step.id)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">{tx('校验', 'Validate')}</button>
                  )}
                  {step.id === 'run' && (
                    <button onClick={() => runQuickStartStep(step.id)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">{tx('创建运行', 'Create Run')}</button>
                  )}
                  {step.id === 'execute' && (
                    <button onClick={() => runQuickStartStep(step.id)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">{tx('执行全部', 'Execute All')}</button>
                  )}
                  {step.id === 'approve' && (
                    <button onClick={() => runQuickStartStep(step.id)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">{tx('审批待处理', 'Approve Pending')}</button>
                  )}
                  {step.id === 'matrix' && (
                    <button onClick={() => runQuickStartStep(step.id)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">{tx('生成矩阵', 'Generate Matrix')}</button>
                  )}
                  {step.id === 'repro' && (
                    <button onClick={() => runQuickStartStep(step.id)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">{tx('导出复现包', 'Export Repro')}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {!isTreeFirst && workspaceDensity === 'full' && !showQuickStart && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowQuickStart(true)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {tx('显示快速开始', 'Show QuickStart')}
          </button>
        </div>
      )}
      {!isTreeFirst && workspaceDensity === 'focused' && (
        <section className="agentic-ribbon rounded-2xl border border-slate-200 p-3 shadow-sm">
          <div className="grid gap-2 md:grid-cols-[1.2fr_1fr_auto]">
            <div>
              <div className="text-sm font-semibold text-slate-800">{tx('ToT 是什么？', 'What is ToT?')}</div>
              <div className="mt-1 text-xs text-slate-600">
                {tx(
                  'ToT（思维树）把研究过程拆成可回放的节点：假设 -> 计划 -> 证据 -> 下一步。',
                  'ToT (Tree of Thought) breaks research into replayable nodes: hypothesis -> plan -> evidence -> next action.',
                )}
              </div>
            </div>
            <div className="text-xs text-slate-600">
              <div>{tx('左：策略树与分支', 'Left: strategy tree and branches')}</div>
              <div>{tx('中：节点证据与时间线', 'Middle: node evidence and timeline')}</div>
              <div>{tx('右：Agent 决策/审批/审计', 'Right: agent decisions / approvals / audit')}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              {nextQuickStep && (
                <button
                  type="button"
                  onClick={() => runQuickStartStep(nextQuickStep.id)}
                  disabled={Boolean(busy)}
                  className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {tx('执行下一步', 'Run Next')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setWorkspaceDensity('full')}
                className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
              >
                {tx('打开完整视图', 'Open Full View')}
              </button>
            </div>
          </div>
        </section>
      )}

      {!isTreeFirst && (
      <div className="agentic-ribbon flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 shadow-sm">
        <div className="text-xs text-slate-500">
          {tx('布局控制：在树图探索与证据检查之间切换关注重点。', 'Layout controls: optimize your focus between tree exploration and evidence inspection.')}
          {uxMode === 'guided' && <span className="ml-1 text-blue-700">{tx('引导模式只显示核心控件。', 'Guided mode keeps only core controls visible.')}</span>}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setLayoutMode('balanced')}
            className={`rounded-md px-2 py-1 text-[11px] font-medium ${
              layoutMode === 'balanced' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {tx('均衡', 'Balanced')}
          </button>
          <button
            type="button"
            onClick={() => setLayoutMode('focus_tree')}
            className={`rounded-md px-2 py-1 text-[11px] font-medium ${
              layoutMode === 'focus_tree' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {tx('树图优先', 'Tree Focus')}
          </button>
          <button
            type="button"
            onClick={() => setLayoutMode('focus_evidence')}
            className={`rounded-md px-2 py-1 text-[11px] font-medium ${
              layoutMode === 'focus_evidence' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {tx('证据优先', 'Evidence Focus')}
          </button>
        </div>
      </div>
      )}

      <div className="grid gap-4 xl:grid-cols-12">
        <aside className={`${leftColClass} agentic-pane agentic-pane-tree rounded-2xl border border-slate-200 p-3 shadow-sm`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">{tx('ToT 决策树', 'ToT Decision Tree')}</h2>
            <button
              onClick={handleAddBranch}
              disabled={!detail || !selectedNode}
              className="text-xs text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="mr-1 inline h-3 w-3" />{tx('分支', 'Branch')}
            </button>
          </div>
          <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Search className="h-3 w-3" />
              <input
                value={nodeQuery}
                onChange={e => setNodeQuery(e.target.value)}
                placeholder={tx('搜索节点...', 'Search nodes...')}
                className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>
          <div className="mb-2 flex items-center justify-between text-[11px] text-gray-500">
            <span>{visibleNodes.length}/{filteredNodes.length}/{sortedNodes.length} {tx('节点', 'nodes')}</span>
            {isFocusedWorkspace ? (
              <button type="button" onClick={() => setCompactTree(prev => !prev)} className="text-blue-600 hover:text-blue-700">
                {compactTree ? tx('展开节点卡片', 'Expand Cards') : tx('紧凑节点卡片', 'Compact Cards')}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={collapseAllBranches}
                  className="text-[10px] text-slate-500 hover:text-slate-700"
                >
                  {tx('折叠', 'Collapse')}
                </button>
                <button
                  type="button"
                  onClick={expandAllBranches}
                  className="text-[10px] text-slate-500 hover:text-slate-700"
                >
                  {tx('展开', 'Expand')}
                </button>
                <button type="button" onClick={() => setCompactTree(prev => !prev)} className="text-blue-600 hover:text-blue-700">
                  {compactTree ? tx('展开节点卡片', 'Expand Cards') : tx('紧凑节点卡片', 'Compact Cards')}
                </button>
              </div>
            )}
          </div>
          {isFocusedWorkspace && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
              <span className="font-semibold text-slate-700">{tx('读图提示', 'Legend')}</span>
              <span>{tx('L/M/H = 风险等级', 'L/M/H = risk level')}</span>
              <span>{tx('双击节点可折叠分支', 'double-click node to fold branch')}</span>
            </div>
          )}
          {uxMode === 'expert' && !isFocusedWorkspace && (
            <div className="mb-2 grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setShowTreeControls(prev => !prev)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
              >
                {showTreeControls ? tx('收起控件', 'Hide Controls') : tx('显示控件', 'Show Controls')}
              </button>
              <button
                type="button"
                onClick={() => setShowTreeMiniMap(prev => !prev)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
              >
                {showTreeMiniMap ? tx('隐藏小地图', 'Hide Minimap') : tx('显示小地图', 'Show Minimap')}
              </button>
            </div>
          )}
          {!isFocusedWorkspace && showTreeControls && (
            <>
              <label className="mb-2 flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600">
                <span>{tx('显示成功节点', 'Show succeeded')}</span>
                <input
                  type="checkbox"
                  checked={showSucceededNodes}
                  onChange={e => setShowSucceededNodes(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
              </label>
              <div className="mb-2 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600">
                <div className="mb-1 flex items-center justify-between">
                  <span>{tx('图缩放', 'Graph zoom')}</span>
                  <span>{graphZoomPct}%</span>
                </div>
                <input
                  type="range"
                  min={70}
                  max={150}
                  step={5}
                  value={graphZoomPct}
                  onChange={e => setGraphZoomPct(Number(e.target.value || 100))}
                  className="w-full accent-blue-600"
                />
                <div className="mt-1.5 grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={fitGraphToViewport}
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                  >
                    {tx('适配视图', 'Fit View')}
                  </button>
                  <button
                    type="button"
                    onClick={() => centerNodeInViewport(selectedNodeId, 'smooth')}
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                  >
                    {tx('聚焦节点', 'Center Node')}
                  </button>
                </div>
              </div>
              <div className="mb-2 grid gap-1">
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600">
                  <span>{tx('动态图效', 'Graph motion')}
                  </span>
                  <input
                    type="checkbox"
                    checked={graphMotionEnabled}
                    onChange={e => setGraphMotionEnabled(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600">
                  <span>{tx('自动居中', 'Auto-center')}</span>
                  <input
                    type="checkbox"
                    checked={graphAutoCenter}
                    onChange={e => setGraphAutoCenter(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                </label>
              </div>
            </>
          )}
          <div ref={graphViewportRef} className="agentic-tree-canvas max-h-[34rem] overflow-auto rounded-xl border border-slate-200">
            {visibleNodes.length === 0 ? (
              isTreeFirst && !detail ? (
                <div className="p-4">
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-slate-800">{tx('Root Idea 输入节点', 'Root Idea Input Node')}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      {tx(
                        '在这里输入研究目标，生成第一层 ToT 计划树。',
                        'Type your research objective here to generate the first ToT planning tree.',
                      )}
                    </div>
                    <input
                      value={topInputValue}
                      onChange={e => setTopInputValue(e.target.value)}
                      onFocus={() => setTopInputMode('idea')}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleTopIdeaValidate();
                        }
                      }}
                      placeholder={tx('例如：在 2 GPUh 内提升 win-rate 到 0.62', 'e.g. Lift win-rate to 0.62 under 2 GPUh budget')}
                      className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-300"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleTopIdeaValidate}
                        className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
                      >
                        {tx('生成规范草案', 'Draft Spec')}
                      </button>
                      <button
                        type="button"
                        onClick={handleTopIdeaCreateRun}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        {tx('创建 Root 运行', 'Create Root Run')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSurfaceMode('classic');
                          setShowSpecWorkspace(true);
                          setShowAdvancedConfig(true);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {tx('打开高级配置', 'Open Advanced Config')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 text-xs text-slate-500">{tx('没有匹配当前过滤条件的节点。', 'No nodes match current filter.')}</div>
              )
            ) : (
              <svg
                width={Math.round((totGraph.width * graphZoomPct) / 100)}
                height={Math.round((totGraph.height * graphZoomPct) / 100)}
                viewBox={`0 0 ${totGraph.width} ${totGraph.height}`}
                className="min-h-[20rem]"
              >
                <defs>
                  <pattern id="totGrid" width="28" height="28" patternUnits="userSpaceOnUse">
                    <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#e2e8f0" strokeOpacity="0.46" strokeWidth="1" />
                  </pattern>
                  <linearGradient id="totEdgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.42" />
                    <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.2" />
                  </linearGradient>
                  <filter id="totNodeShadow" x="-18%" y="-18%" width="136%" height="136%">
                    <feDropShadow dx="0" dy="6" stdDeviation="4.4" floodColor="#0f172a" floodOpacity="0.12" />
                  </filter>
                  <filter id="totNodeGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#3b82f6" floodOpacity="0.26" />
                  </filter>
                </defs>
                <rect x={0} y={0} width={totGraph.width} height={totGraph.height} fill="url(#totGrid)" opacity={0.55} />
                {totGraph.edges.map(edge => {
                  const from = totGraph.layout.get(edge.from);
                  const to = totGraph.layout.get(edge.to);
                  if (!from || !to) return null;
                  const highlighted = selectedPathSet.has(edge.from) && selectedPathSet.has(edge.to);
                  const fromNode = visibleNodeMap.get(edge.from);
                  const toNode = visibleNodeMap.get(edge.to);
                  const runningEdge = String(fromNode?.status || '').toUpperCase() === 'RUNNING' || String(toNode?.status || '').toUpperCase() === 'RUNNING';
                  const startX = from.x + totGraph.cardWidth;
                  const endX = to.x;
                  const path = `M ${startX} ${from.y} C ${startX + 56} ${from.y}, ${endX - 56} ${to.y}, ${endX} ${to.y}`;
                  return (
                    <path
                      key={`${edge.from}-${edge.to}`}
                      d={path}
                      fill="none"
                      stroke={highlighted ? '#3b82f6' : 'url(#totEdgeGrad)'}
                      strokeWidth={highlighted ? 2.1 : 1.7}
                      strokeOpacity={highlighted ? 0.95 : 0.72}
                      strokeDasharray={runningEdge ? '4 4' : undefined}
                      strokeDashoffset={graphMotionEnabled && runningEdge ? -2 : 0}
                      style={{
                        transition: 'stroke 220ms ease, stroke-width 220ms ease, stroke-opacity 220ms ease, stroke-dashoffset 220ms linear',
                      }}
                    >
                      {graphMotionEnabled && highlighted && (
                        <animate attributeName="stroke-opacity" values="0.55;1;0.55" dur="1.7s" repeatCount="indefinite" />
                      )}
                      {graphMotionEnabled && runningEdge && (
                        <animate attributeName="stroke-dashoffset" values="0;-16" dur="1.2s" repeatCount="indefinite" />
                      )}
                    </path>
                  );
                })}
                {visibleNodes.map(({ node }) => {
                  const point = totGraph.layout.get(node.nodeId);
                  if (!point) return null;
                  const selected = selectedNodeId === node.nodeId;
                  const inSelectedPath = selectedPathSet.has(node.nodeId);
                  const collapsed = Boolean(collapsedNodeIds[node.nodeId]);
                  const childCount = childCountByNode.get(node.nodeId) || 0;
                  const hiddenCount = collapsedHiddenCount.get(node.nodeId) || 0;
                  const titleLines = splitLabelLines(node.title, compactTree ? 17 : 21, compactTree ? 2 : 3);
                  const nodeIdLabel = node.nodeId.length > 10 ? `${node.nodeId.slice(0, 9)}...` : node.nodeId;
                  const riskLabel = String(node.risk || 'low').toLowerCase();
                  const riskBadge = riskLabel === 'high' ? 'H' : riskLabel === 'medium' ? 'M' : 'L';
                  const statusRaw = String(node.status || '-').toLowerCase();
                  const statusText = statusRaw.length > 7 ? `${statusRaw.slice(0, 6)}.` : statusRaw;
                  const titleStartY = compactTree ? 30 : 34;
                  const titleLineStep = compactTree ? 11.2 : 12;
                  const metaY = totGraph.cardHeight - 11;
                  const halfHeight = totGraph.cardHeight / 2;
                  const normalizedStatus = String(node.status || '').toUpperCase();
                  const isRunning = normalizedStatus === 'RUNNING';
                  const baseFill = normalizedStatus === 'FAILED'
                    ? 'rgba(255, 241, 242, 0.95)'
                    : normalizedStatus === 'BLOCKED'
                    ? 'rgba(255, 251, 235, 0.95)'
                    : normalizedStatus === 'SUCCEEDED'
                    ? 'rgba(240, 253, 244, 0.95)'
                    : 'rgba(248, 250, 252, 0.96)';
                  const strokeColor = selected
                    ? 'rgba(59,130,246,0.9)'
                    : inSelectedPath
                    ? 'rgba(59,130,246,0.55)'
                    : 'rgba(203,213,225,0.92)';
                  return (
                    <g
                      key={`graph-${node.nodeId}`}
                      transform={`translate(${point.x}, ${point.y - halfHeight})`}
                      className="cursor-pointer"
                      onClick={() => setSelectedNodeId(node.nodeId)}
                      onDoubleClick={() => {
                        if (childCount > 0) toggleNodeCollapsed(node.nodeId);
                      }}
                    >
                      <title>{`${node.nodeId} · ${node.title} · ${statusLabel(String(node.status || '-'))}`}</title>
                      <rect
                        width={totGraph.cardWidth}
                        height={totGraph.cardHeight}
                        rx={12}
                        fill={selected ? 'rgba(59,130,246,0.14)' : baseFill}
                        stroke={strokeColor}
                        strokeWidth={selected ? 1.8 : 1.2}
                        filter={selected ? 'url(#totNodeGlow)' : 'url(#totNodeShadow)'}
                        style={{ transition: 'all 240ms ease' }}
                      />
                      {isRunning && graphMotionEnabled && (
                        <circle cx={totGraph.cardWidth - 12} cy={12} r={3.4} fill="#3b82f6" opacity={0.75}>
                          <animate attributeName="r" values="3.4;5.6;3.4" dur="1.35s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.75;0.22;0.75" dur="1.35s" repeatCount="indefinite" />
                        </circle>
                      )}
                      <circle cx={10} cy={12} r={3.5} fill={statusDotColor(node.status)} />
                      <text x={18} y={15} fontSize={9.5} fontWeight={700} fill="#334155">{nodeIdLabel}</text>
                      <text x={18} y={titleStartY} fontSize={10.2} fontWeight={600} fill="#0f172a">
                        {titleLines.map((line, idx) => (
                          <tspan key={`${node.nodeId}-title-${idx}`} x={18} dy={idx === 0 ? 0 : titleLineStep}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                      <text x={18} y={metaY} fontSize={9.4} fill="#64748b">{riskBadge} {tx('风险', 'risk')}</text>
                      <text x={totGraph.cardWidth - 44} y={metaY} fontSize={9.4} fill="#475569">{statusText}</text>
                      {childCount > 0 && (
                        <g
                          transform={`translate(${totGraph.cardWidth - 17}, ${totGraph.cardHeight - 14})`}
                          onClick={event => {
                            event.stopPropagation();
                            toggleNodeCollapsed(node.nodeId);
                          }}
                        >
                          <rect width={13} height={10} rx={4} fill={collapsed ? 'rgba(59,130,246,0.2)' : 'rgba(226,232,240,0.8)'} />
                          <text x={6.5} y={7.5} textAnchor="middle" fontSize={7} fontWeight={700} fill="#1e293b">
                            {collapsed ? '+' : '-'}
                          </text>
                        </g>
                      )}
                      {collapsed && hiddenCount > 0 && (
                        <text x={totGraph.cardWidth - 62} y={12} fontSize={8.5} fill="#2563eb">+{hiddenCount}</text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
          {showTreeMiniMap && visibleNodes.length > 0 && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                <span>{tx('树图小地图', 'Tree Minimap')}</span>
                <span>{tx('双击节点：折叠', 'dbl-click node: fold')}</span>
              </div>
              <svg
                width={miniMapLayout.width}
                height={miniMapLayout.height}
                viewBox={`0 0 ${miniMapLayout.width} ${miniMapLayout.height}`}
                className="w-full cursor-crosshair rounded-md border border-slate-200 bg-white"
                onClick={handleMiniMapClick}
              >
                {totGraph.edges.map(edge => {
                  const from = totGraph.layout.get(edge.from);
                  const to = totGraph.layout.get(edge.to);
                  if (!from || !to) return null;
                  const x1 = miniMapLayout.offsetX + (from.x + totGraph.cardWidth) * miniMapLayout.scale;
                  const y1 = miniMapLayout.offsetY + from.y * miniMapLayout.scale;
                  const x2 = miniMapLayout.offsetX + to.x * miniMapLayout.scale;
                  const y2 = miniMapLayout.offsetY + to.y * miniMapLayout.scale;
                  return <line key={`minimap-edge-${edge.from}-${edge.to}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#cbd5e1" strokeWidth={1} />;
                })}
                {visibleNodes.map(({ node }) => {
                  const point = totGraph.layout.get(node.nodeId);
                  if (!point) return null;
                  const x = miniMapLayout.offsetX + point.x * miniMapLayout.scale;
                  const y = miniMapLayout.offsetY + (point.y - totGraph.cardHeight / 2) * miniMapLayout.scale;
                  const w = Math.max(2, totGraph.cardWidth * miniMapLayout.scale);
                  const h = Math.max(2, totGraph.cardHeight * miniMapLayout.scale);
                  const selected = node.nodeId === selectedNodeId;
                  return (
                    <rect
                      key={`minimap-node-${node.nodeId}`}
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      rx={2}
                      fill={selected ? 'rgba(59,130,246,0.35)' : 'rgba(148,163,184,0.3)'}
                      stroke={selected ? '#2563eb' : '#94a3b8'}
                      strokeWidth={selected ? 1.2 : 0.8}
                    />
                  );
                })}
                <rect
                  x={miniMapLayout.offsetX + graphViewportBox.x * miniMapLayout.scale}
                  y={miniMapLayout.offsetY + graphViewportBox.y * miniMapLayout.scale}
                  width={Math.max(6, graphViewportBox.width * miniMapLayout.scale)}
                  height={Math.max(6, graphViewportBox.height * miniMapLayout.scale)}
                  fill="rgba(37,99,235,0.08)"
                  stroke="#2563eb"
                  strokeWidth={1}
                />
              </svg>
            </div>
          )}
          {uxMode === 'expert' && !isFocusedWorkspace && collapsedBranchSummaries.length > 0 && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                <span>{tx('已折叠分支', 'Collapsed Branches')}</span>
                <span>{collapsedBranchSummaries.length}</span>
              </div>
              <div className="space-y-1">
                {collapsedBranchSummaries.map(item => (
                  <button
                    key={`collapsed-${item.nodeId}`}
                    type="button"
                    onClick={() => expandCollapsedBranch(item.nodeId)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{item.nodeId}</span>
                      <span className={`rounded px-1 py-0.5 text-[10px] font-semibold ${statusColor(item.status)}`}>{statusLabel(item.status)}</span>
                    </div>
                    <div className="mt-0.5 break-words text-[10px] text-slate-500">{item.title}</div>
                    <div className="mt-0.5 text-[10px] text-blue-700">{tx('隐藏后代', 'hidden descendants')}: {item.hidden}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className={`${centerColClass} agentic-pane agentic-pane-evidence rounded-2xl border border-gray-200 bg-white p-4 shadow-sm`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">{tx('节点证据', 'Node Evidence')}</h2>
            <div className="flex flex-wrap gap-2">
              {isTreeFirst && (
                <button
                  type="button"
                  onClick={() => setShowContextPanel(prev => !prev)}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    showContextPanel
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {showContextPanel ? tx('隐藏右侧面板', 'Hide Right Panel') : tx('打开右侧面板', 'Open Right Panel')}
                </button>
              )}
              <button onClick={() => handleExecute('next')} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                <Play className="mr-1 inline h-3 w-3" />{tx('单步', 'Step')}
              </button>
              <button onClick={() => handleExecute('all')} className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">
                <WandSparkles className="mr-1 inline h-3 w-3" />{tx('执行全部', 'Execute All')}
              </button>
              <button onClick={handleRecover} className="rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50">
                {tx('恢复', 'Recover')}
              </button>
              <button onClick={handleDeleteNode} className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
                <Trash2 className="mr-1 inline h-3 w-3" />{tx('删除节点', 'Delete Node')}
              </button>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span>{tx('执行进度', 'Execution Progress')}</span>
              <span>{completionRate}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500"
                style={{ width: `${Math.max(2, completionRate)}%` }}
              />
            </div>
            <div className="mt-2 grid grid-cols-6 gap-1 text-[10px] text-slate-600">
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1">T {statusCounts.total}</div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1">P {statusCounts.pending}</div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1">R {statusCounts.running}</div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1">S {statusCounts.succeeded}</div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1">F {statusCounts.failed}</div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1">B {statusCounts.blocked}</div>
            </div>
          </div>

          {!detail || !selectedNode ? (
            <div className="mt-5 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{tx('请选择或创建运行以查看证据。', 'Select or create a run to inspect evidence.')}</div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 break-words font-semibold text-gray-900">{selectedNode.nodeId} · {selectedNode.title}</div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${riskColor(selectedNode.risk)}`}>{tx('风险', 'risk')}: {selectedNode.risk}</span>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${statusColor(selectedNode.status)}`}>{statusLabel(selectedNode.status)}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] font-semibold text-slate-500">{tx('路径', 'Path')}:</span>
                  {selectedNodePath.map((node, idx) => (
                    <React.Fragment key={`path-${node.nodeId}`}>
                      {idx > 0 && <span className="text-[10px] text-slate-400">/</span>}
                      <button
                        type="button"
                        onClick={() => setSelectedNodeId(node.nodeId)}
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${
                          node.nodeId === selectedNode.nodeId
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {node.nodeId}
                      </button>
                    </React.Fragment>
                  ))}
                  <div className="flex w-full items-center justify-end gap-1 sm:ml-auto sm:w-auto">
                    <button
                      type="button"
                      disabled={!prevSiblingId}
                      onClick={() => prevSiblingId && setSelectedNodeId(prevSiblingId)}
                      className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      {tx('上一个同级', 'Prev Sibling')}
                    </button>
                    <button
                      type="button"
                      disabled={!nextSiblingId}
                      onClick={() => nextSiblingId && setSelectedNodeId(nextSiblingId)}
                      className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      {tx('下一个同级', 'Next Sibling')}
                    </button>
                  </div>
                </div>
                {selectedSubtreeSummary && (
                  <div className="mt-2 grid gap-1 md:grid-cols-6">
                    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
                      {tx('子树节点', 'subtree nodes')}
                      <div className="text-xs font-semibold text-slate-800">{selectedSubtreeSummary.nodeCount}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
                      {tx('深度', 'depth')}
                      <div className="text-xs font-semibold text-slate-800">{selectedSubtreeSummary.depth}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
                      {tx('预算 GPU', 'budget gpu')}
                      <div className="text-xs font-semibold text-slate-800">{selectedSubtreeSummary.budgetGpu.toFixed(2)}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
                      {tx('预算分钟', 'budget min')}
                      <div className="text-xs font-semibold text-slate-800">{selectedSubtreeSummary.budgetMinutes.toFixed(1)}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
                      {tx('目标胜率均值', 'avg target win')}
                      <div className="text-xs font-semibold text-slate-800">
                        {selectedSubtreeSummary.avgWinRate === null ? '-' : `${(selectedSubtreeSummary.avgWinRate * 100).toFixed(1)}%`}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
                      {tx('风险指数', 'risk index')}
                      <div className="text-xs font-semibold text-slate-800">{selectedSubtreeSummary.riskIndex.toFixed(2)}</div>
                    </div>
                  </div>
                )}
                {subtreeTimelineView && (
                  <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                    <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                      <span>{tx('子树 KPI 趋势', 'Subtree KPI Trend')}</span>
                      <span>{tx('游标', 'cursor')} {Math.min(timelineRows.length, timelineCursor + 1)}/{timelineRows.length}</span>
                    </div>
                    <svg viewBox={`0 0 ${subtreeTimelineView.width} ${subtreeTimelineView.height}`} className="w-full rounded bg-slate-50">
                      <line
                        x1={subtreeTimelineView.padX}
                        x2={subtreeTimelineView.width - subtreeTimelineView.padX}
                        y1={subtreeTimelineView.height - subtreeTimelineView.padY}
                        y2={subtreeTimelineView.height - subtreeTimelineView.padY}
                        stroke="#cbd5e1"
                        strokeWidth={1}
                      />
                      <path d={subtreeTimelineView.costPath} fill="none" stroke="#2563eb" strokeWidth={2} />
                      <path d={subtreeTimelineView.successPath} fill="none" stroke="#059669" strokeWidth={2} strokeDasharray="3 3" />
                      <line
                        x1={subtreeTimelineView.cursorX}
                        x2={subtreeTimelineView.cursorX}
                        y1={subtreeTimelineView.padY}
                        y2={subtreeTimelineView.height - subtreeTimelineView.padY}
                        stroke="#0f172a"
                        strokeOpacity={0.35}
                        strokeWidth={1}
                      />
                    </svg>
                    <div className="mt-1 grid gap-1 text-[10px] text-slate-600 sm:grid-cols-3">
                      <div>{tx('成本', 'cost')}: {subtreeTimelineView.snapshot.cumulativeCost.toFixed(3)} / {tx('上限', 'max')} {subtreeTimelineView.maxCost.toFixed(3)}</div>
                      <div>{tx('成功率', 'success-rate')}: {(subtreeTimelineView.snapshot.successRate * 100).toFixed(1)}%</div>
                      <div>{tx('活动', 'activity')}: {subtreeTimelineView.snapshot.activity} {tx('事件', 'events')}</div>
                    </div>
                  </div>
                )}
                <p className="mt-2 text-xs text-gray-600"><strong>{tx('假设', 'Hypothesis')}:</strong> {selectedNode.hypothesis}</p>
                <p className="mt-1 text-xs text-gray-600"><strong>{tx('计划', 'Plan')}:</strong> {selectedNode.executionPlan}</p>
              </div>

              <div className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-gray-500">{tx('执行时间线回放', 'Execution Timeline Replay')}</div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span>{timelineRows.length === 0 ? '0/0' : `${Math.min(timelineRows.length, timelineCursor + 1)}/${timelineRows.length}`}</span>
                    <button
                      type="button"
                      disabled={timelineRows.length === 0}
                      onClick={() => setTimelineCursor(prev => Math.max(0, prev - 1))}
                      className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {tx('上一步', 'Prev')}
                    </button>
                    <button
                      type="button"
                      disabled={timelineRows.length === 0}
                      onClick={() => {
                        if (!timelinePlaying && timelineRows.length > 0 && timelineCursor >= timelineRows.length - 1) {
                          setTimelineCursor(0);
                        }
                        setTimelinePlaying(prev => !prev);
                      }}
                      className={`rounded border px-1.5 py-0.5 text-[10px] ${
                        timelinePlaying
                          ? 'border-blue-300 bg-blue-50 text-blue-700'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      } disabled:opacity-40`}
                    >
                      {timelinePlaying ? tx('暂停', 'Pause') : tx('播放', 'Play')}
                    </button>
                    <button
                      type="button"
                      disabled={timelineRows.length === 0}
                      onClick={() => setTimelineCursor(prev => Math.min(Math.max(0, timelineRows.length - 1), prev + 1))}
                      className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {tx('下一步', 'Next')}
                    </button>
                  </div>
                </div>
                {timelineRows.length === 0 ? (
                  <div className="text-xs text-gray-500">{tx('暂无时间线事件。', 'No timeline events yet.')}</div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                      <label className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600">
                        <span className="mr-1 text-slate-500">{tx('速度', 'Speed')}</span>
                        <select
                          value={timelineReplayMs}
                          onChange={e => setTimelineReplayMs(Number(e.target.value || 800))}
                          className="bg-transparent text-[11px] text-slate-700 outline-none"
                        >
                          <option value={1400}>0.5x</option>
                          <option value={800}>1x</option>
                          <option value={450}>2x</option>
                          <option value={240}>4x</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={timelineSyncNode}
                          onChange={e => setTimelineSyncNode(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300"
                        />
                        {tx('同步节点', 'Sync node')}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setTimelinePlaying(false);
                          setTimelineCursor(Math.max(0, timelineRows.length - 1));
                        }}
                        className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                      >
                        {tx('跳到最新', 'Jump Latest')}
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-400">{tx('快捷键：空格 播放/暂停 · [ / ] 步进 · F 适配 · C 居中', 'Shortcuts: Space Play/Pause · [ / ] Step · F Fit · C Center')}</div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, timelineRows.length - 1)}
                      value={Math.min(Math.max(timelineCursor, 0), Math.max(0, timelineRows.length - 1))}
                      onChange={e => setTimelineCursor(Number(e.target.value || 0))}
                      className="w-full accent-blue-600"
                    />
                    <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{tx('图例', 'Legend')}</div>
                          <div className="text-[10px] text-slate-400">{timelineRows.length} {tx('条', 'items')}</div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {timelineLegend.map(item => (
                            <span
                              key={`legend-${item.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600"
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${item.dotClass}`} />
                              <span>{item.label}</span>
                              <span className="text-slate-400">{item.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{tx('里程碑', 'Milestones')}</div>
                        <div className="flex max-w-full flex-wrap gap-1">
                          {timelineMilestones.length === 0 ? (
                            <span className="text-[10px] text-slate-400">{tx('暂无书签', 'No bookmarks')}</span>
                          ) : (
                            timelineMilestones.map(item => {
                              const active = item.index === timelineCursor;
                              const title = item.title.length > 18 ? `${item.title.slice(0, 17)}...` : item.title;
                              return (
                                <button
                                  key={`milestone-${item.key}`}
                                  type="button"
                                  onClick={() => {
                                    setTimelinePlaying(false);
                                    setTimelineCursor(item.index);
                                  }}
                                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
                                    active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                                  title={`${item.category.label} · ${item.title}`}
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${item.category.dotClass}`} />
                                  <span>{title}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-1 flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-700">{selectedTimelineRow?.title || '-'}</div>
                          <div className="text-[11px] text-slate-500">{formatTimestamp(selectedTimelineRow?.ts || '')}</div>
                        </div>
                        <div className="text-[11px] text-slate-600">{tx('节点', 'node')}: {selectedTimelineRow?.nodeId || '-'}</div>
                        <div className="text-[11px] text-slate-600">{tx('状态', 'status')}: {selectedTimelineRow?.status || '-'}</div>
                        {selectedTimelineRow && (
                          <div className="text-[11px] text-slate-600">{tx('类别', 'category')}: {timelineCategory(`${selectedTimelineRow.title} ${selectedTimelineRow.status}`).label}</div>
                        )}
                        {selectedTimelineRow && (
                          <div className="mt-1 text-[11px] text-slate-600">
                            {tx('成本', 'cost')}: {Number(selectedTimelineRow.cost || 0).toFixed(3)} | {tx('来源', 'source')}: {selectedTimelineRow.kind}
                          </div>
                        )}
                        {selectedTimelineRow?.message && <div className="mt-2 text-xs text-slate-700">{selectedTimelineRow.message}</div>}
                      </div>
                      <div className="max-h-44 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
                        {timelineRows.slice(Math.max(0, timelineCursor - 5), Math.min(timelineRows.length, timelineCursor + 5)).map(row => {
                          const active = selectedTimelineRow?.key === row.key;
                          return (
                            <button
                              key={row.key}
                              type="button"
                              onClick={() => {
                                const idx = timelineIndexByKey.get(row.key) ?? -1;
                                if (idx >= 0) setTimelineCursor(idx);
                              }}
                              className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                                active ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5">
                                  <span className={`h-1.5 w-1.5 rounded-full ${timelineTone(`${row.title} ${row.status}`)}`} />
                                  <span className="font-medium text-slate-700">{row.title}</span>
                                </span>
                                <span className="text-[10px] text-slate-500">{formatTimestamp(row.ts)}</span>
                              </div>
                              <div className="mt-0.5 text-[10px] text-slate-500">{row.nodeId} · {row.subtitle}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {comparedBranchNodes.length > 1 && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase text-gray-500">{tx('分支对比（同级节点）', 'Branch Compare (Sibling Nodes)')}</div>
                  <div className="space-y-1">
                    {comparedBranchNodes.map(item => {
                      const isSelected = item.node.nodeId === selectedNode.nodeId;
                      return (
                        <button
                          key={`cmp-${item.node.nodeId}`}
                          type="button"
                          onClick={() => setSelectedNodeId(item.node.nodeId)}
                          className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                            isSelected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-medium text-slate-800">{item.node.nodeId} · {item.node.title}</div>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(item.node.status)}`}>{statusLabel(item.node.status)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-600">
                            <span>{tx('目标胜率', 'targetWin')}: {item.expectedWin === null ? '-' : `${item.expectedWin}`}</span>
                            <span>gpu: {item.budgetGpu === null ? '-' : item.budgetGpu}</span>
                            <span>{tx('分钟', 'min')}: {item.budgetMinutes === null ? '-' : item.budgetMinutes}</span>
                            <span>{tx('风险', 'risk')}: {item.node.risk}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="text-xs font-semibold uppercase text-gray-500">{tx('预期指标', 'Expected Metrics')}</div>
                  <pre className="mt-2 overflow-auto text-xs text-gray-700">{toPrettyJson(selectedNode.expectedMetrics)}</pre>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="text-xs font-semibold uppercase text-gray-500">{tx('预算', 'Budget')}</div>
                  <pre className="mt-2 overflow-auto text-xs text-gray-700">{toPrettyJson(selectedNode.budget)}</pre>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs font-semibold uppercase text-gray-500">{tx('证据', 'Evidence')}</div>
                <pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-900 p-3 text-xs text-emerald-200">{toPrettyJson(selectedNode.evidence)}</pre>
              </div>

              {selectedNode.subAgents && selectedNode.subAgents.length > 0 && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase text-gray-500">{tx('Sub-Agent', 'Sub-Agents')}</div>
                  <div className="space-y-2">
                    {selectedNode.subAgents.map((item, idx) => {
                      const row = item as Record<string, unknown>;
                      return (
                        <div key={`${String(row.subAgentId || idx)}`} className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                          <div><strong>{String(row.subAgentId || `sub-${idx}`)}</strong> · {String(row.role || tx('子智能体', 'SubAgent'))}</div>
                          <div className="text-gray-500">{String(row.objective || '')}</div>
                          <div className="mt-1">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(String(row.status || 'PENDING'))}`}>
                              {statusLabel(String(row.status || 'PENDING'))}
                            </span>
                            {row.children && Array.isArray(row.children) && row.children.length > 0 && (
	                              <span className="ml-2 text-[10px] text-gray-500">{tx('子节点', 'Children')}: {(row.children as unknown[]).map(v => String(v)).join(', ')}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {matrixData && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase text-gray-500">{tx('联赛矩阵（点击单元格查看证据）', 'League Matrix (Click Cell For Evidence)')}</div>
                    <button onClick={handleMatrix} className="text-xs text-blue-600 hover:text-blue-700">{tx('重新生成', 'Regenerate')}</button>
                  </div>
                  <div className="overflow-auto rounded-lg border border-gray-200">
                    <table className="min-w-full border-collapse text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="border border-gray-200 px-2 py-1 text-left font-semibold text-gray-600">{tx('对阵', 'vs')}</th>
                          {matrixData.labels.map(label => (
                            <th key={`h-${label}`} className="border border-gray-200 px-2 py-1 text-left font-semibold text-gray-600">{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixData.labels.map(row => (
                          <tr key={`row-${row}`}>
                            <td className="border border-gray-200 bg-gray-50 px-2 py-1 font-semibold text-gray-600">{row}</td>
                            {matrixData.labels.map(col => {
                              const key = matrixCellKey(row, col);
                              const cell = matrixCellByKey.get(key);
                              const selected = selectedMatrixCell ? matrixCellKey(selectedMatrixCell.row, selectedMatrixCell.col) === key : false;
                              const winRate = cell ? cell.winRate : null;
                              const confidence = cell ? cell.confidence : 0;
                              return (
                                <td key={`cell-${key}`} className="border border-gray-200 p-0">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedMatrixCellKey(key)}
                                    className={`w-full px-2 py-1 text-left transition ${selected ? 'font-semibold text-slate-900' : 'text-gray-700 hover:bg-gray-50'}`}
                                    style={{
                                      background: matrixHeatColor(winRate),
                                      boxShadow: selected ? 'inset 0 0 0 1px rgba(37, 99, 235, 0.8)' : undefined,
                                    }}
                                  >
                                    <div className="text-[11px]">{cell ? `${(cell.winRate * 100).toFixed(1)}%` : '-'}</div>
                                    {cell && (
                                      <div className="mt-0.5 h-1 w-full rounded bg-white/70">
                                        <div className="h-full rounded bg-slate-700/70" style={{ width: `${Math.min(100, Math.max(0, confidence * 100))}%` }} />
                                      </div>
                                    )}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                    <span className="font-semibold uppercase tracking-wide">{tx('热力', 'Heat')}</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-400" />{tx('劣势侧', 'lose side')}</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />{tx('优势侧', 'win side')}</span>
                    <span className="inline-flex items-center gap-1"><span className="h-1 w-8 rounded bg-slate-700/70" />{tx('置信条', 'confidence bar')}</span>
                  </div>

                  {selectedMatrixCell && (
                    <div className="mt-3 grid gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 md:grid-cols-2">
                      <div><strong>{tx('对局', 'Match')}:</strong> {selectedMatrixCell.row} vs {selectedMatrixCell.col}</div>
                      <div><strong>{tx('判定', 'Verdict')}:</strong> {selectedMatrixCell.verdict}</div>
                      <div><strong>{tx('胜率', 'Win Rate')}:</strong> {(selectedMatrixCell.winRate * 100).toFixed(2)}%</div>
                      <div><strong>{tx('置信度', 'Confidence')}:</strong> {(selectedMatrixCell.confidence * 100).toFixed(2)}%</div>
                      <div><strong>{tx('日志', 'Log')}:</strong> {selectedMatrixCell.logUri}</div>
                      <div><strong>{tx('回放', 'Replay')}:</strong> {selectedMatrixCell.replayUri}</div>
                    </div>
                  )}

                  <div className="mt-2 text-[11px] text-gray-500">
                    {tx('排名', 'Ranking')}: {(matrixData.ranking || []).slice(0, 3).map(item => `${item.id}(${item.score.toFixed(1)})`).join(' · ')}
                  </div>
                </div>
              )}

              <div className={`rounded-lg border p-3 ${detail.contract.passRate < 95 ? 'border-rose-300 bg-rose-50' : 'border-emerald-300 bg-emerald-50'}`}>
                <div className="text-xs font-semibold uppercase text-gray-600">{tx('契约健康度', 'Contract Health')}</div>
                <div className="mt-1 text-sm font-medium text-gray-800">{tx('通过率', 'Pass Rate')}: {detail.contract.passRate.toFixed(2)}%</div>
                {detail.contract.missing.length > 0 && (
                  <div className="mt-2 text-xs text-rose-700">{tx('缺失项', 'Missing')}: {detail.contract.missing.join(', ')}</div>
                )}
              </div>
            </div>
          )}
        </section>

        {(!isTreeFirst || showContextPanel) && (
        <aside className={`${rightColClass} agentic-pane agentic-pane-agent rounded-2xl border border-slate-200 p-4 shadow-sm`}>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">{tx('Agent 面板', 'Agent Panel')}</h2>
              <div className="mt-0.5 text-[11px] text-slate-500">{rightPanelTabHint}</div>
            </div>
            <button onClick={handleExportRepro} className="text-xs text-blue-600 hover:text-blue-700">{tx('导出复现包', 'Export Repro')}</button>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-600">
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <span className="font-semibold text-slate-500">{tx('状态', 'status')}</span>
              <div className={`mt-0.5 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(String(detail?.status || '-'))}`}>
                {statusLabel(String(detail?.status || '-'))}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <span className="font-semibold text-slate-500">{tx('待审批', 'pending')}</span>
              <div className="mt-0.5 text-[11px] font-semibold text-slate-800">{pendingApprovals.length}</div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <span className="font-semibold text-slate-500">{tx('Sub-Agent', 'Sub-Agents')}</span>
              <div className="mt-0.5 text-[11px] font-semibold text-slate-800">{subAgentStats.total}</div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <span className="font-semibold text-slate-500">{tx('契约通过率', 'contract pass')}</span>
              <div className="mt-0.5 text-[11px] font-semibold text-slate-800">{detail ? `${detail.contract.passRate.toFixed(1)}%` : '-'}</div>
            </div>
          </div>
          {selectedNode && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] text-slate-600">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{tx('当前节点上下文', 'Current Node Context')}</div>
              <div className="grid grid-cols-2 gap-1">
                <div><span className="font-semibold text-slate-500">{tx('节点', 'node')}</span>: {selectedNode.nodeId}</div>
                <div><span className="font-semibold text-slate-500">{tx('深度', 'depth')}</span>: {Math.max(0, selectedNodePath.length - 1)}</div>
                <div><span className="font-semibold text-slate-500">{tx('状态', 'status')}</span>: {statusLabel(selectedNode.status)}</div>
                <div><span className="font-semibold text-slate-500">{tx('风险', 'risk')}</span>: {String(selectedNode.risk || '-')}</div>
              </div>
              <div className="mt-1 truncate text-[10px] text-slate-500">{selectedNode.title}</div>
            </div>
          )}
          <div className="agentic-tab-strip mb-3 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 p-1 sm:grid-cols-5">
            {rightPanelTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRightPanelTab(tab.id as RightPanelTab)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium leading-tight ${
                  rightPanelTab === tab.id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] font-semibold ${toneBadgeClass(tab.badgeTone || 'neutral', rightPanelTab === tab.id)}`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {rightPanelTab === 'dialogue' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">{tx('下一步建议', 'Next Suggestions')}</div>
                <div className="space-y-2 text-xs">
                  {selectedNode?.nextSuggestions?.map((suggestion, idx) => (
                    <div key={`${suggestion}-${idx}`} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-700">
                      {suggestion}
                    </div>
                  ))}
                  {!selectedNode?.nextSuggestions?.length && (
                    <div className="rounded-md border border-dashed border-slate-300 p-2 text-slate-500">{tx('暂无建议。', 'No suggestions yet.')}</div>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">{tx('快捷操作', 'Quick Actions')}</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleExecute('next')} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                    <Play className="mr-1 inline h-3 w-3" />{tx('节点单步执行', 'Step Node')}
                  </button>
                  <button onClick={handleMatrix} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                    {tx('生成矩阵', 'Generate Matrix')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {rightPanelTab === 'approvals' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase text-gray-500">
                  <span>{tx('审批', 'Approvals')}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={handleApproveAll} className="text-blue-600 hover:text-blue-700">{tx('全部通过', 'Approve all')}</button>
                    <button onClick={handleRejectAll} className="text-rose-600 hover:text-rose-700">{tx('全部拒绝', 'Reject all')}</button>
                    <button onClick={handleReopenAll} className="text-amber-600 hover:text-amber-700">{tx('重新打开', 'Reopen')}</button>
                  </div>
                </div>
                <div className={`mb-2 rounded-md border px-2 py-1.5 text-[11px] ${toneCardClass(approvalHealth.tone)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-semibold uppercase tracking-wide">{tx('审批健康度', 'Approval Health')}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${toneBadgeClass(approvalHealth.tone, true)}`}>
                      {approvalHealth.label}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] opacity-90">{approvalHealth.hint}</div>
                </div>
                <div className="agentic-kpi-grid mb-2">
                  {approvalKpiCards.map(card => (
                    <div key={`approval-kpi-${card.key}`} className={`agentic-kpi-card ${toneCardClass(card.tone)}`}>
                      <div className="agentic-kpi-label">{card.label}</div>
                      <div className="agentic-kpi-value">{card.value}</div>
                    </div>
                  ))}
                  <div className={`agentic-kpi-card ${toneCardClass('neutral')}`}>
                    <div className="agentic-kpi-label">{tx('总决策', 'Total')}</div>
                    <div className="agentic-kpi-value">{approvalDecisionTotal}</div>
                  </div>
                </div>
                <div className="mb-2 grid gap-2 md:grid-cols-[2fr_1fr]">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    {tx('审批执行者', 'Approval Actor')}
                    <select
                      value={selectedApprovalActorKey}
                      onChange={e => setSelectedApprovalActorKey(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                    >
                      {approvalActorOptions.map(option => {
                        const key = `${option.actorId}::${option.actorRole}`;
                        return (
                          <option key={key} value={key}>
                            {option.label}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                    <div><span className="font-semibold uppercase text-slate-500">{tx('严格模式', 'strictMode')}</span>: {String(approvalStrictMode)}</div>
	                    <div className="mt-0.5 break-all"><span className="font-semibold uppercase text-slate-500">{tx('执行者 ID', 'actorId')}</span>: {selectedApprovalActor.actorId}</div>
                    <div className="mt-0.5"><span className="font-semibold uppercase text-slate-500">{tx('角色', 'role')}</span>: {selectedApprovalActor.actorRole}</div>
                    <div className="mt-0.5 break-all">
                      <span className="font-semibold uppercase text-slate-500">{tx('允许', 'allow')}</span>: {(selectedApprovalActor.actionAllowlist || ['*']).join(', ')}
                    </div>
                    <div className="mt-0.5 break-all">
                      <span className="font-semibold uppercase text-slate-500">{tx('拒绝', 'deny')}</span>: {(selectedApprovalActor.actionDenylist || []).join(', ') || '-'}
                    </div>
                  </div>
                </div>
                {!selectedActorActionScopeOk && pendingApprovalActions.length > 0 && (
                  <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                    {tx('当前执行者不在部分待审批动作的权限范围内', 'Selected actor is out of scope for some pending actions')} ({pendingApprovalActions.join(', ')})。{tx('审批流程会自动选择兼容执行者。', 'Approval flow will auto-select a compatible actor.')}
                  </div>
                )}
                {pendingApprovalActions.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-1 text-[10px] text-amber-800">
                    <span className="font-semibold uppercase tracking-wide">{tx('动作', 'actions')}</span>
                    {pendingApprovalActions.map(action => (
                      <span key={`pending-action-${action}`} className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5">
                        {action}
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  value={approvalComment}
                  onChange={e => setApprovalComment(e.target.value)}
                  placeholder={tx('可选审批备注（审计轨迹）', 'Optional approval comment (audit trail)')}
                  className="mb-2 h-16 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                />
                {pendingApprovals.length === 0 ? (
                  <div className="text-xs text-emerald-700"><CheckCircle2 className="mr-1 inline h-3 w-3" />{tx('没有待审批项', 'No pending approvals')}</div>
                ) : (
                  <>
                    {visiblePendingApprovals.map(item => {
                    const row = item as Record<string, unknown>;
                    const requiredRoles = Array.isArray(row.requiredRoles)
                      ? row.requiredRoles
                      : (Array.isArray(row.required_roles) ? row.required_roles : []);
                    return (
                      <div key={String(item.id)} className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                        <ShieldAlert className="mr-1 inline h-3 w-3" /> {String(item.action)}
                        <div className="text-[11px] text-amber-700">
                          {tx('票数', 'votes')}: {Number(row.approvalVotes || row.approval_votes || 0)} / {Number(row.requiredApprovals || row.required_approvals || 1)}
                        </div>
	                        <div className="text-[11px] text-amber-700">{tx('角色', 'Roles')}: {requiredRoles.map(v => String(v)).join(', ') || '-'}</div>
                        <div className="text-[11px] text-amber-700">
                          {tx('角色需不同', 'distinctRoles')}: {String(row.requireDistinctRoles || row.require_distinct_roles || false)}
                          {' '}| {tx('过期时间', 'expiresAt')}: {String(row.expiresAt || row.expires_at || '-')}
                        </div>
                      </div>
                    );
                    })}
                    {isFocusedWorkspace && pendingApprovals.length > visiblePendingApprovals.length && (
                      <button
                        type="button"
                        onClick={() => setShowAllPendingApprovals(true)}
                        className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100"
                      >
                        {tx(
                          `显示剩余 ${pendingApprovals.length - visiblePendingApprovals.length} 条`,
                          `Show ${pendingApprovals.length - visiblePendingApprovals.length} more`,
                        )}
                      </button>
                    )}
                    {isFocusedWorkspace && showAllPendingApprovals && pendingApprovals.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setShowAllPendingApprovals(false)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                      >
                        {tx('收起待审批列表', 'Collapse pending list')}
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-gray-500">{tx('审批时间线', 'Approval Timeline')}</div>
                  <button
                    type="button"
                    onClick={() => setShowApprovalTimeline(prev => !prev)}
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                  >
                    {showApprovalTimeline ? tx('收起', 'Hide') : tx('展开', 'Expand')}
                  </button>
                </div>
                {(!isFocusedWorkspace || showApprovalTimeline) ? (
                  approvalHistory.length === 0 ? (
                    <div className="text-xs text-gray-500">{tx('暂无审批记录。', 'No approval records yet.')}</div>
                  ) : (
                    <div className="max-h-56 space-y-2 overflow-auto text-xs">
                      {approvalHistory.map((item, idx) => {
                        const row = item as Record<string, unknown>;
                        const status = String(row.status || 'PENDING');
                        const action = String(row.action || '');
                        const reason = String(row.reason || '');
                        const decidedBy = String(row.decidedBy || row.decided_by || '-');
                        const decidedRole = String(row.decidedRole || row.decided_role || '-');
                        const comment = String(row.decisionComment || row.decision_comment || '');
                        return (
                          <div key={`${String(row.id || idx)}`} className="rounded-md border border-gray-200 p-2">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-gray-700">{action}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(status)}`}>{statusLabel(status)}</span>
                            </div>
                            <div className="text-gray-500">{tx('原因', 'reason')}: {reason || '-'}</div>
                            <div className="text-gray-500">{tx('执行者', 'actor')}: {decidedBy} ({decidedRole})</div>
                            {comment && <div className="text-gray-600">{tx('备注', 'comment')}: {comment}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <div className="text-xs text-slate-500">{tx('已折叠审批时间线，点击展开查看明细。', 'Approval timeline is collapsed. Expand to inspect details.')}</div>
                )}
              </div>
            </div>
          )}

          {rightPanelTab === 'subagents' && (
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-gray-500">
                <span>{tx('Sub-Agent 监控', 'Sub-Agent Monitor')}</span>
                <div className="flex items-center gap-2">
                  <span>{subAgentStats.total}</span>
                  <button
                    type="button"
                    onClick={() => setShowSubAgentGraph(prev => !prev)}
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                  >
                    {showSubAgentGraph ? tx('隐藏图谱', 'Hide Graph') : tx('显示图谱', 'Show Graph')}
                  </button>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-[11px] font-semibold uppercase text-gray-500">
                  {tx('状态', 'Status')}
                  <select
                    value={subAgentStatus}
                    onChange={e => {
                      setSubAgentPage(1);
                      setSubAgentStatus(e.target.value as 'ALL' | 'RUNNING' | 'SUCCEEDED' | 'FAILED');
                    }}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="ALL">{tx('全部', 'ALL')}</option>
                    <option value="RUNNING">{tx('运行中', 'RUNNING')}</option>
                    <option value="SUCCEEDED">{tx('成功', 'SUCCEEDED')}</option>
                    <option value="FAILED">{tx('失败', 'FAILED')}</option>
                  </select>
                </label>
                <label className="text-[11px] font-semibold uppercase text-gray-500">
                  {tx('范围', 'Scope')}
                  <select
                    value={subAgentScope}
                    onChange={e => {
                      setSubAgentPage(1);
                      setSubAgentScope(e.target.value as 'all' | 'selected');
                    }}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="selected">{tx('当前节点', 'Selected Node')}</option>
                    <option value="all">{tx('全部节点', 'All Nodes')}</option>
                  </select>
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-gray-50 p-2 text-[10px] text-gray-600 sm:grid-cols-4">
                <div>T:{subAgentStats.total}</div>
                <div>R:{subAgentStats.running}</div>
                <div>S:{subAgentStats.succeeded}</div>
                <div>F:{subAgentStats.failed}</div>
              </div>
              {subAgentRoleMix.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-600">
                  {subAgentRoleMix.map(item => (
                    <span key={`role-mix-${item.role}`} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5">
                      {item.role}: {item.count}
                    </span>
                  ))}
                </div>
              )}
              {showSubAgentGraph && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                    <span>{tx('Sub-Agent 编排图', 'Sub-Agent Orchestration Graph')}</span>
                    <span>{subAgentGraph.visibleCount} / {subAgentGraph.totalCount}</span>
                  </div>
                  {subAgentGraph.truncated && (
                    <div className="mb-1 text-[10px] text-amber-700">
                      {tx('为保证可读性，图最多展示 200 行。缩小过滤条件以查看完整细节。', 'Graph is capped at 200 rows for readability. Narrow filters for full detail.')}
                    </div>
                  )}
                  {subAgentGraph.nodes.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-300 bg-white p-2 text-xs text-slate-500">
                      {tx('当前过滤条件下没有 Sub-Agent 图数据。', 'No sub-agent graph data for current filters.')}
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-auto rounded-md border border-slate-200 bg-white">
                      <svg
                        width={subAgentGraph.width}
                        height={subAgentGraph.height}
                        viewBox={`0 0 ${subAgentGraph.width} ${subAgentGraph.height}`}
                        className="min-h-[10rem]"
                      >
                        <defs>
                          <linearGradient id="subAgentEdgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.54" />
                            <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.28" />
                          </linearGradient>
                        </defs>
                        {subAgentGraph.edges.map(edge => {
                          const from = subAgentGraph.nodeMap.get(edge.from);
                          const to = subAgentGraph.nodeMap.get(edge.to);
                          if (!from || !to) return null;
                          const startX = from.x + subAgentGraph.cardWidth;
                          const endX = to.x;
                          const path = `M ${startX} ${from.y} C ${startX + 42} ${from.y}, ${endX - 42} ${to.y}, ${endX} ${to.y}`;
                          const highlighted = selectedSubAgentChainSet.has(edge.from) && selectedSubAgentChainSet.has(edge.to);
                          return (
                            <path
                              key={`sub-edge-${edge.from}-${edge.to}`}
                              d={path}
                              fill="none"
                              stroke={highlighted ? '#3b82f6' : 'url(#subAgentEdgeGrad)'}
                              strokeWidth={highlighted ? 1.9 : 1.4}
                              strokeOpacity={highlighted ? 0.95 : 0.72}
                            />
                          );
                        })}
                        {subAgentGraph.nodes.map(node => {
                          const selected = selectedSubAgent?.subAgentId ? node.id === `sa:${selectedSubAgent.subAgentId}` : false;
                          const inChain = selectedSubAgentChainSet.has(node.id);
                          const root = node.kind === 'root';
                          const normalizedStatus = String(node.status || '').toUpperCase();
                          const fill = root
                            ? 'rgba(239,246,255,0.98)'
                            : normalizedStatus === 'FAILED'
                            ? 'rgba(255,241,242,0.95)'
                            : normalizedStatus === 'RUNNING'
                            ? 'rgba(239,246,255,0.97)'
                            : normalizedStatus === 'SUCCEEDED'
                            ? 'rgba(240,253,244,0.96)'
                            : 'rgba(248,250,252,0.97)';
                          const stroke = selected ? '#2563eb' : inChain ? '#60a5fa' : '#cbd5e1';
                          const labelLines = splitLabelLines(root ? node.label : node.label, root ? 21 : 14, root ? 2 : 1);
                          const meta = root
                            ? `${node.children} ${tx('个子智能体', 'sub-agents')}`
                            : `${splitLabelLines(String(node.role || tx('子智能体', 'SubAgent')), 11, 1)[0]} · ${statusLabel(String(node.status || '-'))}`;
                          return (
                            <g
                              key={`sub-node-${node.id}`}
                              transform={`translate(${node.x}, ${node.y - subAgentGraph.cardHeight / 2})`}
                              className="cursor-pointer"
                              onClick={() => {
                                setSelectedNodeId(node.parentNodeId);
                                if (!root && node.subAgentId) setSelectedSubAgentId(node.subAgentId);
                              }}
                            >
                              <rect
                                width={subAgentGraph.cardWidth}
                                height={subAgentGraph.cardHeight}
                                rx={10}
                                fill={fill}
                                stroke={stroke}
                                strokeWidth={selected ? 1.8 : 1.2}
                              />
                              <text x={10} y={16} fontSize={9.2} fontWeight={700} fill={root ? '#1d4ed8' : '#334155'}>
                                {labelLines.map((line, idx) => (
                                  <tspan key={`${node.id}-line-${idx}`} x={10} dy={idx === 0 ? 0 : 10}>
                                    {line}
                                  </tspan>
                                ))}
                              </text>
                              <text x={10} y={subAgentGraph.cardHeight - 8} fontSize={8.5} fill="#64748b">{meta}</text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  )}
                </div>
              )}
              {selectedSubAgent && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-800">{selectedSubAgent.subAgentId} · {selectedSubAgent.role}</div>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(selectedSubAgent.status)}`}>
                      {statusLabel(selectedSubAgent.status)}
                    </span>
                  </div>
                  <div className="mt-1 break-words text-[11px] text-slate-600">{selectedSubAgent.objective}</div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    {tx('节点', 'node')} {selectedSubAgent.parentNodeId} · {tx('深度', 'depth')} {selectedSubAgent.depth} · {formatTimestamp(selectedSubAgent.startedAt)}
                    {selectedSubAgent.finishedAt ? ` -> ${formatTimestamp(selectedSubAgent.finishedAt)}` : ''}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                    <span className="font-semibold uppercase text-slate-500">{tx('链路', 'Lineage')}</span>
                    {selectedSubAgentLineage.map((item, idx) => (
                      <React.Fragment key={`lineage-${item.subAgentId}`}>
                        {idx > 0 && <span className="text-slate-300">/</span>}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSubAgentId(item.subAgentId);
                            setSelectedNodeId(item.parentNodeId);
                          }}
                          className={`rounded border px-1.5 py-0.5 ${
                            item.subAgentId === selectedSubAgent.subAgentId
                              ? 'border-blue-300 bg-blue-50 text-blue-700'
                              : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {item.subAgentId}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
                    <span className="font-semibold uppercase">{tx('证据键', 'Evidence keys')}</span>
                    {selectedSubAgentEvidenceKeys.length === 0 ? (
                      <span>-</span>
                    ) : (
                      selectedSubAgentEvidenceKeys.map(key => (
                        <span key={`evi-key-${key}`} className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-slate-600">
                          {key}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              )}
              {subAgentItems.length === 0 ? (
                <div className="mt-2 rounded-md border border-dashed border-gray-300 p-2 text-xs text-gray-500">{tx('没有匹配的 Sub-Agent。', 'No sub-agents matched.')}</div>
              ) : (
                <div className="mt-2 max-h-64 space-y-1 overflow-auto">
                  {subAgentItems.map(row => (
                    <button
                      key={row.subAgentId}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(row.parentNodeId);
                        setSelectedSubAgentId(row.subAgentId);
                      }}
                      className="w-full rounded-md border border-gray-200 p-2 text-left text-xs hover:bg-gray-50"
                      style={{ marginLeft: `${Math.min(18, Math.max(0, row.depth - 1) * 8)}px` }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-700">{row.subAgentId}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(row.status)}`}>{statusLabel(row.status)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
                        <span>{row.role}</span>
                        <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600">d{row.depth}</span>
                        <span>{tx('节点', 'node')} {row.parentNodeId}</span>
                      </div>
                      <div className="mt-0.5 break-words text-[11px] text-gray-600">{row.objective}</div>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                <button
                  type="button"
                  onClick={() => setSubAgentPage(prev => Math.max(1, prev - 1))}
                  disabled={subAgentPage <= 1}
                  className="rounded border border-gray-300 px-2 py-0.5 disabled:opacity-40"
                >
                  {tx('上一页', 'Prev')}
                </button>
                <span>{subAgentPage}/{subAgentPageCount} · {subAgentTotal}</span>
                <button
                  type="button"
                  onClick={() => setSubAgentPage(prev => Math.min(subAgentPageCount, prev + 1))}
                  disabled={subAgentPage >= subAgentPageCount}
                  className="rounded border border-gray-300 px-2 py-0.5 disabled:opacity-40"
                >
                  {tx('下一页', 'Next')}
                </button>
              </div>
            </div>
          )}

          {rightPanelTab === 'report' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase text-gray-500">
                  <span>{tx('决策报告', 'Decision Report')}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleRefreshReportSnapshot}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                    >
                      {tx('刷新', 'Refresh')}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyReproCommand}
                      disabled={!reportModel}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {tx('复制复现命令', 'Copy Repro Cmd')}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportReportMarkdown}
                      disabled={!reportModel}
                      className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                    >
                      {tx('导出 MD', 'Export MD')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowReportPreview(prev => !prev)}
                      disabled={!reportModel}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {showReportPreview ? tx('收起预览', 'Hide Preview') : tx('显示预览', 'Show Preview')}
                    </button>
                  </div>
                </div>
                {!reportModel ? (
                  <div className="text-xs text-gray-500">{tx('请选择运行以生成决策报告。', 'Select a run to generate a decision report.')}</div>
                ) : (
                  <div className="space-y-2 text-xs text-slate-700">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <div className="font-semibold text-slate-800">{reportModel.title}</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {tx('运行', 'run')} {reportModel.runId} · {tx('快照', 'snapshot')} {new Date(parseTimestamp(reportModel.generatedAt)).toLocaleString()}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600">{reportModel.objective}</div>
                    </div>
                    <div className={`rounded-md border p-2 ${reportModel.contractPassRate < 95 ? 'border-amber-200 bg-amber-50/85 text-amber-800' : 'border-emerald-200 bg-emerald-50/85 text-emerald-800'}`}>
                      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide">
                        <span>{tx('契约通过率', 'Contract Pass')}</span>
                        <span>{reportModel.contractPassRate.toFixed(2)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-white/80">
                        <div
                          className={`h-1.5 rounded-full ${reportModel.contractPassRate < 95 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.max(2, Math.min(100, reportModel.contractPassRate))}%` }}
                        />
                      </div>
                    </div>
                    {Object.keys(reportPolicyMeta).length > 0 && (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-600">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{tx('审批策略快照', 'Approval Policy Snapshot')}</div>
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          <div>{tx('版本', 'version')}: {String(reportPolicyMeta.rulesVersion || '-')}</div>
                          <div>{tx('模式', 'mode')}: {String(reportPolicyMeta.mode || '-')}</div>
                          <div className="col-span-2 break-all"><span className="font-semibold uppercase text-slate-500">{tx('规则哈希', 'rulesHash')}</span>: {String(reportPolicyMeta.rulesHash || '-')}</div>
                          <div className="col-span-2 break-all"><span className="font-semibold uppercase text-slate-500">{tx('策略哈希', 'policyHash')}</span>: {String(reportPolicyMeta.policyHash || '-')}</div>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1 rounded-md bg-gray-50 p-2 text-[10px] text-gray-600">
                      <div>{tx('状态', 'status')}: {statusLabel(reportModel.status)}</div>
                      <div>{tx('契约', 'contract')}: {reportModel.contractPassRate.toFixed(2)}%</div>
                      <div>{tx('节点', 'nodes')}: {reportModel.totNodes}</div>
                      <div>{tx('事件', 'events')}: {reportModel.timelineEvents}</div>
                      <div>{tx('失败', 'failure')}: {reportModel.failureEvents}</div>
                      <div>{tx('恢复', 'recovery')}: {reportModel.recoveryEvents}</div>
                      <div>{tx('安全', 'safety')}: {reportModel.safetyEvents}</div>
                      <div>{tx('联赛', 'league')}: {reportModel.leagueEvents}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 p-2">
                      <div className="text-[10px] font-semibold uppercase text-slate-500">{tx('审批快照', 'Approval Snapshot')}</div>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] text-slate-600">
                        <div>{tx('待处理', 'pending')}: {reportModel.approvals.pending}</div>
                        <div>{tx('已通过', 'approved')}: {reportModel.approvals.approved}</div>
                        <div>{tx('已拒绝', 'rejected')}: {reportModel.approvals.rejected}</div>
                        <div>{tx('已过期', 'expired')}: {reportModel.approvals.expired}</div>
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 p-2">
                      <div className="text-[10px] font-semibold uppercase text-slate-500">{tx('Sub-Agent 角色分布', 'Sub-Agent Role Mix')}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-600">
                        {reportModel.subAgents.topRoles.length === 0 ? (
                          <span>-</span>
                        ) : (
                          reportModel.subAgents.topRoles.map(item => (
                            <span key={`report-role-${item.role}`} className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5">
                              {item.role}: {item.count}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 p-2">
                      <div className="text-[10px] font-semibold uppercase text-slate-500">{tx('联赛头部排名', 'League Top Ranking')}</div>
                      <div className="mt-1 space-y-0.5 text-[10px] text-slate-600">
                        {reportModel.matrix.topRanking.length === 0 ? (
                          <div>-</div>
                        ) : (
                          reportModel.matrix.topRanking.map(item => (
                            <div key={`report-rank-${item.id}`}>#{item.rank} {item.id}: {item.score.toFixed(2)}</div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-600">
                      <div><span className="font-semibold uppercase text-slate-500">{tx('复现', 'repro')}</span>: {reportModel.reproScript}</div>
                      <div className="mt-0.5"><span className="font-semibold uppercase text-slate-500">{tx('回放', 'replay')}</span>: {reportModel.replayCommand}</div>
                      {runReport && (
                        <div className="mt-1 border-t border-slate-200 pt-1 text-[10px] text-slate-500">
                          <div><span className="font-semibold uppercase text-slate-500">{tx('来源', 'source')}</span>: {tx('后端产物', 'backend artifact')}</div>
	                          <div className="mt-0.5 break-all"><span className="font-semibold uppercase text-slate-500">{tx('JSON', 'JSON')}</span>: {runReport.artifactJsonPath}</div>
	                          <div className="mt-0.5 break-all"><span className="font-semibold uppercase text-slate-500">{tx('Markdown', 'Markdown')}</span>: {runReport.artifactMarkdownPath}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {reportModel && (!isFocusedWorkspace || showReportPreview) && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase text-gray-500">{tx('Markdown 预览', 'Markdown Preview')}</div>
                  <pre className="max-h-56 overflow-auto rounded bg-slate-900 p-3 text-[11px] text-emerald-200">{reportMarkdown}</pre>
                </div>
              )}
            </div>
          )}

          {rightPanelTab === 'audit' && (
            <div className="space-y-3">
              <div className={`rounded-lg border p-3 ${toneCardClass(auditHealth.tone)}`}>
                <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-gray-500">
                  <span>{tx('审计回放', 'Audit Replay')}</span>
                  <button onClick={handleAuditReplay} className="text-blue-600 hover:text-blue-700">{tx('验证', 'Verify')}</button>
                </div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[11px]">{auditHealth.hint}</div>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${toneBadgeClass(auditHealth.tone, true)}`}>{auditHealth.label}</span>
                </div>
                {!auditReplay ? (
                  <div className="text-xs text-gray-500">{tx('执行验证以检查审计链与回放状态。', 'Run verification to check audit chain and replay status.')}</div>
                ) : (
                  <div className="space-y-1 text-xs text-gray-700">
                    <div><strong>{tx('已验证', 'Verified')}:</strong> {String(auditReplay.verified)}</div>
                    <div><strong>{tx('已检查事件', 'Checked events')}:</strong> {auditReplay.checkedEvents}</div>
                    <div><strong>{tx('回放状态', 'Replay status')}:</strong> {String(auditReplayData.replayStatus || '-')}</div>
                    <div><strong>{tx('语义有效', 'Semantic valid')}:</strong> {String(auditReplayData.semanticValid ?? '-')}</div>
                    <div><strong>{tx('Sub-Agent', 'Sub-agents')}:</strong> {Number(auditReplayData.subAgentsStarted || 0)} {tx('已启动', 'started')} / {Number(auditReplayData.subAgentsFailed || 0)} {tx('失败', 'failed')}</div>
                    {auditSemanticIssues.length > 0 && (
                      <div className="text-amber-700"><strong>{tx('语义问题', 'Semantic issues')}:</strong> {auditSemanticIssues.join(' | ')}</div>
                    )}
                    {auditReplay.failureReason && <div className="text-rose-700"><strong>{tx('失败', 'Failure')}:</strong> {auditReplay.failureReason}</div>}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="agentic-kpi-grid mb-2">
                  {auditKpiCards.map(card => (
                    <div key={`audit-kpi-${card.key}`} className={`agentic-kpi-card ${toneCardClass(card.tone)}`}>
                      <div className="agentic-kpi-label">{card.label}</div>
                      <div className="agentic-kpi-value">{card.value}</div>
                    </div>
                  ))}
                  <div className={`agentic-kpi-card ${toneCardClass('neutral')}`}>
                    <div className="agentic-kpi-label">{tx('事件总数', 'Events')}</div>
                    <div className="agentic-kpi-value">{(detail?.events || []).length}</div>
                  </div>
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-gray-500">{tx('最近事件', 'Recent Events')}</div>
                  <button
                    type="button"
                    onClick={() => setShowAuditEvents(prev => !prev)}
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                  >
                    {showAuditEvents ? tx('收起', 'Hide') : tx('展开', 'Expand')}
                  </button>
                </div>
                {(!isFocusedWorkspace || showAuditEvents) ? (
                  <div className="max-h-64 space-y-2 overflow-auto text-xs">
                    {(detail?.events || []).slice(-8).reverse().map((evt, idx) => (
                      <div key={`${String(evt.ts)}-${idx}`} className="rounded-md border border-gray-200 p-2">
                        <div className="font-medium text-gray-700">{String(evt.event)}</div>
                        <div className="text-gray-500">{String(evt.message)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">{tx('最近事件已折叠，展开后可查看审计明细。', 'Recent events are collapsed. Expand to inspect audit details.')}</div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={handleMatrix} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">{tx('生成矩阵', 'Generate Matrix')}</button>
                </div>
              </div>
            </div>
          )}
        </aside>
        )}
      </div>

      {(busy || message) && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${message ? 'border-gray-200 bg-white text-gray-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
          {busy ? `${tx('执行中', 'Running')}: ${busy}...` : message}
        </div>
      )}

      {detail?.status === 'BLOCKED' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mr-1 inline h-4 w-4" /> {tx('运行被安全策略阻塞，请先审批待处理动作再继续。', 'Run is blocked by safety policy. Approve pending actions to continue.')}
        </div>
      )}
    </div>
  );
};
