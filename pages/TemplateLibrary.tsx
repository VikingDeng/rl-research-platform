import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Algo, AlgoVersion, Project, Template, TemplateDetail, TemplateVersion } from '../types';
import { Archive, Code, Terminal, FileJson, PlayCircle, BookOpen, Plus, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';

export const TemplateLibrary: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [selectedTemplateDetail, setSelectedTemplateDetail] = useState<TemplateDetail | null>(null);
  const [algos, setAlgos] = useState<Algo[]>([]);
  const [algoVersions, setAlgoVersions] = useState<Record<string, AlgoVersion[]>>({});
  const [selectedAlgoVersionId, setSelectedAlgoVersionId] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newType, setNewType] = useState<'Single-Agent' | 'Multi-Agent'>('Multi-Agent');
  const [newDefaultConfig, setNewDefaultConfig] = useState('{}');

  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const [newVersionConfig, setNewVersionConfig] = useState('');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDefaultConfig, setEditDefaultConfig] = useState('{}');

  useEffect(() => {
    api.getProjects().then(items => {
      setProjects(items);
      const saved = localStorage.getItem('last_project_id');
      const fallback = saved && items.some(p => p.id === saved) ? saved : items[0]?.id || '';
      setSelectedProjectId(fallback);
    });
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem('last_project_id', selectedProjectId);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setTemplates([]);
      setSelectedTemplate(null);
      return;
    }
    api.getTemplates({ projectId: selectedProjectId, includeArchived }).then(setTemplates);
  }, [selectedProjectId, includeArchived]);

  useEffect(() => {
    api.getAlgos().then(setAlgos);
  }, []);

  useEffect(() => {
    if (algos.length === 0) {
      setAlgoVersions({});
      return;
    }
    Promise.all(
      algos.map(algo =>
        api.getAlgoVersions(algo.id).then(versions => [algo.id, versions] as const),
      ),
    ).then(entries => {
      const next: Record<string, AlgoVersion[]> = {};
      entries.forEach(([algoId, versions]) => {
        next[algoId] = versions;
      });
      setAlgoVersions(next);
    });
  }, [algos]);

  useEffect(() => {
    if (!selectedTemplate) {
      setSelectedTemplateDetail(null);
      return;
    }
    api.getTemplateById(selectedTemplate.id).then(setSelectedTemplateDetail);
  }, [selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const stillExists = templates.some(t => t.id === selectedTemplate.id);
    if (!stillExists) {
      setSelectedTemplate(null);
      return;
    }
    const updated = templates.find(t => t.id === selectedTemplate.id);
    if (updated && updated !== selectedTemplate) {
      setSelectedTemplate(updated);
    }
  }, [templates, selectedTemplate]);

  const handleUseTemplate = () => {
    if (selectedTemplate) {
      navigate('/create-job', { state: { projectId: selectedProjectId, templateId: selectedTemplate.id } });
    }
  };

  const handleCreateTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      showToast('Select a project first.', 'error');
      return;
    }
    let parsedConfig: Record<string, unknown> | undefined = undefined;
    try {
      parsedConfig = newDefaultConfig.trim() ? JSON.parse(newDefaultConfig) : {};
    } catch (err) {
      showToast('Default config is not valid JSON.', 'error');
      return;
    }
    api
      .createTemplate(selectedProjectId, {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        type: newType,
        defaultConfig: parsedConfig,
      })
      .then(tmpl => {
        setTemplates(prev => [tmpl, ...prev]);
        setSelectedTemplate(tmpl);
        setIsCreateOpen(false);
        setNewName('');
        setNewDescription('');
        setNewDefaultConfig('{}');
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to create template: ${detail}`, 'error');
      });
  };

  const handleCreateVersion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;
    if (selectedTemplate.archived) {
      showToast('Archived templates cannot accept new versions.', 'error');
      return;
    }
    if (!newVersion.trim()) {
      showToast('Version is required.', 'error');
      return;
    }
    if (algoVersionOptions.length === 0) {
      showToast('Register an algorithm version before creating a template version.', 'error');
      return;
    }
    if (!selectedAlgoVersionId) {
      showToast('Select an algorithm version to link.', 'error');
      return;
    }
    let parsedConfig: Record<string, unknown> | undefined = undefined;
    try {
      parsedConfig = newVersionConfig.trim() ? JSON.parse(newVersionConfig) : undefined;
    } catch (err) {
      showToast('Version config is not valid JSON.', 'error');
      return;
    }
    api.createTemplateVersion(selectedTemplate.id, {
      version: newVersion.trim(),
      algoVersionId: selectedAlgoVersionId || undefined,
      defaultConfig: parsedConfig,
    })
      .then(() => api.getTemplateById(selectedTemplate.id))
      .then(detail => {
        setSelectedTemplateDetail(detail);
        setIsVersionOpen(false);
        setNewVersion('');
        setNewVersionConfig('');
        setSelectedAlgoVersionId('');
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to create version: ${detail}`, 'error');
      });
  };

  const openEditModal = () => {
    if (!selectedTemplate) return;
    setEditName(selectedTemplate.name || '');
    setEditDescription(selectedTemplate.description || '');
    setEditDefaultConfig(JSON.stringify(selectedTemplate.defaultConfig || {}, null, 2));
    setIsEditOpen(true);
  };

  const handleUpdateTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;
    let parsedConfig: Record<string, unknown> | undefined = undefined;
    try {
      parsedConfig = editDefaultConfig.trim() ? JSON.parse(editDefaultConfig) : {};
    } catch (err) {
      showToast('Default config is not valid JSON.', 'error');
      return;
    }
    api
      .updateTemplate(selectedTemplate.id, {
        name: editName.trim() || selectedTemplate.name,
        description: editDescription.trim() || undefined,
        defaultConfig: parsedConfig,
      })
      .then(() => api.getTemplates({ projectId: selectedProjectId, includeArchived }))
      .then(setTemplates)
      .then(() => api.getTemplateById(selectedTemplate.id))
      .then(setSelectedTemplateDetail)
      .then(() => {
        setIsEditOpen(false);
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to update template: ${detail}`, 'error');
      });
  };

  const handleArchiveTemplate = (template: Template, archived: boolean) => {
    const action = archived ? api.updateTemplate(template.id, { archived: false }) : api.archiveTemplate(template.id);
    action
      .then(() => api.getTemplates({ projectId: selectedProjectId, includeArchived }))
      .then(setTemplates)
      .then(() => (selectedTemplate ? api.getTemplateById(selectedTemplate.id).then(setSelectedTemplateDetail) : undefined))
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to ${archived ? 'restore' : 'archive'} template: ${detail}`, 'error');
      });
  };

  const handleFreezeVersion = (version: TemplateVersion) => {
    if (!selectedTemplate) return;
    api
      .freezeTemplateVersion(selectedTemplate.id, version.id)
      .then(() => api.getTemplateById(selectedTemplate.id))
      .then(setSelectedTemplateDetail)
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to freeze version: ${detail}`, 'error');
      });
  };

  const allAlgoVersions = Object.values(algoVersions).flat();
  const algoVersionById = new Map(allAlgoVersions.map(version => [version.id, version]));
  const algoVersionOptions = allAlgoVersions.slice().sort((a, b) => {
    const aKey = `${a.algoId}:${a.version}`;
    const bKey = `${b.algoId}:${b.version}`;
    return bKey.localeCompare(aKey);
  });

  const sortedVersions = (selectedTemplateDetail?.versions || []).slice().sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (aTime !== bTime) return bTime - aTime;
    return (b.version || '').localeCompare(a.version || '');
  });
  const latestVersion = sortedVersions[0];
  const selectedAlgoVersion = latestVersion?.algoVersionId
    ? allAlgoVersions.find(v => v.id === latestVersion.algoVersionId)
    : undefined;

  return (
    <div className="space-y-6 h-[calc(100vh-4rem)] flex flex-col">
       <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Template Library</h1>
          <p className="text-gray-500 mt-1">Experiment recipes that bind algorithm versions to training configs.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-gray-400">Project</span>
            <select
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
            >
              <option value="">-- Select --</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500 flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={e => setIncludeArchived(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show archived
          </label>
          <button
            onClick={() => setIsCreateOpen(true)}
            disabled={!selectedProjectId}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="w-4 h-4 mr-2" /> New Template
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
          {/* List */}
          <div className="space-y-4 overflow-y-auto pr-2">
              {templates.map(tmpl => (
                  <div 
                    key={tmpl.id} 
                    onClick={() => setSelectedTemplate(tmpl)}
                    className={`p-5 rounded-xl border cursor-pointer transition-all hover:shadow-md ${
                        selectedTemplate?.id === tmpl.id 
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' 
                        : 'bg-white border-gray-200'
                    }`}
                  >
                      <div className="flex justify-between items-start mb-2">
                          <h3 className="font-bold text-gray-900">{tmpl.name}</h3>
                          <div className="flex gap-2 items-center">
                            {tmpl.archived && (
                              <span className="px-2 py-1 rounded text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200">
                                Archived
                              </span>
                            )}
                            <span className={`px-2 py-1 rounded text-xs font-bold ${tmpl.type === 'Multi-Agent' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                                  {tmpl.type}
                            </span>
                          </div>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">{tmpl.description}</p>
                      <div className="mt-4 flex items-center text-xs text-gray-500 font-mono">
                          <Code className="w-3 h-3 mr-1" /> {tmpl.id}
                      </div>
                  </div>
              ))}
          </div>

          {/* Detail View */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
              {selectedTemplate ? (
                  <>
                    <div className="p-6 border-b border-gray-100 flex justify-between items-start">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <h2 className="text-xl font-bold text-gray-900">{selectedTemplate.name}</h2>
                                {selectedTemplate.archived && (
                                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-mono border border-gray-200">
                                    archived
                                  </span>
                                )}
                                <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-mono border border-gray-200">
                                  {latestVersion ? `v${latestVersion.version}` : 'no version'}
                                </span>
                            </div>
                            <p className="text-gray-600">{selectedTemplate.description}</p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                              onClick={() => {
                                setIsVersionOpen(true);
                                if (!selectedAlgoVersionId && algoVersionOptions.length > 0) {
                                  setSelectedAlgoVersionId(algoVersionOptions[0].id);
                                }
                              }}
                              disabled={selectedTemplate.archived}
                              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center font-medium shadow-sm transition-colors"
                          >
                              <Plus className="w-4 h-4 mr-2" /> New Version
                          </button>
                          <button 
                              onClick={handleUseTemplate}
                              disabled={selectedTemplate.archived}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center font-medium shadow-sm transition-colors"
                          >
                              <PlayCircle className="w-4 h-4 mr-2" /> Use Template
                          </button>
                          <button
                            onClick={openEditModal}
                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center font-medium shadow-sm transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleArchiveTemplate(selectedTemplate, !!selectedTemplate.archived)}
                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center font-medium shadow-sm transition-colors"
                          >
                            <Archive className="w-4 h-4 mr-2" />
                            {selectedTemplate.archived ? 'Restore' : 'Archive'}
                          </button>
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                        <div className="mb-6">
                            <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                                <Code className="w-4 h-4 mr-2" /> Versions
                            </h3>
                            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
                                        <tr>
                                            <th className="px-4 py-2">Version</th>
                                            <th className="px-4 py-2">Algo Version</th>
                                            <th className="px-4 py-2">Created</th>
                                            <th className="px-4 py-2">Status</th>
                                            <th className="px-4 py-2 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {sortedVersions.map((ver: TemplateVersion) => (
                                            <tr key={ver.id}>
                                                <td className="px-4 py-2 font-mono">v{ver.version}</td>
                                                <td className="px-4 py-2 text-xs text-gray-600">
                                                    {ver.algoVersionId && algoVersionById.get(ver.algoVersionId)
                                                      ? `${algoVersionById.get(ver.algoVersionId)?.algoId}@${algoVersionById.get(ver.algoVersionId)?.version}`
                                                      : '-'}
                                                </td>
                                                <td className="px-4 py-2 text-gray-500">
                                                    {ver.createdAt ? new Date(ver.createdAt).toLocaleString() : '-'}
                                                </td>
                                                <td className="px-4 py-2 text-xs text-gray-600">
                                                  <span className={`px-2 py-0.5 rounded-full border ${
                                                    ver.frozen ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'
                                                  }`}>
                                                    {ver.frozen ? 'Frozen' : 'Mutable'}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                  <button
                                                    onClick={() => handleFreezeVersion(ver)}
                                                    disabled={ver.frozen}
                                                    className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                                                  >
                                                    Freeze
                                                  </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {sortedVersions.length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-3 text-gray-400">No versions yet.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="mb-6">
                            <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                                <BookOpen className="w-4 h-4 mr-2" /> Algorithm Details
                            </h3>
                            {selectedAlgoVersion ? (
                              <div className="text-sm text-gray-600 space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-gray-500 uppercase">Algo</span>
                                  <span className="font-mono">{selectedAlgoVersion.algoId}</span>
                                  <span className="text-xs px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50">
                                    v{selectedAlgoVersion.version}
                                  </span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                                    selectedAlgoVersion.active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'
                                  }`}>
                                    {selectedAlgoVersion.active ? 'Active' : 'Disabled'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs font-semibold text-gray-500 uppercase">Entrypoint</span>
                                  <div className="font-mono text-xs text-gray-700">{selectedAlgoVersion.entrypoint}</div>
                                </div>
                                {selectedAlgoVersion.package && (
                                  <div>
                                    <span className="text-xs font-semibold text-gray-500 uppercase">Package</span>
                                    <div className="text-xs text-gray-700">{selectedAlgoVersion.package}</div>
                                  </div>
                                )}
                                {selectedAlgoVersion.artifactUri && (
                                  <div>
                                    <span className="text-xs font-semibold text-gray-500 uppercase">Artifact</span>
                                    <div className="text-xs text-gray-700 break-all">{selectedAlgoVersion.artifactUri}</div>
                                  </div>
                                )}
                                {selectedAlgoVersion.configSchema && (
                                  <div>
                                    <span className="text-xs font-semibold text-gray-500 uppercase">Config Schema</span>
                                    <pre className="mt-1 text-xs bg-gray-900 text-gray-200 p-3 rounded-lg overflow-auto">
{JSON.stringify(selectedAlgoVersion.configSchema, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500">No algorithm version linked to the latest template version.</p>
                            )}
                        </div>

                        <div>
                            <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                                <FileJson className="w-4 h-4 mr-2" /> Default Configuration
                            </h3>
                            <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-gray-300 shadow-inner border border-gray-800">
                                <pre className="whitespace-pre-wrap">
{JSON.stringify(selectedTemplateDetail?.defaultConfig ?? selectedTemplate.defaultConfig, null, 2)}
                                </pre>
                            </div>
                        </div>
                    </div>
                  </>
              ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                      <Terminal className="w-12 h-12 mb-4 opacity-20" />
                      <p>Select a template to view details</p>
                  </div>
              )}
          </div>
      </div>

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Create Template</h2>
              <button onClick={() => setIsCreateOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateTemplate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 resize-none"
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newType}
                  onChange={e => setNewType(e.target.value as 'Single-Agent' | 'Multi-Agent')}
                >
                  <option value="Single-Agent">Single-Agent</option>
                  <option value="Multi-Agent">Multi-Agent</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Config (JSON)</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-32 font-mono text-xs"
                  value={newDefaultConfig}
                  onChange={e => setNewDefaultConfig(e.target.value)}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isVersionOpen && selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Create Template Version</h2>
              <button
                onClick={() => {
                  setIsVersionOpen(false);
                  setSelectedAlgoVersionId('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVersion} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
                <div className="text-sm text-gray-600">{selectedTemplate.name}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newVersion}
                  onChange={e => setNewVersion(e.target.value)}
                  placeholder="e.g., 1.0.0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Algorithm Version</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={selectedAlgoVersionId}
                  onChange={e => setSelectedAlgoVersionId(e.target.value)}
                >
                  {algoVersionOptions.map(version => (
                    <option key={version.id} value={version.id}>
                      {version.algoId}@{version.version}
                    </option>
                  ))}
                </select>
                {algoVersionOptions.length === 0 && (
                  <p className="text-xs text-red-600 mt-1">No algorithm versions registered yet.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Override Config (JSON, optional)</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-32 font-mono text-xs"
                  value={newVersionConfig}
                  onChange={e => setNewVersionConfig(e.target.value)}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsVersionOpen(false);
                    setSelectedAlgoVersionId('');
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create Version</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isEditOpen && selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Edit Template</h2>
              <button onClick={() => setIsEditOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateTemplate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 resize-none"
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Config (JSON)</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-32 font-mono text-xs"
                  value={editDefaultConfig}
                  onChange={e => setEditDefaultConfig(e.target.value)}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsEditOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
