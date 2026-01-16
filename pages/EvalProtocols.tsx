import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { EvalProtocol, EnvSpec, EnvVersion } from '../types';
import { Plus, Lock, Unlock, FileText, X, AlertTriangle, Trash2 } from 'lucide-react';
import { useToast } from '../components/Toast';

export const EvalProtocols: React.FC = () => {
  const { showToast } = useToast();
  const [protocols, setProtocols] = useState<EvalProtocol[]>([]);
  const [envs, setEnvs] = useState<EnvSpec[]>([]);
  const [envVersions, setEnvVersions] = useState<EnvVersion[]>([]);
  
  // Create Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedEnv, setSelectedEnv] = useState('');
  const [selectedEnvVersion, setSelectedEnvVersion] = useState('');
  const [selectedMap, setSelectedMap] = useState('');
  const [episodes, setEpisodes] = useState(50);
  const [seedCount, setSeedCount] = useState(3);
  const [versionName, setVersionName] = useState('');
  const [versionTarget, setVersionTarget] = useState<EvalProtocol | null>(null);

  const resolveMapOptions = (version?: EnvVersion, env?: EnvSpec) => {
    if (version?.mapSets && version.mapSets.length > 0) {
      return version.mapSets.map(ms => ms.id);
    }
    if (env?.maps && env.maps.length > 0) {
      return env.maps;
    }
    return [];
  };

  const selectDefaultMap = (version?: EnvVersion, env?: EnvSpec) => {
    const options = resolveMapOptions(version, env);
    return options[0] ?? 'default';
  };

  useEffect(() => {
    api.getProtocols().then(setProtocols);
    api.getEnvs().then(setEnvs);
  }, []);

  useEffect(() => {
    if (!selectedEnv) {
      setEnvVersions([]);
      setSelectedEnvVersion('');
      setSelectedMap('');
      return;
    }
    api.getEnvVersions(selectedEnv).then(versions => {
      const enabled = versions.filter(v => v.active !== false);
      const usable = enabled.length ? enabled : versions;
      const sorted = [...usable].sort((a, b) => (b.version || '').localeCompare(a.version || ''));
      const chosenVersion = sorted[0] || versions[0];
      const env = envs.find(e => e.id === selectedEnv);
      setEnvVersions(sorted);
      setSelectedEnvVersion(chosenVersion?.version || '');
      setSelectedMap(selectDefaultMap(chosenVersion, env));
    });
  }, [selectedEnv]);

  useEffect(() => {
    if (!selectedEnv || !selectedEnvVersion) return;
    const env = envs.find(e => e.id === selectedEnv);
    const version = envVersions.find(v => v.version === selectedEnvVersion);
    const options = resolveMapOptions(version, env);
    if (options.length === 0) {
      if (selectedMap !== 'default') {
        setSelectedMap('default');
      }
      return;
    }
    if (!options.includes(selectedMap)) {
      setSelectedMap(options[0]);
    }
  }, [selectedEnvVersion, envVersions, envs, selectedEnv, selectedMap]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEnv || !selectedEnvVersion || !selectedMap || !newName) return;
    const evalSeeds = Array.from({ length: seedCount }, (_, idx) => idx + 1);
    api
      .createProtocol({
        name: newName,
        env: { envId: selectedEnv, version: selectedEnvVersion, mapSet: selectedMap },
        evalSeeds,
        episodesPerMatch: episodes,
      })
      .then(() => api.getProtocols().then(setProtocols))
      .finally(() => setIsCreateOpen(false));
  }

  const handleFreeze = (id: string) => {
      api.freezeProtocol(id).then(() => {
        setProtocols(protocols.map(p => p.id === id ? { ...p, frozen: true } : p));
      });
  }

  const handleCreateVersion = (e: React.FormEvent) => {
      e.preventDefault();
      if (!versionTarget) return;
      api
        .createProtocolVersion(versionTarget.id, { version: versionName || undefined })
        .then(() => api.getProtocols().then(setProtocols))
        .finally(() => {
          setVersionName('');
          setVersionTarget(null);
        });
  }

  const handleDelete = (protocol: EvalProtocol) => {
    if (!window.confirm(`Delete protocol "${protocol.name}" and all its versions/results?`)) {
      return;
    }
    api
      .deleteProtocol(protocol.id)
      .then(() => api.getProtocols().then(setProtocols))
      .then(() => showToast(`Deleted protocol "${protocol.name}".`, 'success'))
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to delete protocol: ${detail}`, 'error');
      });
  }

  return (
    <div className="space-y-6 relative">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Evaluation Protocols</h1>
          <p className="text-gray-500 mt-1">Standardize evaluation settings for fair comparisons.</p>
        </div>
        <button 
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" /> New Protocol
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {protocols.map(proto => (
          <div key={proto.id} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
            {proto.frozen && (
                <div className="absolute top-0 right-0 p-2">
                    <Lock className="w-16 h-16 text-gray-50 opacity-50 -rotate-12 transform translate-x-4 -translate-y-4 pointer-events-none" />
                </div>
            )}
            
            <div className="flex justify-between items-start mb-4 relative z-10">
              <div className={`p-2 rounded-lg ${proto.frozen ? 'bg-gray-100 text-gray-600' : 'bg-blue-50 text-blue-600'}`}>
                <FileText className="w-6 h-6" />
              </div>
              {proto.frozen ? (
                <span className="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded-full flex items-center font-medium">
                  <Lock className="w-3 h-3 mr-1" /> Frozen
                </span>
              ) : (
                <span className="px-2 py-1 bg-green-50 text-green-600 text-xs rounded-full flex items-center font-medium">
                  <Unlock className="w-3 h-3 mr-1" /> Draft
                </span>
              )}
            </div>
            
            <h3 className="font-bold text-gray-900 mb-1 relative z-10">{proto.name}</h3>
            <p className="text-xs text-gray-400 font-mono mb-1">{proto.id}</p>
            <p className="text-xs text-gray-500 mb-4">Version: v{proto.version}</p>
            
            <div className="space-y-2 text-sm text-gray-600 relative z-10">
              <div className="flex justify-between border-b border-gray-50 pb-2">
                <span>Environment:</span>
                <span className="font-medium">{proto.envId} / {proto.map}</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-2">
                <span>Eval Seeds:</span>
                <span className="font-medium text-gray-900">{proto.evalSeeds.length}</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-2">
                <span>Episodes/Seed:</span>
                <span className="font-medium text-gray-900">{proto.episodes}</span>
              </div>
            </div>

            <div className="mt-6 flex gap-2 relative z-10">
              <button
                onClick={() => setVersionTarget(proto)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                New Version
              </button>
              {!proto.frozen && (
                 <button 
                    onClick={() => handleFreeze(proto.id)}
                    className="px-3 py-2 bg-orange-50 text-orange-700 border border-orange-100 rounded-lg text-sm font-medium hover:bg-orange-100 flex items-center"
                    title="Freeze Protocol"
                 >
                    <Lock className="w-4 h-4" />
                 </button>
              )}
              <button
                onClick={() => handleDelete(proto)}
                className="px-3 py-2 bg-red-50 text-red-700 border border-red-100 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center"
                title="Delete Protocol"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-900">Create Eval Protocol</h2>
                    <button onClick={() => setIsCreateOpen(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleCreate} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Protocol Name</label>
                        <input 
                            type="text" 
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            placeholder="e.g., Standard Benchmark v2"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                        />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
                          <select 
                              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              value={selectedEnv}
                              onChange={e => setSelectedEnv(e.target.value)}
                          >
                            <option value="">Select Env</option>
                            {envs.map(e => <option key={e.id} value={e.id}>{e.id}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                          <select 
                              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              value={selectedEnvVersion}
                              onChange={e => setSelectedEnvVersion(e.target.value)}
                              disabled={!selectedEnv}
                          >
                             <option value="">Select Version</option>
                             {envVersions.map(v => <option key={v.version} value={v.version}>{v.version}</option>)}
                          </select>
                      </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Map Set</label>
                        <select 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={selectedMap}
                            onChange={e => setSelectedMap(e.target.value)}
                            disabled={!selectedEnvVersion}
                        >
                           <option value="">Select Map Set</option>
                           {resolveMapOptions(
                             envVersions.find(v => v.version === selectedEnvVersion),
                             envs.find(e => e.id === selectedEnv),
                           ).length > 0
                             ? resolveMapOptions(
                                 envVersions.find(v => v.version === selectedEnvVersion),
                                 envs.find(e => e.id === selectedEnv),
                               ).map(option => (
                                 <option key={option} value={option}>{option}</option>
                               ))
                             : <option value="default">default</option>
                           }
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          {resolveMapOptions(
                            envVersions.find(v => v.version === selectedEnvVersion),
                            envs.find(e => e.id === selectedEnv),
                          ).length > 0
                            ? 'Select a predefined map set.'
                            : 'No map sets registered; using default.'}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                             <label className="block text-sm font-medium text-gray-700 mb-1">Random Seeds</label>
                             <input 
                                type="number" 
                                className="w-full p-2 border border-gray-300 rounded-lg"
                                value={seedCount}
                                onChange={e => setSeedCount(Number(e.target.value))}
                                min={1} max={100}
                             />
                             <p className="text-xs text-gray-500 mt-1">Number of distinct seed runs.</p>
                        </div>
                        <div>
                             <label className="block text-sm font-medium text-gray-700 mb-1">Episodes / Seed</label>
                             <input 
                                type="number" 
                                className="w-full p-2 border border-gray-300 rounded-lg"
                                value={episodes}
                                onChange={e => setEpisodes(Number(e.target.value))}
                                min={1}
                             />
                        </div>
                    </div>

                     <div className="bg-yellow-50 border border-yellow-100 p-3 rounded-lg flex gap-3">
                        <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
                        <p className="text-xs text-yellow-700">
                            Protocol will be created in <strong>Draft</strong> mode. You must <strong>Freeze</strong> it before using it in official benchmark reports.
                        </p>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create Protocol</button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {versionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Create Protocol Version</h2>
              <button onClick={() => setVersionTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVersion} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base Protocol</label>
                <div className="text-sm text-gray-600">{versionTarget.name} (v{versionTarget.version})</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Version</label>
                <input
                  type="text"
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="e.g., 2.0.0"
                  value={versionName}
                  onChange={e => setVersionName(e.target.value)}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setVersionTarget(null)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create Version</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
