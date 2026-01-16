import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { JobStatus, Run } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { Cpu, Server, Clock } from 'lucide-react';

export const JobQueue: React.FC = () => {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    api.getRuns().then(setRuns);
  }, []);

  const activeRuns = runs.filter(r => r.status === JobStatus.RUNNING);
  const pendingRuns = runs.filter(r => r.status === JobStatus.PENDING);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cluster & Queue</h1>
        <p className="text-gray-500 mt-1">Monitor GPU resources and manage job scheduling.</p>
      </div>

      {/* Active Runs */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Server className="w-5 h-5 mr-2 text-gray-500" /> Active Runs
            </h2>
            <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium border border-green-200">
                {activeRuns.length} running
            </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
            {activeRuns.map(run => (
              <div key={run.id} className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-900 truncate">{run.name}</div>
                      <StatusBadge status={run.status} type={run.type} />
                  </div>
                  <div className="mt-2 text-xs text-gray-500 font-mono">{run.id}</div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
                      <Cpu className="w-3 h-3" /> {run.gpu ?? 0} GPU
                  </div>
              </div>
            ))}
            {activeRuns.length === 0 && (
              <div className="col-span-full h-32 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  <Cpu className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-sm">No active runs</span>
              </div>
            )}
        </div>
      </div>

      {/* Pending Queue */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
             <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Clock className="w-5 h-5 mr-2 text-gray-500" /> Pending Jobs
            </h2>
            <span className="text-sm text-gray-500">{pendingRuns.length} jobs waiting</span>
        </div>
        <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs text-gray-500 font-semibold uppercase tracking-wider">
                <tr>
                    <th className="px-6 py-3">Rank</th>
                    <th className="px-6 py-3">Run</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Resources</th>
                    <th className="px-6 py-3">Created</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {pendingRuns.map((run, idx) => (
                    <tr key={run.id} className="hover:bg-gray-50 group">
                        <td className="px-6 py-4 font-mono text-gray-500 text-sm">#{idx + 1}</td>
                        <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{run.name}</div>
                            <div className="text-xs text-gray-400 font-mono">{run.id}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">{run.type}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{run.gpu ?? 0} GPU</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{new Date(run.created).toLocaleString()}</td>
                    </tr>
                ))}
                {pendingRuns.length === 0 && (
                  <tr>
                    <td className="px-6 py-6 text-sm text-gray-400" colSpan={5}>
                      No pending runs.
                    </td>
                  </tr>
                )}
            </tbody>
        </table>
      </div>
    </div>
  );
};
