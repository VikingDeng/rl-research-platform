'use client';

import { Activity, Cpu, CheckCircle2, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function Dashboard() {
  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.getRuns(),
  });

  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.getModels(),
  });

  const activeRuns = runs.filter((r: any) => r.status === 'RUNNING');
  const completedRuns = runs.filter((r: any) => r.status === 'COMPLETED');
  const failedRuns = runs.filter((r: any) => r.status === 'FAILED');

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-gray-900">仪表盘</h1>
        <p className="text-gray-500 text-sm">您的强化学习集群和活动训练任务的概览。</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: '运行中的任务', value: runsLoading ? '-' : activeRuns.length, icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: '已完成', value: runsLoading ? '-' : completedRuns.length, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: '失败的任务', value: runsLoading ? '-' : failedRuns.length, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: '注册的模型数', value: models.length || '-', icon: Cpu, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
            <div className={`p-3 rounded-lg ${stat.bg}`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-sm font-medium text-gray-500">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Active Jobs List */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">运行中的任务 (Runs)</h2>
            <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">查看全部</button>
          </div>
          <div className="divide-y divide-gray-100 flex-1">
            {activeRuns.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">当前没有运行中的任务。</div>
            ) : (
              activeRuns.slice(0, 5).map((run: any) => (
                <div key={run.id} className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <div>
                      <div className="font-medium text-gray-900">{run.name || `Run ${run.id.substring(0, 8)}`}</div>
                      <div className="text-xs text-gray-500 mt-1">Started: {new Date(run.created_at).toLocaleString()} • {run.algo?.algo_id || 'Unknown Algo'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="px-3 py-1.5 bg-white border border-gray-200 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 shadow-sm">
                      日志
                    </button>
                    <button className="px-3 py-1.5 bg-white border border-gray-200 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 shadow-sm">
                      TensorBoard
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Cluster Status */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">集群状态</h2>
          </div>
          <div className="p-5 space-y-6">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium text-gray-700">CPU 使用率</span>
                <span className="text-gray-500">模拟 78%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: '78%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium text-gray-700">GPU 占用 (A100)</span>
                <span className="text-gray-500">模拟 14 / 16</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-purple-500 h-2 rounded-full" style={{ width: '87%' }}></div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
