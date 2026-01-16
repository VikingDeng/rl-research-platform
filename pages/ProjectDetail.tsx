import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Project, Run, JobStatus } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { Layers, Clock, Activity, ArrowLeft, Plus, BarChart2, CheckSquare, Square, Trash2 } from 'lucide-react';
import { useToast } from '../components/Toast';

export const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  
  // Selection State
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (id) {
        api.getProjectById(id).then(setProject);
        api.getRuns().then(allRuns => setRuns(allRuns.filter(r => r.projectId === id)));
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

  const handleDeleteProject = () => {
      if (!project) return;
      if (!window.confirm(`Delete project "${project.name}" and all related runs/jobs?`)) {
          return;
      }
      api
        .deleteProject(project.id)
        .then(() => {
          showToast(`Deleted project "${project.name}".`, 'success');
          navigate('/');
        })
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to delete project: ${detail}`, 'error');
        });
  }

  if (!project) return <div>Loading...</div>;

  return (
    <div className="space-y-6 relative pb-20">
      <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link to="/" className="hover:text-blue-600 flex items-center"><ArrowLeft className="w-3 h-3 mr-1"/> Back to Dashboard</Link>
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex justify-between items-start">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{project.name}</h1>
                <p className="text-gray-600 max-w-2xl">{project.description}</p>
                <div className="flex gap-2 mt-4">
                    {project.tags.map(t => (
                        <span key={t} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium border border-gray-200">
                            #{t}
                        </span>
                    ))}
                </div>
            </div>
            <div className="flex items-center gap-2">
                <Link to="/create-job" className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center hover:bg-blue-700 shadow-sm">
                    <Plus className="w-4 h-4 mr-2" /> New Experiment
                </Link>
                <button
                  onClick={handleDeleteProject}
                  className="px-4 py-2 border border-red-200 text-red-700 rounded-lg flex items-center hover:bg-red-50 shadow-sm"
                >
                    <Trash2 className="w-4 h-4 mr-2" /> Delete Project
                </button>
            </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8 pt-6 border-t border-gray-100">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <Activity className="w-5 h-5" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">Total Runs</div>
                    <div className="text-xl font-bold text-gray-900">{project.totalRuns}</div>
                </div>
            </div>
             <div className="flex items-center gap-3">
                <div className="p-2 bg-green-50 text-green-600 rounded-lg">
                    <Layers className="w-5 h-5" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">Active Jobs</div>
                    <div className="text-xl font-bold text-gray-900">{project.activeRuns}</div>
                </div>
            </div>
             <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                    <Clock className="w-5 h-5" />
                </div>
                <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold">Last Updated</div>
                    <div className="text-sm font-bold text-gray-900">{new Date(project.updatedAt).toLocaleDateString()}</div>
                </div>
            </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Experiments & Runs</h2>
            <div className="text-xs text-gray-500">
                {selectedRunIds.size} selected
            </div>
        </div>
        <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs text-gray-500 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3 w-10">
                    <button onClick={toggleSelectAll} className="text-gray-400 hover:text-gray-600">
                        {selectedRunIds.size === runs.length && runs.length > 0 ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5" />}
                    </button>
                </th>
                <th className="px-6 py-3">Run Name</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Algo / Env</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((run) => (
                <tr key={run.id} className={`hover:bg-gray-50 transition-colors ${selectedRunIds.has(run.id) ? 'bg-blue-50/30' : ''}`}>
                  <td className="px-6 py-4">
                      <button onClick={() => toggleSelect(run.id)} className="text-gray-400 hover:text-gray-600">
                          {selectedRunIds.has(run.id) ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5" />}
                      </button>
                  </td>
                  <td className="px-6 py-4">
                    <Link to={`/runs/${run.id}`} className="font-medium text-blue-600 hover:underline">
                        {run.name}
                    </Link>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">{run.id}</div>
                  </td>
                  <td className="px-6 py-4"><StatusBadge type={run.type} /></td>
                  <td className="px-6 py-4"><StatusBadge status={run.status} /></td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    <div className="font-medium">{run.algo}</div>
                    <div className="text-xs text-gray-400">{run.env}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{new Date(run.created).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-sm">
                      <Link to={`/runs/${run.id}`} className="text-gray-500 hover:text-blue-600 font-medium">View</Link>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                  <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                          No runs found for this project.
                      </td>
                  </tr>
              )}
            </tbody>
          </table>
      </div>

      {/* Bulk Action Bar */}
      {selectedRunIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-6 animate-in slide-in-from-bottom duration-200 z-50">
              <span className="font-medium text-sm">{selectedRunIds.size} runs selected</span>
              <div className="h-4 w-px bg-gray-700"></div>
              <button 
                onClick={handleCompare}
                className="flex items-center text-sm font-bold text-blue-400 hover:text-blue-300"
              >
                  <BarChart2 className="w-4 h-4 mr-2" /> Compare
              </button>
              <button 
                onClick={() => setSelectedRunIds(new Set())}
                className="text-gray-400 hover:text-gray-200 text-sm"
              >
                  Clear
              </button>
          </div>
      )}
    </div>
  );
};
