'use client';

import { useState } from 'react';
import { Activity, Clock, CheckCircle2, XCircle, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function JobQueue() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.getRuns(),
  });

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [env, setEnv] = useState('CartPole-v1');
  const [algo, setAlgo] = useState('PPO');
  const [gpu, setGpu] = useState('0');

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'RUNNING': return <Activity className="w-4 h-4 text-blue-500" />;
      case 'QUEUED': return <Clock className="w-4 h-4 text-gray-400" />;
      case 'COMPLETED': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'FAILED': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const handleSubmitJob = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.submitDemoJob({ env, algo, gpu });
      // Reload page to fetch new runs (or invalidate query via queryClient if configured)
      window.location.reload(); 
      setIsDrawerOpen(false);
    } catch (err) {
      console.error("Failed to submit job:", err);
      alert("Failed to submit job.");
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 relative overflow-hidden min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">任务队列 (Runs)</h1>
          <p className="text-gray-500 text-sm mt-1">管理和监控整个集群中的训练任务进度。</p>
        </div>
        <button 
          onClick={() => setIsDrawerOpen(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors">
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

      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm transition-opacity">
          <div className="w-96 bg-white h-full shadow-2xl flex flex-col transform transition-transform">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-semibold text-gray-900">提交新任务</h2>
              <button onClick={() => setIsDrawerOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmitJob} className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">环境 (Environment)</label>
                <select value={env} onChange={e => setEnv(e.target.value)} className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="CartPole-v1">CartPole-v1</option>
                  <option value="HalfCheetah-v4">HalfCheetah-v4</option>
                  <option value="StarCraft2">StarCraft II</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">算法 (Algorithm)</label>
                <select value={algo} onChange={e => setAlgo(e.target.value)} className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="PPO">PPO (Proximal Policy Optimization)</option>
                  <option value="SAC">SAC (Soft Actor-Critic)</option>
                  <option value="MAPPO">MAPPO (Multi-Agent PPO)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">GPU 资源分配</label>
                <select value={gpu} onChange={e => setGpu(e.target.value)} className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="0">0 (CPU Only)</option>
                  <option value="1">1 GPU</option>
                  <option value="2">2 GPUs</option>
                  <option value="4">4 GPUs</option>
                </select>
              </div>
            </form>

            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button type="button" onClick={() => setIsDrawerOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
              <button onClick={handleSubmitJob} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">提交任务</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}