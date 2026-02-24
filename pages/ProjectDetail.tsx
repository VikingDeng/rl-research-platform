import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, isDemoMode } from '../services/api';
import { Project, Run } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { Layers, Clock, Activity, ArrowLeft, Plus, BarChart2, CheckSquare, Square, Trash2 } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useI18n } from '../services/i18n';

export const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { tx } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  
  // Selection State
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (id) {
        api.getProjectById(id).then(setProject);
        // Use server-side filtering and fetch more items if needed, or implement pagination here.
        // For now, let's fetch a larger page size to be safe, or just use the projectId filter.
        api.getRuns({ projectId: id, pageSize: 100 }).then(setRuns);
        localStorage.setItem('last_project_id', id);
    }
  }, [id]);

  const toggleSelect = (runId: string) => {
      const newSet = new Set(selectedRunIds);
      if (newSet.has(runId)) {
          newSet.delete(runId);
      } else {
          newSet.add(runId);
      }
      setSelectedRunIds(newSet);
  }

  const toggleSelectAll = () => {
      if (selectedRunIds.size === runs.length) {
          setSelectedRunIds(new Set());
      } else {
          setSelectedRunIds(new Set(runs.map(r => r.id)));
      }
  }

  const handleCompare = () => {
      const ids = Array.from(selectedRunIds).join(',');
      navigate(`/compare?runs=${ids}`);
  }

  const handleDeleteRuns = () => {
      const ids = Array.from(selectedRunIds);
      if (ids.length === 0) return;
      if (!window.confirm(tx(`确认删除 ${ids.length} 个已选运行吗？此操作不可撤销。`, `Delete ${ids.length} selected runs? This cannot be undone.`))) {
          return;
      }
      api.deleteRunsBatch(ids).then(() => {
          setRuns(prev => prev.filter(r => !selectedRunIds.has(r.id)));
          setSelectedRunIds(new Set());
          showToast(tx(`已删除 ${ids.length} 个运行。`, `Deleted ${ids.length} runs.`), 'success');
      }).catch(err => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`${tx('删除运行失败', 'Failed to delete runs')}: ${detail}`, 'error');
      });
  }

  const handleDeleteSingleRun = (runId: string) => {
      if (!window.confirm(tx('确认删除此运行吗？此操作不可撤销。', 'Delete this run? This cannot be undone.'))) return;
      api.deleteRun(runId).then(() => {
          setRuns(prev => prev.filter(r => r.id !== runId));
          if (selectedRunIds.has(runId)) {
              const next = new Set(selectedRunIds);
              next.delete(runId);
              setSelectedRunIds(next);
          }
          showToast(tx('运行已删除。', 'Run deleted.'), 'success');
      }).catch(err => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`${tx('删除运行失败', 'Failed to delete run')}: ${detail}`, 'error');
      });
  }

  const handleDeleteProject = () => {
      if (!project) return;
      if (!window.confirm(tx(`确认删除项目「${project.name}」及其所有关联 runs/jobs 吗？`, `Delete project "${project.name}" and all related runs/jobs?`))) {
          return;
      }
      api.deleteProject(project.id).then(() => {
          showToast(tx(`已删除项目「${project.name}」。`, `Deleted project "${project.name}".`), 'success');
          navigate('/');
      }).catch(err => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`${tx('删除项目失败', 'Failed to delete project')}: ${detail}`, 'error');
      });
  }

  if (!project) return <div>{tx('加载中...', 'Loading...')}</div>;
  const projectTags = Array.isArray(project.tags) ? project.tags : [];

  return (
    <div className="space-y-6 relative pb-20">
      <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link to="/" className="hover:text-blue-600 flex items-center"><ArrowLeft className="w-3 h-3 mr-1"/> {tx('返回仪表盘', 'Back to Dashboard')}</Link>
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex justify-between items-start">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{project.name}</h1>
                <p className="text-gray-600 max-w-2xl">{project.description || tx('暂无描述。', 'No description provided.')}</p>
                <div className="flex gap-2 mt-4">
                    {projectTags.map(t => (
                        <span key={t} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium border border-gray-200">
                            #{t}
                        </span>
                    ))}
                </div>
                {isDemoMode && (
                    <span className="mt-3 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        Demo Mode
                        {tx('演示模式', 'Demo Mode')}
                    </span>
                )}
            </div>
            <div className="flex items-center gap-2">
                <Link to="/create-job" className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center hover:bg-blue-700 shadow-sm">
                    <Plus className="w-4 h-4 mr-2" /> {tx('新建实验', 'New Experiment')}
                </Link>
                <button
                  onClick={handleDeleteProject}
                  className="px-4 py-2 border border-red-200 text-red-700 rounded-lg flex items-center hover:bg-red-50 shadow-sm"
                >
                    <Trash2 className="w-4 h-4 mr-2" /> {tx('删除项目', 'Delete Project')}
                </button>
            </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8 pt-6 border-t border-gray-100">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <Activity className="w-5 h-5" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">{tx('运行总数', 'Total Runs')}</div>
                    <div className="text-xl font-bold text-gray-900">{project.totalRuns ?? 0}</div>
                </div>
            </div>
             <div className="flex items-center gap-3">
                <div className="p-2 bg-green-50 text-green-600 rounded-lg">
                    <Layers className="w-5 h-5" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">{tx('活跃任务', 'Active Jobs')}</div>
                    <div className="text-xl font-bold text-gray-900">{project.activeRuns ?? 0}</div>
                </div>
            </div>
             <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                    <Clock className="w-5 h-5" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">{tx('最近更新', 'Last Updated')}</div>
                    <div className="text-sm font-bold text-gray-900">
                        {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : '-'}
                    </div>
                </div>
            </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{tx('实验与运行', 'Experiments & Runs')}</h2>
            <div className="text-xs text-gray-500">
                {selectedRunIds.size} {tx('已选', 'selected')}
            </div>
        </div>
        <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs text-gray-500 font-semibold uppercase tracking-wider">
                    <tr>
                        <th className="px-6 py-3 w-10">
                            <button onClick={toggleSelectAll} className="text-gray-400 hover:text-gray-600">
                                {runs.length > 0 && selectedRunIds.size === runs.length
                                  ? <CheckSquare className="w-4 h-4 text-blue-600" />
                                  : <Square className="w-4 h-4" />}
                            </button>
                        </th>
                        <th className="px-6 py-3">{tx('运行名', 'Run Name')}</th>
                        <th className="px-6 py-3">{tx('分组', 'Group')}</th>
                        <th className="px-6 py-3">{tx('状态', 'Status')}</th>
                        <th className="px-6 py-3">{tx('算法 / 环境', 'Algo / Env')}</th>
                        <th className="px-6 py-3">{tx('关键指标', 'Key Metrics')}</th>
                        <th className="px-6 py-3">{tx('创建时间', 'Created')}</th>
                        <th className="px-6 py-3">{tx('操作', 'Actions')}</th>
                    </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((run) => {
                const groupId = run.groupId || (run.config as any)?.groupId;
                return (
                <tr key={run.id} className={`hover:bg-gray-50 transition-colors ${selectedRunIds.has(run.id) ? 'bg-blue-50/30' : ''}`}>
                  <td className="px-6 py-4">
                      <button onClick={() => toggleSelect(run.id)} className="text-gray-400 hover:text-gray-600">
                          {selectedRunIds.has(run.id) ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5" />}
                      </button>
                  </td>
                            <td className="px-6 py-4">
                                <Link to={`/runs/${run.id}`} className="font-medium text-gray-900 hover:text-blue-600 block">
                                    {run.name}
                                </Link>
                                <span className="text-xs text-gray-400 font-mono">{run.id.slice(0,8)}</span>
                            </td>
                            <td className="px-6 py-4">
                                {groupId ? (
                                    <Link
                                      to={`/groups/${groupId}`}
                                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-100"
                                      title={groupId}
                                    >
                                        {groupId.includes('sweep') ? tx('扫参组', 'Sweep') : tx('分组', 'Group')}
                                    </Link>
                                ) : <span className="text-gray-300">-</span>}
                            </td>
                            <td className="px-6 py-4">
                                <StatusBadge status={run.status} type={run.type} />
                            </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    <div className="font-medium">{run.algo}</div>
                    <div className="text-xs text-gray-400">{run.env}</div>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-600">
                    <div>{tx('回报', 'Return')}: <span className="font-semibold text-gray-800">{run.metrics?.returnMean?.length ? run.metrics.returnMean[run.metrics.returnMean.length - 1].value.toFixed(2) : '-'}</span></div>
                    <div>{tx('胜率', 'Win')}: <span className="font-semibold text-gray-800">{run.metrics?.winRate?.length ? `${(run.metrics.winRate[run.metrics.winRate.length - 1].value * 100).toFixed(1)}%` : '-'}</span></div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{new Date(run.created).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-sm flex gap-3">
                      <Link to={`/runs/${run.id}`} className="text-gray-500 hover:text-blue-600 font-medium">{tx('查看', 'View')}</Link>
                      <button 
                        onClick={() => handleDeleteSingleRun(run.id)}
                        className="text-gray-400 hover:text-red-600"
                        title={tx('删除运行', 'Delete Run')}
                      >
                          <Trash2 className="w-4 h-4" />
                      </button>
                  </td>
                </tr>
                  );
                })}
              {runs.length === 0 && (
                  <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                          {tx('该项目暂无运行。', 'No runs found for this project.')}
                      </td>
                  </tr>
              )}
            </tbody>
          </table>
      </div>

      {/* Bulk Action Bar */}
      {selectedRunIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-6 animate-in slide-in-from-bottom duration-200 z-50">
              <span className="font-medium text-sm">{selectedRunIds.size} {tx('个运行已选', 'runs selected')}</span>
              <div className="h-4 w-px bg-gray-700"></div>
              <button 
                onClick={handleCompare}
                className="flex items-center text-sm font-bold text-blue-400 hover:text-blue-300"
              >
                  <BarChart2 className="w-4 h-4 mr-2" /> {tx('对比', 'Compare')}
              </button>
              <button 
                onClick={handleDeleteRuns}
                className="flex items-center text-sm font-bold text-red-400 hover:text-red-300"
              >
                  <Trash2 className="w-4 h-4 mr-2" /> {tx('删除', 'Delete')}
              </button>
              <div className="h-4 w-px bg-gray-700"></div>
              <button 
                onClick={() => setSelectedRunIds(new Set())}
                className="text-gray-400 hover:text-gray-200 text-sm"
              >
                  {tx('清空', 'Clear')}
              </button>
          </div>
      )}
    </div>
  );
};
