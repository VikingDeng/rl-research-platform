import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { SystemResources } from '../types';
import { Cpu, HardDrive, Zap, Activity, Fan, Wind, Layers } from 'lucide-react';

export const ClusterMonitor: React.FC = () => {
  const [resources, setResources] = useState<SystemResources | null>(null);
  const [expandedGpu, setExpandedGpu] = useState<number | null>(null);
  const extra = resources as any;

  const formatBytes = (value: number) => {
    if (!value || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let idx = 0;
    let val = value;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx += 1;
    }
    return `${val.toFixed(1)} ${units[idx]}`;
  };

  useEffect(() => {
    const fetch = () => api.getSystemResources().then(setResources).catch(() => null);
    fetch();
    const interval = setInterval(fetch, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!resources) return <div className="text-xs text-gray-400">Loading metrics...</div>;

  return (
    <div className="space-y-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                    <Cpu className="w-6 h-6" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">CPU Usage</div>
                    <div className="text-xl font-bold text-gray-900">{resources.cpuPercent.toFixed(0)}%</div>
                    <div className="text-xs text-gray-400">{extra?.cpu_count || 0} cores {extra?.load_avg ? `• load ${extra.load_avg.map((v: number) => v.toFixed(1)).join(', ')}` : ''}</div>
                </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
                    <HardDrive className="w-6 h-6" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">RAM Usage</div>
                    <div className="text-xl font-bold text-gray-900">{resources.memoryPercent.toFixed(0)}%</div>
                    <div className="text-xs text-gray-400">{(resources.memoryUsed / 1024 / 1024 / 1024).toFixed(1)} / {(resources.memoryTotal / 1024 / 1024 / 1024).toFixed(1)} GB</div>
                </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
                    <HardDrive className="w-6 h-6" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">Disk Usage</div>
                    <div className="text-xl font-bold text-gray-900">{(extra?.disk_percent ?? 0).toFixed(0)}%</div>
                    <div className="text-xs text-gray-400">{formatBytes(extra?.disk_used || 0)} / {formatBytes(extra?.disk_total || 0)}</div>
                </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Activity className="w-6 h-6" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">Network IO</div>
                    <div className="text-xs text-gray-400">Sent {formatBytes(extra?.net_bytes_sent || 0)}</div>
                    <div className="text-xs text-gray-400">Recv {formatBytes(extra?.net_bytes_recv || 0)}</div>
                </div>
            </div>
            
            {resources.gpus.length > 0 ? (
                resources.gpus.map(gpu => (
                    <div 
                        key={gpu.index} 
                        className={`bg-white p-4 rounded-xl border border-gray-200 shadow-sm transition-all cursor-pointer ${expandedGpu === gpu.index ? 'ring-2 ring-blue-500' : 'hover:border-blue-300'}`}
                        onClick={() => setExpandedGpu(expandedGpu === gpu.index ? null : gpu.index)}
                    >
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-green-50 text-green-600 rounded-lg">
                                <Zap className="w-6 h-6" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center mb-1">
                                    <div className="text-xs text-gray-500 uppercase font-semibold truncate" title={gpu.name}>GPU {gpu.index}: {gpu.name.replace('NVIDIA ', '')}</div>
                                    <div className="text-xs text-gray-400">{Math.round(gpu.temperature)}°C</div>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div className="text-xl font-bold text-gray-900">{Math.round(gpu.utilizationGpu)}%</div>
                                    <div className="text-xs text-gray-500 mb-1 flex gap-2">
                                        {gpu.power_draw && <span className="flex items-center" title="Power Draw"><Zap className="w-3 h-3 mr-0.5"/> {(gpu.power_draw / 1000).toFixed(0)}W</span>}
                                        {gpu.fan_speed && <span className="flex items-center" title="Fan Speed"><Wind className="w-3 h-3 mr-0.5"/> {Math.round(gpu.fan_speed)}%</span>}
                                    </div>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2 overflow-hidden">
                                    <div 
                                        className="bg-green-600 h-1.5 rounded-full transition-all duration-500" 
                                        style={{ width: `${(gpu.memoryUsed / gpu.memoryTotal) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Detailed Process View (Collapsible) */}
                        {expandedGpu === gpu.index && gpu.processes && gpu.processes.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-gray-100 animate-in slide-in-from-top-2 fade-in">
                                <div className="text-xs font-semibold text-gray-500 mb-2 flex items-center">
                                    <Layers className="w-3 h-3 mr-1"/> Active Processes
                                </div>
                                <div className="space-y-1">
                                    {gpu.processes.map(p => (
                                        <div key={p.pid} className="flex justify-between text-xs items-center bg-gray-50 px-2 py-1 rounded">
                                            <div className="flex items-center gap-2 truncate">
                                                <span className="font-mono text-gray-400">{p.pid}</span>
                                                <span className="text-gray-700 font-medium truncate max-w-[120px]">{p.process_name}</span>
                                            </div>
                                            <div className="text-gray-500">{(p.memory_used / 1024 / 1024).toFixed(0)} MiB</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))
            ) : (
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4 opacity-50">
                    <div className="p-3 bg-gray-50 text-gray-400 rounded-lg">
                        <Activity className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="text-xs text-gray-500 uppercase font-semibold">GPU Status</div>
                        <div className="text-sm font-bold text-gray-900">No GPU Detected</div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
};
