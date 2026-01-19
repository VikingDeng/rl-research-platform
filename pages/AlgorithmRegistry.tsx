import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Algo, AlgoVersion } from '../types';
import { Archive, Plus, Search, X, Cpu, Info } from 'lucide-react';
import { useToast } from '../components/Toast';

export const AlgorithmRegistry: React.FC = () => {
  const { showToast } = useToast();
  const [algos, setAlgos] = useState<Algo[]>([]);
  const [algoVersions, setAlgoVersions] = useState<Record<string, AlgoVersion[]>>({});
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const [isAlgoModalOpen, setIsAlgoModalOpen] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<Algo | null>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [manageAlgo, setManageAlgo] = useState<Algo | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AlgoVersion | null>(null);
  const [isAlgoEditOpen, setIsAlgoEditOpen] = useState(false);
  const [editAlgoTarget, setEditAlgoTarget] = useState<Algo | null>(null);
  const [editAlgoName, setEditAlgoName] = useState('');
  const [editAlgoDescription, setEditAlgoDescription] = useState('');

  const [newAlgoId, setNewAlgoId] = useState('');
  const [newAlgoName, setNewAlgoName] = useState('');
  const [newAlgoDescription, setNewAlgoDescription] = useState('');

  const [newVersion, setNewVersion] = useState('');
  const [newEntrypoint, setNewEntrypoint] = useState('');
  const [newSourceType, setNewSourceType] = useState<'code' | 'path' | 'git' | 'package'>('code');
  const [newSourcePath, setNewSourcePath] = useState('');
  const [newGitRepo, setNewGitRepo] = useState('');
  const [newGitBranch, setNewGitBranch] = useState('');
  const [newGitCommit, setNewGitCommit] = useState('');
  const [newGitSubdir, setNewGitSubdir] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newPackage, setNewPackage] = useState('');
  const [newArtifactUri, setNewArtifactUri] = useState('');
  const [newConfigSchema, setNewConfigSchema] = useState('{}');
  const [newDefaultConfig, setNewDefaultConfig] = useState('{}');
  const [newResourceProfile, setNewResourceProfile] = useState('{}');
  const [newEnvConstraints, setNewEnvConstraints] = useState('{}');
  const [newMetadata, setNewMetadata] = useState('{}');
  const [newActive, setNewActive] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [editEntrypoint, setEditEntrypoint] = useState('');
  const [editSourceType, setEditSourceType] = useState<'none' | 'code' | 'path' | 'git'>('none');
  const [editSourcePath, setEditSourcePath] = useState('');
  const [editGitRepo, setEditGitRepo] = useState('');
  const [editGitBranch, setEditGitBranch] = useState('');
  const [editGitCommit, setEditGitCommit] = useState('');
  const [editGitSubdir, setEditGitSubdir] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editPackage, setEditPackage] = useState('');
  const [editArtifactUri, setEditArtifactUri] = useState('');
  const [editConfigSchema, setEditConfigSchema] = useState('{}');
  const [editDefaultConfig, setEditDefaultConfig] = useState('{}');
  const [editResourceProfile, setEditResourceProfile] = useState('{}');
  const [editEnvConstraints, setEditEnvConstraints] = useState('{}');
  const [editMetadata, setEditMetadata] = useState('{}');
  const [editActive, setEditActive] = useState(true);
  const [editShowAdvanced, setEditShowAdvanced] = useState(false);

  useEffect(() => {
    api.getAlgos({ includeArchived }).then(setAlgos);
  }, [includeArchived]);

  useEffect(() => {
    if (algos.length === 0) {
      setAlgoVersions({});
      return;
    }
    Promise.all(
      algos.map(algo => api.getAlgoVersions(algo.id).then(versions => [algo.id, versions] as const)),
    ).then(entries => {
      const next: Record<string, AlgoVersion[]> = {};
      entries.forEach(([algoId, versions]) => {
        next[algoId] = versions;
      });
      setAlgoVersions(next);
    });
  }, [algos]);

  const parseJsonField = (value: string, label: string) => {
    if (!value.trim()) return undefined;
    try {
      return JSON.parse(value);
    } catch (err) {
      showToast(`${label} JSON is invalid.`, 'error');
      return null;
    }
  };

  const resetVersionFields = () => {
    setNewVersion('');
    setNewEntrypoint('');
    setNewSourceType('code');
    setNewSourcePath('');
    setNewGitRepo('');
    setNewGitBranch('');
    setNewGitCommit('');
    setNewGitSubdir('');
    setNewCode('');
    setNewPackage('');
    setNewArtifactUri('');
    setNewConfigSchema('{}');
    setNewDefaultConfig('{}');
    setNewResourceProfile('{}');
    setNewEnvConstraints('{}');
    setNewMetadata('{}');
    setNewActive(true);
    setShowAdvanced(false);
  };

  const resetEditFields = () => {
    setEditEntrypoint('');
    setEditSourceType('none');
    setEditSourcePath('');
    setEditGitRepo('');
    setEditGitBranch('');
    setEditGitCommit('');
    setEditGitSubdir('');
    setEditCode('');
    setEditPackage('');
    setEditArtifactUri('');
    setEditConfigSchema('{}');
    setEditDefaultConfig('{}');
    setEditResourceProfile('{}');
    setEditEnvConstraints('{}');
    setEditMetadata('{}');
    setEditActive(true);
    setEditShowAdvanced(false);
  };

  const openAlgoEditModal = (algo: Algo) => {
    setEditAlgoTarget(algo);
    setEditAlgoName(algo.name || '');
    setEditAlgoDescription(algo.description || '');
    setIsAlgoEditOpen(true);
  };

  const handleUpdateAlgo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAlgoTarget) return;
    api
      .updateAlgo(editAlgoTarget.id, {
        name: editAlgoName.trim() || editAlgoTarget.name,
        description: editAlgoDescription.trim() || undefined,
      })
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
      .then(() => {
        setIsAlgoEditOpen(false);
        setEditAlgoTarget(null);
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to update algorithm: ${detail}`, 'error');
      });
  };

  const handleCreateAlgo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlgoId.trim() || !newAlgoName.trim()) {
      showToast('Algorithm ID and name are required.', 'error');
      return;
    }
    api
      .upsertAlgo({
        id: newAlgoId.trim(),
        name: newAlgoName.trim(),
        description: newAlgoDescription.trim() || undefined,
      })
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
      .then(() => {
        setIsAlgoModalOpen(false);
        setNewAlgoId('');
        setNewAlgoName('');
        setNewAlgoDescription('');
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to register algorithm: ${detail}`, 'error');
      });
  };

  const handleCreateVersion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionTarget) return;
    if (!newVersion.trim() || !newEntrypoint.trim()) {
      showToast('Version and entrypoint are required.', 'error');
      return;
    }
    if (newSourceType === 'path' && !newSourcePath.trim()) {
      showToast('Local path is required for Path source.', 'error');
      return;
    }
    if (newSourceType === 'git' && !newGitRepo.trim()) {
      showToast('Git repo is required for Git source.', 'error');
      return;
    }
    const configSchema = parseJsonField(newConfigSchema, 'Config schema');
    if (configSchema === null) return;
    const defaultConfig = parseJsonField(newDefaultConfig, 'Default config');
    if (defaultConfig === null) return;
    const resourceProfile = parseJsonField(newResourceProfile, 'Resource profile');
    if (resourceProfile === null) return;
    const envConstraints = parseJsonField(newEnvConstraints, 'Env constraints');
    if (envConstraints === null) return;
    const metadata = parseJsonField(newMetadata, 'Metadata');
    if (metadata === null) return;
    const finalMetadata: Record<string, unknown> = metadata ? { ...metadata } : {};
    if (newSourceType === 'path') {
      finalMetadata.path = newSourcePath.trim();
      delete (finalMetadata as any).git;
    }
    if (newSourceType === 'git') {
      finalMetadata.git = {
        repo: newGitRepo.trim(),
        branch: newGitBranch.trim() || undefined,
        commit: newGitCommit.trim() || undefined,
        subdir: newGitSubdir.trim() || undefined,
      };
      delete (finalMetadata as any).path;
    }

    api
      .createAlgoVersion(versionTarget.id, {
        version: newVersion.trim(),
        entrypoint: newEntrypoint.trim(),
        code: newSourceType === 'code' ? newCode.trim() || undefined : undefined,
        package: newPackage.trim() || undefined,
        artifactUri: newArtifactUri.trim() || undefined,
        configSchema,
        defaultConfig,
        resourceProfile,
        envConstraints,
        metadata: Object.keys(finalMetadata).length > 0 ? finalMetadata : undefined,
        active: newActive,
      })
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
      .then(() => {
        setIsVersionModalOpen(false);
        setVersionTarget(null);
        resetVersionFields();
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to create algorithm version: ${detail}`, 'error');
      });
  };

  const openEditModal = (version: AlgoVersion) => {
    if (version.frozen) {
      showToast('Frozen versions cannot be edited.', 'error');
      return;
    }
    setEditTarget(version);
    setEditEntrypoint(version.entrypoint || '');
    setEditPackage(version.package || '');
    setEditArtifactUri(version.artifactUri || '');
    setEditConfigSchema(JSON.stringify(version.configSchema || {}, null, 2));
    setEditDefaultConfig(JSON.stringify(version.defaultConfig || {}, null, 2));
    setEditResourceProfile(JSON.stringify(version.resourceProfile || {}, null, 2));
    setEditEnvConstraints(JSON.stringify(version.envConstraints || {}, null, 2));
    setEditMetadata(JSON.stringify(version.metadata || {}, null, 2));
    const meta = (version.metadata || {}) as Record<string, any>;
    if (meta?.git && typeof meta.git === 'object') {
      setEditSourceType('git');
      setEditGitRepo(meta.git.repo || '');
      setEditGitBranch(meta.git.branch || '');
      setEditGitCommit(meta.git.commit || '');
      setEditGitSubdir(meta.git.subdir || '');
      setEditSourcePath('');
    } else if (meta?.path) {
      setEditSourceType('path');
      setEditSourcePath(String(meta.path));
      setEditGitRepo('');
      setEditGitBranch('');
      setEditGitCommit('');
      setEditGitSubdir('');
    } else {
      setEditSourceType('none');
      setEditSourcePath('');
      setEditGitRepo('');
      setEditGitBranch('');
      setEditGitCommit('');
      setEditGitSubdir('');
    }
    setEditCode('');
    setEditActive(version.active ?? true);
    setEditShowAdvanced(false);
    setIsEditOpen(true);
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
    if (editSourceType === 'path' && !editSourcePath.trim()) {
      showToast('Local path is required for Path source.', 'error');
      return;
    }
    if (editSourceType === 'git' && !editGitRepo.trim()) {
      showToast('Git repo is required for Git source.', 'error');
      return;
    }
    const configSchema = parseJsonField(editConfigSchema, 'Config schema');
    if (configSchema === null) return;
    const defaultConfig = parseJsonField(editDefaultConfig, 'Default config');
    if (defaultConfig === null) return;
    const resourceProfile = parseJsonField(editResourceProfile, 'Resource profile');
    if (resourceProfile === null) return;
    const envConstraints = parseJsonField(editEnvConstraints, 'Env constraints');
    if (envConstraints === null) return;
    const metadata = parseJsonField(editMetadata, 'Metadata');
    if (metadata === null) return;
    const finalMetadata: Record<string, unknown> = metadata ? { ...metadata } : {};
    if (editSourceType === 'path') {
      finalMetadata.path = editSourcePath.trim();
      delete (finalMetadata as any).git;
    } else if (editSourceType === 'git') {
      finalMetadata.git = {
        repo: editGitRepo.trim(),
        branch: editGitBranch.trim() || undefined,
        commit: editGitCommit.trim() || undefined,
        subdir: editGitSubdir.trim() || undefined,
      };
      delete (finalMetadata as any).path;
    } else if (editSourceType === 'none') {
      delete (finalMetadata as any).path;
      delete (finalMetadata as any).git;
    }

    api
      .updateAlgoVersion(editTarget.algoId, editTarget.version, {
        entrypoint: editEntrypoint.trim(),
        code: editSourceType === 'code' ? editCode.trim() || undefined : undefined,
        package: editPackage.trim() || undefined,
        artifactUri: editArtifactUri.trim() || undefined,
        configSchema,
        defaultConfig,
        resourceProfile,
        envConstraints,
        metadata: Object.keys(finalMetadata).length > 0 ? finalMetadata : undefined,
        active: editActive,
      })
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
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

  const toggleVersionActive = (version: AlgoVersion) => {
    if (version.frozen) {
      showToast('Frozen versions cannot be modified.', 'error');
      return;
    }
    api
      .updateAlgoVersion(version.algoId, version.version, { active: !(version.active ?? true) })
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to update status: ${detail}`, 'error');
      });
  };

  const handleArchiveAlgo = (algo: Algo, archived: boolean) => {
    const action = archived ? api.updateAlgo(algo.id, { archived: false }) : api.archiveAlgo(algo.id);
    action
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to ${archived ? 'restore' : 'archive'} algorithm: ${detail}`, 'error');
      });
  };

  const handleFreezeVersion = (version: AlgoVersion) => {
    api
      .freezeAlgoVersion(version.algoId, version.version)
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to freeze version: ${detail}`, 'error');
      });
  };

  const filteredAlgos = algos.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Algorithm Registry</h1>
          <p className="text-gray-500 mt-1">Manage algorithm implementations, versions, and reproducibility metadata.</p>
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
            onClick={() => setIsAlgoModalOpen(true)}
            className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            <Plus className="w-4 h-4 mr-2" /> Register Algorithm
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search algorithms..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAlgos.map(algo => {
          const versions = algoVersions[algo.id] || [];
          const latest = versions.length > 0 ? versions[versions.length - 1] : undefined;
          return (
            <div key={algo.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden">
              <div className="p-6 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                    <Cpu className="w-6 h-6" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => {
                        resetVersionFields();
                        setVersionTarget(algo);
                        setIsVersionModalOpen(true);
                      }}
                      disabled={algo.archived}
                      className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded-full hover:bg-blue-50"
                    >
                      Add Version
                    </button>
                    <button
                      onClick={() => {
                        setManageAlgo(algo);
                        setIsManageOpen(true);
                      }}
                      className="text-xs text-gray-600 border border-gray-200 px-2 py-1 rounded-full hover:bg-gray-50"
                    >
                      Manage
                    </button>
                  </div>
                </div>
                <h3 className="font-bold text-gray-900 text-lg mb-1">{algo.name}</h3>
                <p className="text-xs text-gray-500 font-mono mb-2">{algo.id}</p>
                {algo.archived && (
                  <span className="inline-flex items-center text-xs font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full mb-2">
                    Archived
                  </span>
                )}
                {algo.description && <p className="text-sm text-gray-600 line-clamp-2">{algo.description}</p>}
                <div className="mt-4 space-y-2 text-sm text-gray-600">
                  <div>
                    <span className="font-medium text-gray-900">{versions.length}</span> Versions
                  </div>
                  <div className="text-xs text-gray-500 line-clamp-1">
                    {latest?.entrypoint ? `Entrypoint: ${latest.entrypoint}` : 'No versions yet'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isAlgoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Register Algorithm</h2>
              <button onClick={() => setIsAlgoModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAlgo} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Algorithm ID</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newAlgoId}
                  onChange={e => setNewAlgoId(e.target.value)}
                  placeholder="e.g., mappo"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newAlgoName}
                  onChange={e => setNewAlgoName(e.target.value)}
                  placeholder="e.g., MAPPO"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 resize-none"
                  value={newAlgoDescription}
                  onChange={e => setNewAlgoDescription(e.target.value)}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsAlgoModalOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Register</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isVersionModalOpen && versionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Add Algorithm Version</h2>
              <button onClick={() => { setIsVersionModalOpen(false); setVersionTarget(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVersion} className="p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              <div className="bg-blue-50 p-4 rounded-lg flex gap-3 items-start">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-700">
                  Versions should point to reproducible artifacts (entrypoint + package or artifact URI).
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Algorithm</label>
                <div className="text-sm text-gray-600">{versionTarget.name}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Active</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newActive ? 'true' : 'false'}
                    onChange={e => setNewActive(e.target.value === 'true')}
                  >
                    <option value="true">Active</option>
                    <option value="false">Disabled</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Entrypoint</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newEntrypoint}
                  onChange={e => setNewEntrypoint(e.target.value)}
                  placeholder="e.g., myalgo.train:main"
                />
                <p className="text-xs text-gray-500 mt-1">Format: module:function (e.g. algorithms.mappo_train:train)</p>
                {newSourceType === 'git' && (
                  <p className="text-xs text-amber-600 mt-1">For Git sources, module must be importable from the repo/subdir.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newSourceType}
                  onChange={e => setNewSourceType(e.target.value as 'code' | 'path' | 'git' | 'package')}
                >
                  <option value="code">Inline code</option>
                  <option value="path">Server file path</option>
                  <option value="git">Git repository</option>
                  <option value="package">Package/Artifact only</option>
                </select>
              </div>
              {newSourceType === 'code' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Inline Code</label>
                  <textarea
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-40 font-mono text-xs"
                    value={newCode}
                    onChange={e => setNewCode(e.target.value)}
                    placeholder="Paste your Python code here. The entrypoint should match the module:function in this file."
                  />
                </div>
              )}
              {newSourceType === 'path' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Server File Path</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newSourcePath}
                    onChange={e => setNewSourcePath(e.target.value)}
                    placeholder="/home/dwj/algos/mappo_train.py"
                  />
                  <p className="text-xs text-gray-500 mt-1">The backend will copy this file into the algorithm store.</p>
                </div>
              )}
              {newSourceType === 'git' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Repo URL</label>
                    <input
                      type="text"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={newGitRepo}
                      onChange={e => setNewGitRepo(e.target.value)}
                      placeholder="https://github.com/org/repo.git"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Branch (optional)</label>
                      <input
                        type="text"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={newGitBranch}
                        onChange={e => setNewGitBranch(e.target.value)}
                        placeholder="main"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Commit (optional)</label>
                      <input
                        type="text"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={newGitCommit}
                        onChange={e => setNewGitCommit(e.target.value)}
                        placeholder="abc123"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subdirectory (optional)</label>
                    <input
                      type="text"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={newGitSubdir}
                      onChange={e => setNewGitSubdir(e.target.value)}
                      placeholder="src/algos"
                    />
                  </div>
                </div>
              )}
              {newSourceType === 'package' && (
                <p className="text-xs text-gray-500">
                  No source will be stored. Use Package/Artifact fields below for reproducible installs.
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Package (optional)</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newPackage}
                    onChange={e => setNewPackage(e.target.value)}
                    placeholder="e.g., mappo==1.2.0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Artifact URI (optional)</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newArtifactUri}
                    onChange={e => setNewArtifactUri(e.target.value)}
                    placeholder="s3://.../artifact.tar.gz"
                  />
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Config Schema (JSON)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={newConfigSchema}
                      onChange={e => setNewConfigSchema(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Default Config (JSON)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={newDefaultConfig}
                      onChange={e => setNewDefaultConfig(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Resource Profile (JSON)</label>
                      <textarea
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                        value={newResourceProfile}
                        onChange={e => setNewResourceProfile(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Env Constraints (JSON)</label>
                      <textarea
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                        value={newEnvConstraints}
                        onChange={e => setNewEnvConstraints(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Metadata (JSON)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={newMetadata}
                      onChange={e => setNewMetadata(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">Reserved keys: path, git (auto-filled by Source).</p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-500">
                  Using defaults for config schema, resource profile, constraints, and metadata.
                </p>
              )}
              <div className="pt-4 flex justify-end gap-3 sticky bottom-0 bg-white pb-2">
                <button type="button" onClick={() => { setIsVersionModalOpen(false); setVersionTarget(null); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create Version</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isManageOpen && manageAlgo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Manage Versions</h2>
                <p className="text-xs text-gray-500">{manageAlgo.name}</p>
              </div>
              <button onClick={() => { setIsManageOpen(false); setManageAlgo(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between">
                <button
                  onClick={() => handleArchiveAlgo(manageAlgo, !!manageAlgo.archived)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm hover:bg-gray-50 flex items-center"
                >
                  <Archive className="w-4 h-4 mr-2" />
                  {manageAlgo.archived ? 'Restore' : 'Archive'}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => openAlgoEditModal(manageAlgo)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      resetVersionFields();
                      setVersionTarget(manageAlgo);
                      setIsManageOpen(false);
                      setManageAlgo(null);
                      setIsVersionModalOpen(true);
                    }}
                    disabled={manageAlgo.archived}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    Add Version
                  </button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-2">Version</th>
                      <th className="px-4 py-2">Entrypoint</th>
                      <th className="px-4 py-2">Package</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Frozen</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(algoVersions[manageAlgo.id] || []).map(version => (
                      <tr key={version.id}>
                        <td className="px-4 py-2 font-mono">v{version.version}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{version.entrypoint}</td>
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
                          <button onClick={() => openEditModal(version)} className="text-xs text-blue-600 hover:text-blue-800">
                            Edit
                          </button>
                          <button onClick={() => toggleVersionActive(version)} className="text-xs text-gray-600 hover:text-gray-800">
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
                    {(algoVersions[manageAlgo.id] || []).length === 0 && (
                      <tr>
                        <td className="px-4 py-4 text-sm text-gray-400" colSpan={6}>No versions registered.</td>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Edit Algorithm Version</h2>
              <button onClick={() => { setIsEditOpen(false); setEditTarget(null); resetEditFields(); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateVersion} className="p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Package</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editPackage}
                    onChange={e => setEditPackage(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Artifact URI</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editArtifactUri}
                    onChange={e => setEditArtifactUri(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source Override</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={editSourceType}
                  onChange={e => setEditSourceType(e.target.value as 'none' | 'code' | 'path' | 'git')}
                >
                  <option value="none">Keep existing source</option>
                  <option value="code">Inline code</option>
                  <option value="path">Server file path</option>
                  <option value="git">Git repository</option>
                </select>
              </div>
              {editSourceType === 'code' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Inline Code</label>
                  <textarea
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-40 font-mono text-xs"
                    value={editCode}
                    onChange={e => setEditCode(e.target.value)}
                    placeholder="Paste updated Python code here."
                  />
                </div>
              )}
              {editSourceType === 'path' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Server File Path</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editSourcePath}
                    onChange={e => setEditSourcePath(e.target.value)}
                    placeholder="/home/dwj/algos/mappo_train.py"
                  />
                </div>
              )}
              {editSourceType === 'git' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Repo URL</label>
                    <input
                      type="text"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={editGitRepo}
                      onChange={e => setEditGitRepo(e.target.value)}
                      placeholder="https://github.com/org/repo.git"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Branch (optional)</label>
                      <input
                        type="text"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={editGitBranch}
                        onChange={e => setEditGitBranch(e.target.value)}
                        placeholder="main"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Commit (optional)</label>
                      <input
                        type="text"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={editGitCommit}
                        onChange={e => setEditGitCommit(e.target.value)}
                        placeholder="abc123"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subdirectory (optional)</label>
                    <input
                      type="text"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={editGitSubdir}
                      onChange={e => setEditGitSubdir(e.target.value)}
                      placeholder="src/algos"
                    />
                  </div>
                </div>
              )}
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Config Schema (JSON)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={editConfigSchema}
                      onChange={e => setEditConfigSchema(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Default Config (JSON)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={editDefaultConfig}
                      onChange={e => setEditDefaultConfig(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Resource Profile (JSON)</label>
                      <textarea
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                        value={editResourceProfile}
                        onChange={e => setEditResourceProfile(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Env Constraints (JSON)</label>
                      <textarea
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                        value={editEnvConstraints}
                        onChange={e => setEditEnvConstraints(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Metadata (JSON)</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={editMetadata}
                      onChange={e => setEditMetadata(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">Reserved keys: path, git (auto-filled by Source).</p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-500">
                  Advanced config fields hidden. Defaults will be preserved.
                </p>
              )}
              <div className="pt-4 flex justify-end gap-3 sticky bottom-0 bg-white pb-2">
                <button type="button" onClick={() => { setIsEditOpen(false); setEditTarget(null); resetEditFields(); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAlgoEditOpen && editAlgoTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Edit Algorithm</h2>
              <button onClick={() => { setIsAlgoEditOpen(false); setEditAlgoTarget(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateAlgo} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={editAlgoName}
                  onChange={e => setEditAlgoName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 resize-none"
                  value={editAlgoDescription}
                  onChange={e => setEditAlgoDescription(e.target.value)}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => { setIsAlgoEditOpen(false); setEditAlgoTarget(null); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
