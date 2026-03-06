'use client';

import { useState, useEffect, useRef } from 'react';
import { Activity, Cpu, CheckCircle2, AlertCircle, X, Terminal } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const LogModal = ({ runId, onClose }: { runId: string, onClose: () => void }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Assuming backend is at localhost:8000 for local dev
    // In production, might need to dynamically get WS URL based on window.location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' ? 'localhost:8000' : window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/runs/${runId}/logs/stream`;
    
    const ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
      setLogs((prev) => [...prev, event.data]);
    };

    return () => {
      ws.close();
    };
  }, [runId]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-[#1e1e1e] w-full max-w-4xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-[#252526]">
          <div className="flex items-center gap-3 text-gray-300">
            <Terminal className="w-5 h-5 text-blue-400" />
            <h2 className="font-medium font-mono text-sm">Real-time Logs: {runId}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Log Content */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs md:text-sm text-green-400/90 leading-relaxed bg-[#1e1e1e]">
          {logs.length === 0 ? (
            <div className="text-gray-500 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
              Waiting for log stream...
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="hover:bg-white/5 px-2 py-0.5 rounded transition-colors break-all">
                {log}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};

export default function Dashboard() {
  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.getRuns(),
  });

  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.getModels(),
  });

  const [activeLogRunId, setActiveLogRunId] = useState<string | null>(null);

  const activeRuns = runs.filter((r: any) => r.status === 'RUNNING');
  const completedRuns = runs.filter((r: any) => r.status === 'COMPLETED');
  const failedRuns = runs.filter((r: any) => r.status === 'FAILED');

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 relative">
      
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
                    <button 
                      onClick={() => setActiveLogRunId(run.id)}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 shadow-sm">
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

      {activeLogRunId && (
        <LogModal 
          runId={activeLogRunId} 
          onClose={() => setActiveLogRunId(null)} 
        />
      )}
    </div>
  );
}