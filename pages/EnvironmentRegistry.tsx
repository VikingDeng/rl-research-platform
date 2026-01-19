import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { EnvSpec, EnvVersion } from '../types';
import { Archive, Plus, Search, X, Box, Info } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useLocation } from 'react-router-dom';

export const EnvironmentRegistry: React.FC = () => {
  const { showToast } = useToast();
  const location = useLocation();
  const [envs, setEnvs] = useState<EnvSpec[]>([]);
  const [envVersions, setEnvVersions] = useState<Record<string, EnvVersion[]>>({});
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  
  // Modal State
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<EnvSpec | null>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [manageEnv, setManageEnv] = useState<EnvSpec | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EnvVersion | null>(null);
  const [newEnvId, setNewEnvId] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [newApiMode, setNewApiMode] = useState('gym');
  const [newEntrypoint, setNewEntrypoint] = useState('');
  const [newPackage, setNewPackage] = useState('');
  const [newMapSets, setNewMapSets] = useState('[]');
  const [newScenarioSchema, setNewScenarioSchema] = useState('{}');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editVersion, setEditVersion] = useState('');
  const [editApiMode, setEditApiMode] = useState('gym');
  const [editEntrypoint, setEditEntrypoint] = useState('');
  const [editPackage, setEditPackage] = useState('');
  const [editMapSets, setEditMapSets] = useState('[]');
  const [editScenarioSchema, setEditScenarioSchema] = useState('{}');
  const [editActive, setEditActive] = useState(true);
  const [editShowAdvanced, setEditShowAdvanced] = useState(false);

  useEffect(() => {
    api.getEnvs({ includeArchived }).then(setEnvs);
    const state = location.state as { openCreate?: boolean } | null;
    if (state?.openCreate) {
      setIsEnvModalOpen(true);
    }
  }, [includeArchived, location.state]);

  useEffect(() => {
    if (envs.length === 0) {
      setEnvVersions({});
      return;
    }
    Promise.all(
      envs.map(env =>
        api.getEnvVersions(env.id).then(versions => [env.id, versions] as const),
      ),
    ).then(entries => {
      const next: Record<string, EnvVersion[]> = {};
      entries.forEach(([envId, versions]) => {
        next[envId] = versions;
      });
      setEnvVersions(next);
    });
  }, [envs]);

  const parseJsonPayload = () => {
      let mapSets: { id: string; maps: string[] }[] | undefined = undefined;
      let scenarioSchema: Record<string, unknown> | undefined = undefined;
      try {
        mapSets = newMapSets.trim() ? (JSON.parse(newMapSets) as { id: string; maps: string[] }[]) : [];
      } catch (err) {
        showToast('Map sets JSON is invalid.', 'error');
        return null;
      }
      try {
        scenarioSchema = newScenarioSchema.trim()
          ? (JSON.parse(newScenarioSchema) as Record<string, unknown>)
          : undefined;
      } catch (err) {
        showToast('Scenario schema JSON is invalid.', 'error');
        return null;
      }
      return { mapSets, scenarioSchema };
  };

  const resetVersionFields = () => {
      setNewVersion('');
      setNewApiMode('gym');
      setNewEntrypoint('');
      setNewPackage('');
      setNewMapSets('[]');
      setNewScenarioSchema('{}');
      setShowAdvanced(false);
  };

  const resetEditFields = () => {
      setEditVersion('');
      setEditApiMode('gym');
      setEditEntrypoint('');
      setEditPackage('');
      setEditMapSets('[]');
      setEditScenarioSchema('{}');
      setEditActive(true);
      setEditShowAdvanced(false);
  };

  const openEditModal = (version: EnvVersion) => {
      if (version.frozen) {
        showToast('Frozen versions cannot be edited.', 'error');
        return;
      }
      setEditTarget(version);
      setEditVersion(version.version);
      setEditApiMode(version.apiMode);
      setEditEntrypoint(version.entrypoint || '');
      setEditPackage(version.package || '');
      setEditMapSets(JSON.stringify(version.mapSets || [], null, 2));
      setEditScenarioSchema(JSON.stringify(version.scenarioSchema || {}, null, 2));
      setEditActive(version.active ?? true);
      setEditShowAdvanced(false);
      setIsEditOpen(true);
  };

  const handleRegisterEnv = (e: React.FormEvent) => {
      e.preventDefault();
      if (!newEnvId.trim() || !newVersion.trim() || !newEntrypoint.trim()) {
        showToast('Environment ID, version, and entrypoint are required.', 'error');
        return;
      }
      const parsed = parseJsonPayload();
      if (!parsed) return;
      const { mapSets, scenarioSchema } = parsed;
      api
        .upsertEnv({
          envId: newEnvId.trim(),
          version: newVersion.trim(),
          apiMode: newApiMode,
          entrypoint: newEntrypoint.trim(),
          package: newPackage.trim() || undefined,
          mapSets,
          scenarioSchema,
        })
        .then(() => api.getEnvs({ includeArchived }))
        .then(setEnvs)
        .then(() => {
          setIsEnvModalOpen(false);
          setNewEnvId('');
          resetVersionFields();
        })
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to register environment: ${detail}`, 'error');
        });
  }

  const handleCreateVersion = (e: React.FormEvent) => {
      e.preventDefault();
      if (!versionTarget) return;
      if (!newVersion.trim() || !newEntrypoint.trim()) {
        showToast('Version and entrypoint are required.', 'error');
        return;
      }
      const parsed = parseJsonPayload();
      if (!parsed) return;
      const { mapSets, scenarioSchema } = parsed;
      api
        .createEnvVersion(versionTarget.id, {
          version: newVersion.trim(),
          apiMode: newApiMode,
          entrypoint: newEntrypoint.trim(),
          package: newPackage.trim() || undefined,
          mapSets,
          scenarioSchema,
        })
        .then(() => api.getEnvs({ includeArchived }))
        .then(setEnvs)
        .then(() => {
          setIsVersionModalOpen(false);
          setVersionTarget(null);
          resetVersionFields();
        })
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to create version: ${detail}`, 'error');
        });
  };

  const handleUpdateVersion = (e: React.FormEvent) => {
      e.preventDefault();
      if (!editTarget) return;
      if (editTarget.frozen) {
        showToast('Frozen versions cannot be edited.', 'error');
        return;
      }
      if (!editEntrypoint.trim()) {
        showToast('Entrypoint is required.', 'error');
        return;
      }
      let mapSets: { id: string; maps: string[] }[] | undefined = undefined;
      let scenarioSchema: Record<string, unknown> | undefined = undefined;
      try {
        mapSets = editMapSets.trim() ? (JSON.parse(editMapSets) as { id: string; maps: string[] }[]) : [];
      } catch (err) {
        showToast('Map sets JSON is invalid.', 'error');
        return;
      }
      try {
        scenarioSchema = editScenarioSchema.trim()
          ? (JSON.parse(editScenarioSchema) as Record<string, unknown>)
          : undefined;
      } catch (err) {
        showToast('Scenario schema JSON is invalid.', 'error');
        return;
      }
      api
        .updateEnvVersion(editTarget.envId, editTarget.version, {
          apiMode: editApiMode,
          entrypoint: editEntrypoint.trim(),
          package: editPackage.trim() || undefined,
          active: editActive,
          mapSets,
          scenarioSchema,
        })
        .then(() => api.getEnvs({ includeArchived }))
        .then(setEnvs)
        .then(() => {
          setIsEditOpen(false);
          setEditTarget(null);
          resetEditFields();
        })
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to update version: ${detail}`, 'error');
        });
  };

  const toggleVersionActive = (version: EnvVersion) => {
      if (version.frozen) {
        showToast('Frozen versions cannot be modified.', 'error');
        return;
      }
      api
        .updateEnvVersion(version.envId, version.version, { active: !(version.active ?? true) })
        .then(() => api.getEnvs({ includeArchived }))
        .then(setEnvs)
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to update status: ${detail}`, 'error');
        });
  };

  const handleArchiveEnv = (env: EnvSpec, archived: boolean) => {
      const action = archived ? api.updateEnv(env.id, { archived: false }) : api.archiveEnv(env.id);
      action
        .then(() => api.getEnvs({ includeArchived }))
        .then(setEnvs)
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to ${archived ? 'restore' : 'archive'} environment: ${detail}`, 'error');
        });
  };

  const handleFreezeVersion = (version: EnvVersion) => {
      api
        .freezeEnvVersion(version.envId, version.version)
        .then(() => api.getEnvs({ includeArchived }))
        .then(setEnvs)
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to freeze version: ${detail}`, 'error');
        });
  };

  const filteredEnvs = envs.filter(e => e.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
           <h1 className="text-2xl font-bold text-gray-900">Environment Registry</h1>
           <p className="text-gray-500 mt-1">Manage MARL environment families, versions, and map configurations.</p>
        </div>
        <div className="flex items-center gap-3">
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
              onClick={() => {
                resetVersionFields();
                setNewEnvId('');
                setIsEnvModalOpen(true);
              }}
              className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
              <Plus className="w-4 h-4 mr-2" /> Register Environment
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Search environments..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEnvs.map(env => (
              <div key={env.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden">
                  <div className="p-6 flex-1">
                      <div className="flex justify-between items-start mb-4">
                          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                              <Box className="w-6 h-6" />
                          </div>
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => {
                                resetVersionFields();
                                setVersionTarget(env);
                                setIsVersionModalOpen(true);
                              }}
                              disabled={env.archived}
                              className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded-full hover:bg-blue-50"
                            >
                              Add Version
                            </button>
                            <button
                              onClick={() => {
                                setManageEnv(env);
                                setIsManageOpen(true);
                              }}
                              className="text-xs text-gray-600 border border-gray-200 px-2 py-1 rounded-full hover:bg-gray-50"
                            >
                              Manage
                            </button>
                          </div>
                      </div>
                      <h3 className="font-bold text-gray-900 text-lg mb-1">{env.id}</h3>
                      {env.archived && (
                        <span className="inline-flex items-center text-xs font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full mb-2">
                          Archived
                        </span>
                      )}
                      <div className="flex gap-2 mb-4 flex-wrap">
                            {env.versions.slice(0, 4).map(v => (
                                <span key={v} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-mono rounded border border-gray-200">{v}</span>
                            ))}
                      </div>
                      {(() => {
                        const versions = envVersions[env.id] || [];
                        const latest = versions.length > 0 ? versions[versions.length - 1] : undefined;
                        return (
                          <div className="space-y-2 text-sm text-gray-600">
                            <div>
                              <span className="font-medium text-gray-900">{versions.length}</span> Versions
                            </div>
                            <div className="text-xs text-gray-500 line-clamp-1">
                              {latest?.entrypoint ? `Entrypoint: ${latest.entrypoint}` : 'No entrypoint metadata'}
                            </div>
                          </div>
                        );
                      })()}
                  </div>
              </div>
          ))}
      </div>

       {/* Register Env Modal */}
       {isEnvModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-900">Register New Environment</h2>
                    <button onClick={() => setIsEnvModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleRegisterEnv} className="p-6 space-y-4">
                    <div className="bg-blue-50 p-4 rounded-lg flex gap-3 items-start mb-4">
                        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-700">
                            Environments must implement the standard <code>gym.Env</code> or <code>pettingzoo.ParallelEnv</code> interface.
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Environment ID</label>
                        <input 
                            type="text" 
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            placeholder="e.g., IsaacGym-Ant-v1"
                            value={newEnvId}
                            onChange={e => setNewEnvId(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">Unique identifier for this environment family.</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Entrypoint</label>
                        <input
                          type="text"
                          required
                          className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          placeholder="e.g., myenvs.smac:make_env"
                          value={newEntrypoint}
                          onChange={e => setNewEntrypoint(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">Python entrypoint in module:function format.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Package (optional)</label>
                        <input
                          type="text"
                          className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          placeholder="e.g., smac==1.0.0"
                          value={newPackage}
                          onChange={e => setNewPackage(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                            <input 
                                type="text" 
                                required
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                placeholder="e.g., 1.0.0"
                                value={newVersion}
                                onChange={e => setNewVersion(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">API Mode</label>
                            <select
                              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              value={newApiMode}
                              onChange={e => setNewApiMode(e.target.value)}
                            >
                              <option value="gym">gym</option>
                              <option value="pettingzoo">pettingzoo</option>
                              <option value="custom">custom</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                        <div className="text-sm font-medium text-gray-700">Advanced fields</div>
                        <button
                          type="button"
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className="text-sm text-blue-600 hover:text-blue-700"
                        >
                          {showAdvanced ? 'Hide' : 'Show'}
                        </button>
                    </div>
                    {showAdvanced ? (
                      <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Map Sets (JSON)</label>
                            <textarea
                              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                              value={newMapSets}
                              onChange={e => setNewMapSets(e.target.value)}
                            />
                            <p className="text-xs text-gray-500 mt-1">Example: [{`{"id":"default","maps":["map_a","map_b"]}`}]</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Scenario Schema (JSON, optional)</label>
                            <textarea
                              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                              value={newScenarioSchema}
                              onChange={e => setNewScenarioSchema(e.target.value)}
                            />
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Advanced fields hidden. Map sets and schema will use defaults.
                      </p>
                    )}
                    
                    <div className="pt-4 flex justify-end gap-3">
                        <button type="button" onClick={() => setIsEnvModalOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Register</button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {isVersionModalOpen && versionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Add Environment Version</h2>
              <button onClick={() => { setIsVersionModalOpen(false); setVersionTarget(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVersion} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Environment ID</label>
                <div className="text-sm text-gray-600">{versionTarget.id}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Entrypoint</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="e.g., myenvs.smac:make_env"
                  value={newEntrypoint}
                  onChange={e => setNewEntrypoint(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Package (optional)</label>
                <input
                  type="text"
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="e.g., smac==1.0.0"
                  value={newPackage}
                  onChange={e => setNewPackage(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                  <input 
                    type="text" 
                    required
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="e.g., 1.1.0"
                    value={newVersion}
                    onChange={e => setNewVersion(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Mode</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newApiMode}
                    onChange={e => setNewApiMode(e.target.value)}
                  >
                    <option value="gym">gym</option>
                    <option value="pettingzoo">pettingzoo</option>
                    <option value="custom">custom</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700">Advanced fields</div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {showAdvanced ? 'Hide' : 'Show'}
                </button>
              </div>
              {showAdvanced ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Map Sets (JSON)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={newMapSets}
                      onChange={e => setNewMapSets(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">Example: [{`{"id":"default","maps":["map_a","map_b"]}`}]</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Scenario Schema (JSON, optional)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={newScenarioSchema}
                      onChange={e => setNewScenarioSchema(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-500">
                  Advanced fields hidden. Map sets and schema will use defaults.
                </p>
              )}
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => { setIsVersionModalOpen(false); setVersionTarget(null); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create Version</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isManageOpen && manageEnv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Manage Versions</h2>
                <p className="text-xs text-gray-500">{manageEnv.id}</p>
              </div>
              <button onClick={() => { setIsManageOpen(false); setManageEnv(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between">
                <button
                  onClick={() => handleArchiveEnv(manageEnv, !!manageEnv.archived)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm hover:bg-gray-50 flex items-center"
                >
                  <Archive className="w-4 h-4 mr-2" />
                  {manageEnv.archived ? 'Restore' : 'Archive'}
                </button>
                <button
                  onClick={() => {
                    resetVersionFields();
                    setVersionTarget(manageEnv);
                    setIsManageOpen(false);
                    setManageEnv(null);
                    setIsVersionModalOpen(true);
                  }}
                  disabled={manageEnv.archived}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  Add Version
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-2">Version</th>
                      <th className="px-4 py-2">API Mode</th>
                      <th className="px-4 py-2">Entrypoint</th>
                      <th className="px-4 py-2">Package</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Frozen</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(envVersions[manageEnv.id] || []).map(version => (
                      <tr key={`${version.envId}-${version.version}`}>
                        <td className="px-4 py-2 font-mono">v{version.version}</td>
                        <td className="px-4 py-2">{version.apiMode}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{version.entrypoint || '-'}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{version.package || '-'}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            version.active === false ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-green-50 text-green-700 border-green-200'
                          }`}>
                            {version.active === false ? 'Disabled' : 'Active'}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            version.frozen ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'
                          }`}>
                            {version.frozen ? 'Frozen' : 'Mutable'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right space-x-2">
                          <button
                            onClick={() => openEditModal(version)}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => toggleVersionActive(version)}
                            className="text-xs text-gray-600 hover:text-gray-800"
                          >
                            {version.active === false ? 'Enable' : 'Disable'}
                          </button>
                          <button
                            onClick={() => handleFreezeVersion(version)}
                            disabled={version.frozen}
                            className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                          >
                            Freeze
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(envVersions[manageEnv.id] || []).length === 0 && (
                      <tr>
                        <td className="px-4 py-4 text-sm text-gray-400" colSpan={7}>No versions registered.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEditOpen && editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Edit Environment Version</h2>
              <button onClick={() => { setIsEditOpen(false); setEditTarget(null); resetEditFields(); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateVersion} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                <div className="text-sm text-gray-600 font-mono">v{editVersion}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Entrypoint</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={editEntrypoint}
                  onChange={e => setEditEntrypoint(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Package (optional)</label>
                <input
                  type="text"
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={editPackage}
                  onChange={e => setEditPackage(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Mode</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editApiMode}
                    onChange={e => setEditApiMode(e.target.value)}
                  >
                    <option value="gym">gym</option>
                    <option value="pettingzoo">pettingzoo</option>
                    <option value="custom">custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Active</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editActive ? 'true' : 'false'}
                    onChange={e => setEditActive(e.target.value === 'true')}
                  >
                    <option value="true">Active</option>
                    <option value="false">Disabled</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700">Advanced fields</div>
                <button
                  type="button"
                  onClick={() => setEditShowAdvanced(!editShowAdvanced)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {editShowAdvanced ? 'Hide' : 'Show'}
                </button>
              </div>
              {editShowAdvanced ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Map Sets (JSON)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={editMapSets}
                      onChange={e => setEditMapSets(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Scenario Schema (JSON, optional)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={editScenarioSchema}
                      onChange={e => setEditScenarioSchema(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-500">
                  Advanced fields hidden. Map sets and schema will use defaults.
                </p>
              )}
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => { setIsEditOpen(false); setEditTarget(null); resetEditFields(); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
