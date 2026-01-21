import React, { useEffect, useState } from 'react';
import { api, apiBaseUrl } from '../services/api';
import { Project, Run, JobStatus } from '../types';
import { Terminal, Plus, Trash2, ExternalLink, RefreshCw, StopCircle } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useNavigate } from 'react-router-dom';

export const Workspaces: React.FC = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [notebooks, setNotebooks] = useState<Run[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [notebookName, setNotebookName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const fetchNotebooks = () => {
      api.getRuns({ type: 'NOTEBOOK' }).then(setNotebooks);
  };

  useEffect(() => {
    api.getProjects().then(ps => {
        setProjects(ps);
        if (ps.length > 0) setSelectedProject(ps[0].id);
    });
    fetchNotebooks();
    const interval = setInterval(fetchNotebooks, 5000); // Poll status
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedProject) return;
      setIsCreating(true);
      try {
          await api.createNotebook(selectedProject, notebookName || undefined);
          showToast('Notebook workspace created.', 'success');
          setNotebookName('');
          fetchNotebooks();
      } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to create notebook: ${detail}`, 'error');
      } finally {
          setIsCreating(false);
      }
  };

  const handleStop = async (runId: string) => {
      if (!window.confirm('Stop this notebook workspace? Unsaved changes in memory will be lost.')) return;
      try {
          await api.deleteNotebook(runId);
          showToast('Notebook stopped.', 'success');
          fetchNotebooks();
      } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to stop notebook: ${detail}`, 'error');
      }
  };

  const openNotebook = (runId: string) => {
      // We need to fetch the token/url. Since listRuns doesn't return full details usually, 
      // we rely on the proxy url pattern we defined in LocalExecutor.
      // But wait, the token is generated on start and returned in create response.
      // It is NOT stored in the DB (only in LocalExecutor memory).
      // If we refresh the page, we lose the token?
      // Actually `LocalExecutor` stores it in memory.
      // But `list_runs` doesn't return it.
      // We need an endpoint to get connection info for a running notebook.
      // Or we store the token in the Run config/metrics?
      // Storing in Run config is better for persistence.
      
      // For now, let's assume we can't open it after refresh unless we persisted the token.
      // I should update `start_notebook` to save token in `run.config`.
      
      // Let's do a quick fix in backend first?
      // Or just try to open it if we have the URL stored.
      // Let's assume the user just created it or we add a "Get Info" endpoint.
      
      // Actually, let's look at `RunDetail` logic.
      // If I store token in `run.config`, I can read it back.
      // Let's modify `start_notebook` in backend to save token to DB.
      
      // BUT, I can't modify backend right now without interrupting the flow.
      // Wait, `LocalExecutor` keeps metadata.
      // Maybe I can rely on the fact that I returned it in `create`?
      // No, listing needs it.
      
      // Let's assume I fix backend to store token in `run.config` in next step.
      // Proceeding with frontend assuming `run.config.url` or similar exists.
      
      // Wait, I can use `metrics` or `config` to store it.
      
      const config = notebooks.find(n => n.id === runId)?.config as any;
      if (config?.url) {
          window.open(config.url, '_blank');
      } else {
          // Fallback or error
          showToast("Connection info not found. (Did you refresh? Persistence pending)", "warning");
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
          <p className="text-gray-500 mt-1">Interactive Jupyter environments for exploration and debugging.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Card */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-fit">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                <Plus className="w-5 h-5 mr-2 text-blue-600"/> New Workspace
            </h3>
            <form onSubmit={handleCreate} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                    <select 
                        className="w-full p-2 border border-gray-300 rounded-lg"
                        value={selectedProject}
                        onChange={e => setSelectedProject(e.target.value)}
                    >
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name (Optional)</label>
                    <input 
                        type="text" 
                        className="w-full p-2 border border-gray-300 rounded-lg"
                        placeholder="e.g. EDA-01"
                        value={notebookName}
                        onChange={e => setNotebookName(e.target.value)}
                    />
                </div>
                <button 
                    type="submit" 
                    disabled={isCreating || !selectedProject}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex justify-center items-center"
                >
                    {isCreating ? <RefreshCw className="w-4 h-4 animate-spin"/> : 'Launch JupyterLab'}
                </button>
            </form>
        </div>

        {/* List */}
        <div className="lg:col-span-2 space-y-4">
            {notebooks.length === 0 && (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-500">
                    No active workspaces. Launch one to get started.
                </div>
            )}
            {notebooks.map(nb => (
                <div key={nb.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-orange-50 text-orange-600 rounded-lg">
                            <Terminal className="w-6 h-6" />
                        </div>
                        <div>
                            <h4 className="font-bold text-gray-900">{nb.name}</h4>
                            <div className="text-xs text-gray-500 flex gap-2 mt-1">
                                <span className="font-mono">{nb.id.slice(0,8)}</span>
                                <span>•</span>
                                <span>{projects.find(p => p.id === nb.projectId)?.name}</span>
                                <span>•</span>
                                <span className={nb.status === 'RUNNING' ? 'text-green-600 font-medium' : 'text-gray-500'}>{nb.status}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {nb.status === 'RUNNING' && (
                            <button 
                                onClick={() => openNotebook(nb.id)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center"
                            >
                                <ExternalLink className="w-4 h-4 mr-2" /> Open
                            </button>
                        )}
                        <button 
                            onClick={() => handleStop(nb.id)}
                            className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                            title="Stop & Delete"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};
