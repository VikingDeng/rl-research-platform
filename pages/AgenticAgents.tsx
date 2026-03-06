import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, RefreshCcw, ShieldAlert, WandSparkles, XCircle } from 'lucide-react';
import { api } from '../services/api';
import { useI18n } from '../services/i18n';
import type { AgenticApproverRecord, AgenticRunDetail, AgenticSubAgentRecord } from '../types';

type ApprovalActorRole = 'admin' | 'ops' | 'security';

type ApprovalRow = {
  id: string;
  action: string;
  reason: string;
  roleHint: string;
  raw: Record<string, unknown>;
};

type SubAgentGraphNode = {
  id: string;
  kind: 'root' | 'sub';
  x: number;
  y: number;
  label: string;
  status: string;
  role: string;
};

const statusBadgeClass = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'SUCCEEDED') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'FAILED') return 'bg-rose-100 text-rose-700';
  if (normalized === 'BLOCKED') return 'bg-amber-100 text-amber-700';
  if (normalized === 'RUNNING') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-600';
};

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const parseTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
};

const flattenFallbackSubAgents = (detail: AgenticRunDetail | null): AgenticSubAgentRecord[] => {
  if (!detail) return [];
  const rows: AgenticSubAgentRecord[] = [];
  const treeRows = Array.isArray(detail.totTree) ? detail.totTree : [];
  treeRows.forEach(node => {
    const subRows = Array.isArray(node.subAgents) ? node.subAgents : [];
    subRows.forEach((item, idx) => {
      const record = item as Record<string, unknown>;
      const subAgentId = String(record.subAgentId || record.sub_agent_id || `${node.nodeId}-sub-${idx + 1}`);
      rows.push({
        subAgentId,
        parentNodeId: node.nodeId,
        parentSubAgentId: (record.parentSubAgentId || record.parent_sub_agent_id || null) as string | null,
        ownerAgent: String(record.ownerAgent || record.owner_agent || node.agent || 'Agent'),
        role: String(record.role || 'SubAgent'),
        objective: String(record.objective || node.hypothesis || '-'),
        depth: Number(record.depth || 1),
        status: String(record.status || 'PENDING'),
        startedAt: String(record.startedAt || record.started_at || detail.createdAt),
        finishedAt: (record.finishedAt || record.finished_at || null) as string | null,
        evidence: (record.evidence || {}) as Record<string, unknown>,
        children: Array.isArray(record.children) ? (record.children as string[]) : [],
      });
    });
  });
  return rows;
};

const parseApprovalRows = (detail: AgenticRunDetail | null): ApprovalRow[] => {
  if (!detail) return [];
  const rows = Array.isArray(detail.pendingApprovals) ? detail.pendingApprovals : [];
  return rows.map(item => {
    const row = item as Record<string, unknown>;
    const id = String(row.approvalId || row.approval_id || row.id || row.actionId || row.action_id || '');
    const action = String(row.action || row.actionName || row.action_name || 'unknown_action');
    const reason = String(row.reason || row.message || row.detail || '-');
    const roleHint = String(row.role || row.requiredRole || row.required_role || 'admin');
    return { id, action, reason, roleHint, raw: row };
  }).filter(row => row.id.length > 0);
};

