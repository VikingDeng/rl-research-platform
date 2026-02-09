import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ArrowLeft, BarChart2 } from 'lucide-react';
import { RunGroupSummary } from '../types';
import { useToast } from '../components/Toast';

export const GroupSummary: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const [summary, setSummary] = useState<RunGroupSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    api.getRunGroupSummary(groupId)
      .then(setSummary)
      .finally(() => setLoading(false));
  }, [groupId]);

  const sortedMetrics = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.metrics).sort((a, b) => a[0].localeCompare(b[0]));
  }, [summary]);

  const exportBest = async (metric: string, runId?: string) => {
    if (!runId) return;
    const name = window.prompt('Template name', `Best-${metric}-${summary?.groupId?.slice(0, 8)}`);
    if (!name) return;
    try {
      await api.exportRunTemplate(runId, { name, description: `Best ${metric} from group ${summary?.groupId}` });
      showToast('Template exported from best run.', 'success');
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Export failed';
      showToast(detail, 'error');
    }
  };

  const isRateMetric = (metric: string) => /rate|ratio|prob|accuracy|win/i.test(metric);
  const formatMetric = (metric: string, value: number) =>
    isRateMetric(metric) ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);

  if (loading) {
    return <div className="p-6 text-gray-500">Loading group summary...</div>;
  }

  if (!summary) {
    return <div className="p-6 text-gray-500">Group not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/" className="hover:text-blue-600 flex items-center">
          <ArrowLeft className="w-3 h-3 mr-1" /> Back to Dashboard
        </Link>
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Group Summary</h1>
            <p className="text-xs text-gray-500 font-mono">{summary.groupId}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <BarChart2 className="w-4 h-4" /> {summary.totalRuns} runs
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.statusCounts).map(([status, count]) => (
            <span key={status} className="px-2 py-1 text-xs rounded-full border border-gray-200 text-gray-600 bg-gray-50">
              {status}: {count}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Aggregated Metrics</h2>
        </div>
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs text-gray-500 font-semibold uppercase">
            <tr>
              <th className="px-6 py-3">Metric</th>
              <th className="px-6 py-3">Mean ± Std</th>
              <th className="px-6 py-3">95% CI</th>
              <th className="px-6 py-3">Min</th>
              <th className="px-6 py-3">Max</th>
              <th className="px-6 py-3">N</th>
              <th className="px-6 py-3">Best Run</th>
              <th className="px-6 py-3">Export Best</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedMetrics.map(([metric, stat]) => (
              <tr key={metric} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">{metric}</td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {formatMetric(metric, stat.mean)} ± {formatMetric(metric, stat.std)}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {typeof stat.ciLow === 'number' && typeof stat.ciHigh === 'number'
                    ? `${formatMetric(metric, stat.ciLow)} ~ ${formatMetric(metric, stat.ciHigh)}`
                    : '-'}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">{formatMetric(metric, stat.min)}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{formatMetric(metric, stat.max)}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{stat.n}</td>
                <td className="px-6 py-4 text-sm text-blue-600">
                  {stat.bestRunId ? <Link to={`/runs/${stat.bestRunId}`}>View</Link> : '-'}
                </td>
                <td className="px-6 py-4 text-sm">
                  {stat.bestRunId ? (
                    <button
                      onClick={() => exportBest(metric, stat.bestRunId)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Export
                    </button>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
              </tr>
            ))}
            {sortedMetrics.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                  No metrics captured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Runs in Group</h2>
        </div>
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs text-gray-500 font-semibold uppercase">
            <tr>
              <th className="px-6 py-3">Run</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Seed</th>
              <th className="px-6 py-3">Metrics</th>
              <th className="px-6 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {summary.runs.map(run => (
              <tr key={run.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <Link to={`/runs/${run.id}`} className="font-medium text-gray-900 hover:text-blue-600 block">
                    {run.name}
                  </Link>
                  <span className="text-xs text-gray-400 font-mono">{run.id.slice(0, 8)}</span>
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={run.status} type="TRAIN" />
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">{run.seed ?? '-'}</td>
                <td className="px-6 py-4 text-xs text-gray-600 space-y-1">
                  {Object.entries(run.metrics).slice(0, 3).map(([key, value]) => (
                    <div key={key}><span className="font-semibold">{key}</span>: {formatMetric(key, value)}</div>
                  ))}
                  {Object.keys(run.metrics).length === 0 && <span className="text-gray-400">-</span>}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{new Date(run.created).toLocaleString()}</td>
              </tr>
            ))}
            {summary.runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  No runs found in this group.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
