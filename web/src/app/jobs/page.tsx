'use client';

import { Activity, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function JobQueue() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.getRuns(),
  });

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'RUNNING': return <Activity className="w-4 h-4 text-blue-500" />;
      case 'QUEUED': return <Clock className="w-4 h-4 text-gray-400" />;
      case 'COMPLETED': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'FAILED': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">任务队列 (Runs)</h1>
          <p className="text-gray-500 text-sm mt-1">管理和监控整个集群中的训练任务进度。</p>
        </div>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors">
          提交新任务
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-500">
            <tr>
              <th className="px-6 py-3 font-medium">状态</th>
              <th className="px-6 py-3 font-medium">任务名称</th>
              <th className="px-6 py-3 font-medium">算法引擎</th>
              <th className="px-6 py-3 font-medium">创建时间</th>
              <th className="px-6 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : runs.length === 0 ? (
               <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">暂无任务记录。</td></tr>
            ) : runs.map((run: any) => (
              <tr key={run.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={run.status} />
                    <span className="capitalize text-gray-700 font-medium">{run.status.toLowerCase()}</span>
                  </div>
                </td>
                <td className="px-6 py-4 font-medium text-gray-900">{run.name || `Run-${run.id.substring(0,6)}`}</td>
                <td className="px-6 py-4">
                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium border border-gray-200">
                    {run.algo?.algo_id || 'Unknown'}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-500">{new Date(run.created_at).toLocaleString()}</td>
                <td className="px-6 py-4 text-right">
                  <button className="text-blue-600 hover:text-blue-800 font-medium text-sm">查看详情</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