export const AgenticAgents: React.FC = () => {
  const navigate = useNavigate();
  const { tx } = useI18n();
  const params = useParams();

  const runId = decodeURIComponent(params.runId || '');

  const [detail, setDetail] = useState<AgenticRunDetail | null>(null);
  const [subAgents, setSubAgents] = useState<AgenticSubAgentRecord[]>([]);
  const [approvers, setApprovers] = useState<AgenticApproverRecord[]>([]);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState('');
  const [selectedApprovalIds, setSelectedApprovalIds] = useState<string[]>([]);
  const [selectedActorKey, setSelectedActorKey] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'FAILED' | 'SUCCEEDED' | 'PENDING'>('ALL');

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'none' | 'approve' | 'reject' | 'refresh'>('none');
  const [message, setMessage] = useState('');

  const loadAll = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setMessage('');
    try {
      const [runDetail, subAgentRes, approverRes] = await Promise.all([
        api.getAgenticRun(runId),
        api.listAgenticSubAgents(runId, { page: 1, pageSize: 200 }).catch(() => null),
        api.listAgenticApprovers().catch(() => null),
      ]);
      setDetail(runDetail);
      const rows = subAgentRes?.items && subAgentRes.items.length > 0
        ? subAgentRes.items
        : flattenFallbackSubAgents(runDetail);
      rows.sort((a, b) => parseTimestamp(a.startedAt) - parseTimestamp(b.startedAt));
      setSubAgents(rows);
      if (!selectedSubAgentId || !rows.some(row => row.subAgentId === selectedSubAgentId)) {
        setSelectedSubAgentId(rows[0]?.subAgentId || '');
      }

      const approverRows = approverRes?.items || [];
      setApprovers(approverRows);
      if (approverRows.length > 0) {
        const firstRole = approverRows[0].roles?.find(role => role === 'admin' || role === 'ops' || role === 'security') || 'admin';
        setSelectedActorKey(`${approverRows[0].actorId}::${firstRole}`);
      }
    } catch (error) {
      setMessage(toErrorMessage(error));
      setDetail(null);
      setSubAgents([]);
    } finally {
      setLoading(false);
    }
  }, [runId, selectedSubAgentId]);

  useEffect(() => {
    loadAll().catch(() => undefined);
  }, [loadAll]);

  const approvals = useMemo(() => parseApprovalRows(detail), [detail]);

  const selectedSubAgent = useMemo(() => {
    if (subAgents.length === 0) return null;
    return subAgents.find(item => item.subAgentId === selectedSubAgentId) || subAgents[0];
  }, [subAgents, selectedSubAgentId]);
  const filteredSubAgents = useMemo(() => {
    if (statusFilter === 'ALL') return subAgents;
    return subAgents.filter(item => String(item.status || '').toUpperCase() === statusFilter);
  }, [subAgents, statusFilter]);

  const subAgentGraph = useMemo(() => {
    const rootKeys = Array.from(new Set(subAgents.map(item => item.parentNodeId))).sort();
    if (rootKeys.length === 0) {
      return {
        nodes: [] as SubAgentGraphNode[],
        edges: [] as Array<{ from: string; to: string }>,
        width: 420,
        height: 220,
      };
    }

    const childrenByParent = new Map<string, AgenticSubAgentRecord[]>();
    subAgents.forEach(item => {
      const parentKey = item.parentSubAgentId || `root:${item.parentNodeId}`;
      const rows = childrenByParent.get(parentKey) || [];
      rows.push(item);
      childrenByParent.set(parentKey, rows);
    });
    childrenByParent.forEach(rows => {
      rows.sort((a, b) => parseTimestamp(a.startedAt) - parseTimestamp(b.startedAt));
    });

    const nodes: SubAgentGraphNode[] = [];
    const edges: Array<{ from: string; to: string }> = [];
    const rowHeight = 90;
    const rowGap = 18;
    const depthWidth = 210;
    const originX = 18;
    let cursorY = 44;
    let maxDepth = 1;

    const placeSub = (item: AgenticSubAgentRecord, depth: number): number => {
      maxDepth = Math.max(maxDepth, depth);
      const children = childrenByParent.get(item.subAgentId) || [];
      let y = cursorY;
      if (children.length === 0) {
        cursorY += rowHeight;
      } else {
        const ys = children.map(child => {
          const childY = placeSub(child, depth + 1);
          edges.push({ from: item.subAgentId, to: child.subAgentId });
          return childY;
        });
        y = ys.reduce((acc, val) => acc + val, 0) / ys.length;
      }
      nodes.push({
        id: item.subAgentId,
        kind: 'sub',
        x: originX + depth * depthWidth,
        y,
        label: item.subAgentId,
        status: item.status,
        role: item.role,
      });
      return y;
    };

    rootKeys.forEach((nodeId, idx) => {
      const rootId = `root:${nodeId}`;
      const topLevel = childrenByParent.get(rootId) || [];
      let y = cursorY;
      if (topLevel.length === 0) {
        cursorY += rowHeight;
      } else {
        const ys = topLevel.map(item => {
          const childY = placeSub(item, 1);
          edges.push({ from: rootId, to: item.subAgentId });
          return childY;
        });
        y = ys.reduce((acc, val) => acc + val, 0) / ys.length;
      }
      nodes.push({
        id: rootId,
        kind: 'root',
        x: originX,
        y,
        label: nodeId,
        status: 'ROOT',
        role: 'ToT Node',
      });
      if (idx < rootKeys.length - 1) cursorY += rowGap;
    });

    return {
      nodes,
      edges,
      width: Math.max(420, (maxDepth + 1) * depthWidth + 180),
      height: Math.max(220, cursorY + 24),
    };
  }, [subAgents]);
  const subAgentGraphNodeMap = useMemo(() => new Map(subAgentGraph.nodes.map(node => [node.id, node])), [subAgentGraph]);

  const subAgentStats = useMemo(() => {
    const stats = { total: subAgents.length, running: 0, failed: 0, succeeded: 0, pending: 0 };
    subAgents.forEach(item => {
      const normalized = String(item.status || '').toUpperCase();
      if (normalized === 'RUNNING') stats.running += 1;
      else if (normalized === 'FAILED') stats.failed += 1;
      else if (normalized === 'SUCCEEDED') stats.succeeded += 1;
      else stats.pending += 1;
    });
    return stats;
  }, [subAgents]);

  const roleMix = useMemo(() => {
    const counts = new Map<string, number>();
    subAgents.forEach(item => {
      const role = String(item.role || 'SubAgent');
      counts.set(role, (counts.get(role) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [subAgents]);

  const toggleApproval = (approvalId: string) => {
    setSelectedApprovalIds(prev => prev.includes(approvalId) ? prev.filter(id => id !== approvalId) : [...prev, approvalId]);
  };

  const submitApproval = async (decision: 'approve' | 'reject') => {
    if (!runId || selectedApprovalIds.length === 0) {
      setMessage(tx('请先选择审批项。', 'Select approvals first.'));
      return;
    }
    const [actorId = '', actorRole = 'admin'] = selectedActorKey.split('::');
    const role = (actorRole === 'ops' || actorRole === 'security' ? actorRole : 'admin') as ApprovalActorRole;
    if (!actorId) {
      setMessage(tx('请选择审批人。', 'Select an approver actor.'));
      return;
    }

    setBusy(decision);
    setMessage('');
    try {
      const res = await api.approveAgenticActions(runId, {
        approvalIds: selectedApprovalIds,
        decision,
        actorId,
        actorRole: role,
      });
      setDetail(res.detail);
      setSelectedApprovalIds([]);
      setMessage(res.message || tx('审批操作已提交。', 'Approval decision submitted.'));
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setBusy('none');
    }
  };

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
              {tx('返回探索主页', 'Back to Explorer')}
            </button>
            <button
              type="button"
              onClick={() => runId && navigate(`/agentic/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(detail?.totTree?.[0]?.nodeId || 'n0')}`)}
              disabled={!runId}
              className="inline-flex items-center rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {tx('节点证据页', 'Node Evidence')}
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
          <button
            type="button"
            onClick={() => {
              setBusy('refresh');
              loadAll().finally(() => setBusy('none'));
            }}
            disabled={busy !== 'none'}
            className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCcw className={`mr-1.5 h-4 w-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
            {tx('刷新', 'Refresh')}
          </button>
        </div>
      </section>

      {loading ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
          {tx('加载 Agent 数据中...', 'Loading agent data...')}
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tx('Sub-agent 总数', 'Sub-agent Total')}</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{subAgentStats.total}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tx('运行中', 'Running')}</div>
              <div className="mt-1 text-xl font-semibold text-blue-700">{subAgentStats.running}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tx('成功', 'Succeeded')}</div>
              <div className="mt-1 text-xl font-semibold text-emerald-700">{subAgentStats.succeeded}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tx('失败', 'Failed')}</div>
              <div className="mt-1 text-xl font-semibold text-rose-700">{subAgentStats.failed}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tx('待审批', 'Pending Approvals')}</div>
              <div className="mt-1 text-xl font-semibold text-amber-700">{approvals.length}</div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-12">
            <aside className="space-y-4 xl:col-span-4">
              <article className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('Sub-agent 列表', 'Sub-agent List')}</h2>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(['ALL', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PENDING'] as const).map(tag => {
                    const active = statusFilter === tag;
                    const count = tag === 'ALL'
                      ? subAgents.length
                      : subAgents.filter(item => String(item.status || '').toUpperCase() === tag).length;
                    return (
                      <button
                        key={`filter-${tag}`}
                        type="button"
                        onClick={() => setStatusFilter(tag)}
                        className={`rounded-full border px-2 py-1 text-[11px] ${active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                      >
                        {tag} ({count})
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 max-h-[36rem] space-y-2 overflow-auto pr-1">
                  {filteredSubAgents.length === 0 && <div className="text-xs text-slate-500">{tx('暂无 sub-agent。', 'No sub-agents yet.')}</div>}
                  {filteredSubAgents.map(item => (
                    <button
                      key={item.subAgentId}
                      type="button"
                      onClick={() => setSelectedSubAgentId(item.subAgentId)}
                      className={`w-full rounded-lg border px-3 py-2 text-left hover:bg-slate-50 ${selectedSubAgentId === item.subAgentId ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">{item.subAgentId}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass(item.status)}`}>{item.status}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600">{item.role}</div>
                      <div className="mt-1 truncate text-[11px] text-slate-500">{item.objective}</div>
                    </button>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('角色分布', 'Role Mix')}</h2>
                <div className="mt-2 space-y-2">
                  {roleMix.length === 0 && <div className="text-xs text-slate-500">{tx('暂无数据。', 'No data.')}</div>}
                  {roleMix.map(item => (
                    <div key={`role-${item.role}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                      <div className="flex items-center justify-between">
                        <span>{item.role}</span>
                        <span className="font-semibold">{item.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </aside>

            <div className="space-y-4 xl:col-span-8">
              <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('Sub-agent 拓扑图', 'Sub-agent Topology')}</h2>
                  <div className="text-xs text-slate-500">
                    {subAgentGraph.nodes.length} {tx('节点', 'nodes')} · {subAgentGraph.edges.length} {tx('连线', 'edges')}
                  </div>
                </div>
                {subAgentGraph.nodes.length === 0 ? (
                  <div className="mt-2 text-xs text-slate-500">{tx('暂无 sub-agent 拓扑。', 'No sub-agent topology yet.')}</div>
                ) : (
                  <div className="mt-2 overflow-auto rounded-lg border border-slate-200 bg-[radial-gradient(circle_at_0%_0%,rgba(219,234,254,.28),transparent_40%),linear-gradient(180deg,rgba(248,250,252,.7),rgba(255,255,255,.95))]">
                    <svg width={subAgentGraph.width} height={subAgentGraph.height} viewBox={`0 0 ${subAgentGraph.width} ${subAgentGraph.height}`}>
                      <defs>
                        <linearGradient id="sub-agent-edge" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.5" />
                          <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.2" />
                        </linearGradient>
                      </defs>
                      {subAgentGraph.edges.map((edge, idx) => {
                        const from = subAgentGraphNodeMap.get(edge.from);
                        const to = subAgentGraphNodeMap.get(edge.to);
                        if (!from || !to) return null;
                        const path = `M ${from.x + 146} ${from.y} C ${from.x + 190} ${from.y}, ${to.x - 36} ${to.y}, ${to.x} ${to.y}`;
                        return <path key={`sub-edge-${idx}`} d={path} fill="none" stroke="url(#sub-agent-edge)" strokeWidth={1.4} />;
                      })}
                      {subAgentGraph.nodes.map(node => {
                        const normalizedStatus = String(node.status || '').toUpperCase();
                        const selected = selectedSubAgentId === node.id;
                        const fill = node.kind === 'root'
                          ? 'rgba(226,232,240,.9)'
                          : normalizedStatus === 'FAILED'
                          ? 'rgba(255,228,230,.9)'
                          : normalizedStatus === 'SUCCEEDED'
                          ? 'rgba(220,252,231,.9)'
                          : normalizedStatus === 'RUNNING'
                          ? 'rgba(219,234,254,.9)'
                          : 'rgba(248,250,252,.92)';
                        const stroke = selected ? '#2563eb' : 'rgba(148,163,184,.75)';
                        return (
                          <g
                            key={`sub-node-${node.id}`}
                            transform={`translate(${node.x}, ${node.y - 28})`}
                            className={node.kind === 'sub' ? 'cursor-pointer' : ''}
                            onClick={() => {
                              if (node.kind !== 'sub') return;
                              setSelectedSubAgentId(node.id);
                            }}
                          >
                            <rect width={146} height={56} rx={10} fill={fill} stroke={stroke} strokeWidth={selected ? 1.8 : 1.2} />
                            <text x={10} y={20} fontSize={9.5} fontWeight={700} fill="#1e293b">{node.label}</text>
                            <text x={10} y={35} fontSize={8.3} fill="#475569">{node.role}</text>
                            <text x={10} y={48} fontSize={8.1} fill="#64748b">{node.kind === 'root' ? 'ROOT' : normalizedStatus}</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                )}
                <div className="mt-2 text-[11px] text-slate-500">{tx('点击拓扑节点可同步到详情面板。', 'Click a topology node to sync selected agent.')}</div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('选中 Agent 详情', 'Selected Agent Detail')}</h2>
                {!selectedSubAgent ? (
                  <div className="mt-2 text-xs text-slate-500">{tx('请选择一个 sub-agent。', 'Select one sub-agent.')}</div>
                ) : (
                  <>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                        <div className="text-slate-500">ID</div>
                        <div className="mt-1 font-semibold text-slate-800">{selectedSubAgent.subAgentId}</div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                        <div className="text-slate-500">{tx('所属节点', 'Parent Node')}</div>
                        <div className="mt-1 font-semibold text-slate-800">{selectedSubAgent.parentNodeId}</div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                        <div className="text-slate-500">Status</div>
                        <div className="mt-1 font-semibold text-slate-800">{selectedSubAgent.status}</div>
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tx('目标', 'Objective')}</div>
                      <div className="mt-1 text-sm text-slate-700">{selectedSubAgent.objective || '-'}</div>
                    </div>
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</div>
                      <pre className="mt-2 max-h-64 overflow-auto text-xs text-slate-700">{JSON.stringify(selectedSubAgent.evidence || {}, null, 2)}</pre>
                    </div>
                  </>
                )}
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tx('审批面板（真实链路）', 'Approval Panel (live chain)')}</h2>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedActorKey}
                      onChange={e => setSelectedActorKey(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    >
                      {approvers.length === 0 && <option value="">{tx('无审批人', 'No approvers')}</option>}
                      {approvers.flatMap(actor => {
                        const roles = actor.roles.filter(role => role === 'admin' || role === 'ops' || role === 'security');
                        const safeRoles = roles.length > 0 ? roles : ['admin'];
                        return safeRoles.map(role => (
                          <option key={`${actor.actorId}-${role}`} value={`${actor.actorId}::${role}`}>
                            {actor.actorId} · {role}
                          </option>
                        ));
                      })}
                    </select>
                    <button
                      type="button"
                      onClick={() => submitApproval('approve')}
                      disabled={busy !== 'none' || selectedApprovalIds.length === 0}
                      className="inline-flex items-center rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      {tx('通过', 'Approve')}
                    </button>
                    <button
                      type="button"
                      onClick={() => submitApproval('reject')}
                      disabled={busy !== 'none' || selectedApprovalIds.length === 0}
                      className="inline-flex items-center rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" />
                      {tx('驳回', 'Reject')}
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {approvals.length === 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      {tx('当前没有待审批项。', 'No pending approvals right now.')}
                    </div>
                  )}
                  {approvals.map(item => {
                    const selected = selectedApprovalIds.includes(item.id);
                    return (
                      <label
                        key={`approval-${item.id}`}
                        className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 ${selected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleApproval(item.id)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-700">{item.action}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{item.roleHint}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-600">{item.reason}</div>
                          <div className="mt-1 text-[11px] text-slate-500">ID: {item.id}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {detail?.status === 'BLOCKED' && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
                    {tx('Run 当前处于 BLOCKED，处理审批后可继续执行。', 'Run is BLOCKED. Resolve approvals then continue execution.')}
                  </div>
                )}
              </article>
            </div>
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

export default AgenticAgents;
