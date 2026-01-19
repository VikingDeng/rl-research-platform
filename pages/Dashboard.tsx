import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Project, Run, JobStatus } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { Play, Cpu, Activity, Clock, ArrowRight, Plus, FolderOpen, Trash2, Calendar, X, GitFork } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // New Project Form State
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectGitRepo, setNewProjectGitRepo] = useState('');
  const [newProjectGitBranch, setNewProjectGitBranch] = useState('main');

  useEffect(() => {
    api.getProjects().then(setProjects);
    api.getRuns().then(setRuns);
    const state = location.state as { openCreateProject?: boolean } | null;
    if (state?.openCreateProject) {
      setIsModalOpen(true);
    }
  }, [location.state]);

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    api.createProject({ 
        name: newProjectName.trim(), 
        description: newProjectDescription.trim() || undefined,
        gitRepo: newProjectGitRepo.trim() || undefined,
        gitBranch: newProjectGitBranch.trim() || undefined
    })
      .then(project => {
        setProjects(prev => [project, ...prev]);
        setIsModalOpen(false);
        setNewProjectName('');
        setNewProjectDescription('');
        setNewProjectGitRepo('');
        setNewProjectGitBranch('main');
        navigate(`/projects/${project.id}`);
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to create project: ${detail}`, 'error');
      });
  };

  const handleDeleteProject = (project: Project) => {
    if (!window.confirm(`Delete project "${project.name}" and all related runs/jobs?`)) {
      return;
    }
    api
      .deleteProject(project.id)
      .then(() => {
        setProjects(prev => prev.filter(p => p.id !== project.id));
        setRuns(prev => prev.filter(r => r.projectId !== project.id));
        showToast(`Deleted project "${project.name}".`, 'success');
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to delete project: ${detail}`, 'error');
      });
  };

  const activeJobs = runs.filter(r => r.status === JobStatus.RUNNING).length;
  const totalGpus = runs.reduce((acc, r) => r.status === JobStatus.RUNNING ? acc + r.gpu : acc, 0);

  // Get recent runs (sorted by created date desc)
  const recentRuns = [...runs].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()).slice(0, 5);

  return (
    <div className="space-y-8 relative">
      <div className="flex justify-between items-center">
        <div>
           <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
           <p className="text-gray-500 mt-1">Overview of your research projects and compute resources.</p>
        </div>
        <div className="flex gap-3">
             <button 
                onClick={() => setIsModalOpen(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center hover:bg-blue-700 font-medium shadow-sm transition-colors"
            >
                <Plus className="w-4 h-4 mr-2" /> New Project
            </button>
            <span className="px-3 py-1 bg-white border border-gray-200 rounded-md text-xs font-medium text-gray-500 shadow-sm flex items-center">
                Cluster: <span className="text-green-500 ml-1">● Online</span>
            </span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Active Jobs</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{activeJobs}</h3>
            </div>
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <Activity className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">GPU Utilization</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{totalGpus} / 4</h3>
            </div>
            <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
              <Cpu className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
            <div className="bg-purple-600 h-1.5 rounded-full" style={{ width: `${(totalGpus/4)*100}%` }}></div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Projects</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{projects.length}</h3>
            </div>
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <Play className="w-5 h-5" />
            </div>
          </div>
        </div>

         <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Avg Wait Time</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">2m 14s</h3>
            </div>
            <div className="p-2 bg-orange-50 rounded-lg text-orange-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                <FolderOpen className="w-5 h-5 mr-2 text-gray-500" /> Your Projects
            </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map(p => (
                <Link key={p.id} to={`/projects/${p.id}`} className="group block">
                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md hover:border-blue-300 transition-all h-full flex flex-col">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2 bg-gray-50 text-gray-600 rounded-lg group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                                <FolderOpen className="w-6 h-6" />
                            </div>
                            <button
                                className="text-gray-400 hover:text-red-600"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleDeleteProject(p);
                                }}
                                aria-label="Delete project"
                                title="Delete project"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-blue-700">{p.name}</h3>
                        <p className="text-sm text-gray-600 mb-4 line-clamp-2 flex-1">{p.description}</p>
                        
                        <div className="flex flex-wrap gap-2 mb-4">
                            {p.tags.map(tag => (
                                <span key={tag} className="px-2 py-1 bg-gray-50 text-gray-500 text-xs rounded border border-gray-100">
                                    #{tag}
                                </span>
                            ))}
                        </div>
                        
                        <div className="pt-4 border-t border-gray-50 flex items-center justify-between text-xs text-gray-500">
                            <div className="flex items-center">
                                <Activity className="w-3 h-3 mr-1" /> {p.activeRuns} Active
                            </div>
                            <div className="flex items-center">
                                <Calendar className="w-3 h-3 mr-1" /> {new Date(p.updatedAt).toLocaleDateString()}
                            </div>
                        </div>
                    </div>
                </Link>
            ))}
             <button onClick={() => setIsModalOpen(true)} className="border-2 border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-all min-h-[200px]">
                <Plus className="w-8 h-8 mb-2" />
                <span className="font-medium">Create New Project</span>
            </button>
        </div>
      </div>

      {/* Recent Runs Table */}
      <div>
        <div className="flex items-center justify-between mb-4">
             <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                <Activity className="w-5 h-5 mr-2 text-gray-500" /> Recent Runs
            </h2>
            <Link to="/compare" className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center">
                View All Runs <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-gray-50 text-xs text-gray-500 font-semibold uppercase">
                    <tr>
                        <th className="px-6 py-3">Run Name</th>
                        <th className="px-6 py-3">Project</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3">Algorithm</th>
                        <th className="px-6 py-3">Duration</th>
                        <th className="px-6 py-3">Created</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {recentRuns.map(run => (
                        <tr key={run.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4">
                                <Link to={`/runs/${run.id}`} className="font-medium text-gray-900 hover:text-blue-600 block">
                                    {run.name}
                                </Link>
                                <span className="text-xs text-gray-400 font-mono">{run.id}</span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                                {projects.find(p => p.id === run.projectId)?.name || run.projectId}
                            </td>
                            <td className="px-6 py-4">
                                <StatusBadge status={run.status} type={run.type} />
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">{run.algo}</td>
                            <td className="px-6 py-4 text-sm text-gray-500 font-mono">{run.duration}</td>
                            <td className="px-6 py-4 text-sm text-gray-500">{new Date(run.created).toLocaleDateString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
      </div>

       {/* Create Modal */}
       {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-900">Create New Project</h2>
                    <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleCreateProject} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
                        <input 
                            type="text" 
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            placeholder="e.g., My New Experiment"
                            value={newProjectName}
                            onChange={e => setNewProjectName(e.target.value)}
                        />
                    </div>
                    <div>
                         <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                         <textarea 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 resize-none"
                            placeholder="Brief description of the research goal..."
                            value={newProjectDescription}
                            onChange={e => setNewProjectDescription(e.target.value)}
                        />
                    </div>
                    
                    <div className="pt-2 border-t border-gray-100">
                        <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                            <GitFork className="w-4 h-4"/> Git Integration (Optional)
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2">
                                <label className="block text-xs font-medium text-gray-500 mb-1">Repository URL</label>
                                <input 
                                    type="text" 
                                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                                    placeholder="https://github.com/user/repo.git"
                                    value={newProjectGitRepo}
                                    onChange={e => setNewProjectGitRepo(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Default Branch</label>
                                <input 
                                    type="text" 
                                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                                    placeholder="main"
                                    value={newProjectGitBranch}
                                    onChange={e => setNewProjectGitBranch(e.target.value)}
                                />
                            </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                            Linking a repo allows you to run code directly from Git branches/commits without rebuilding Docker images.
                        </p>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create Project</button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};
