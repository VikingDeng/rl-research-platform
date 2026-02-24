import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { Algo, AlgoVersion } from '../types';
import { Archive, Plus, Search, X, Cpu, Info, CheckSquare, Square } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useI18n } from '../services/i18n';

type AlgoManifest = {
  name: string;
  version: string;
  entrypoint: string;
  python: string;
  dependencies: string[];
  defaultConfig: Record<string, unknown>;
  configSchema: Record<string, unknown>;
  resourceProfile?: Record<string, unknown>;
  envConstraints?: Record<string, unknown>;
  algoId?: string;
};

const MANIFEST_TEMPLATE = `{
  "name": "",
  "version": "0.1.0",
  "entrypoint": "module:function",
  "python": "3.10",
  "dependencies": [],
  "default_config": {},
  "config_schema": {
    "type": "object"
  },
  "resource_profile": {},
  "env_constraints": {}
}`;

const normalizeManifest = (raw: any): AlgoManifest => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Manifest must be a JSON object.');
  }
  const name = raw.name ?? raw.algoId ?? raw.algo_id;
  const version = raw.version;
  const entrypoint = raw.entrypoint;
  const python = raw.python;
  const dependenciesRaw = raw.dependencies ?? raw.runtimePackages ?? [];
  const dependencies = Array.isArray(dependenciesRaw)
    ? dependenciesRaw.map((dep: unknown) => String(dep)).filter(Boolean)
    : [String(dependenciesRaw)];
  const defaultConfig = raw.defaultConfig ?? raw.default_config ?? {};
  const configSchema = raw.configSchema ?? raw.config_schema ?? {};
  const resourceProfile = raw.resourceProfile ?? raw.resource_profile ?? undefined;
  const envConstraints = raw.envConstraints ?? raw.env_constraints ?? undefined;
  const algoId = raw.algoId ?? raw.algo_id ?? undefined;

  if (!name || !version || !entrypoint || !python) {
    throw new Error('Manifest requires name, version, entrypoint, and python.');
  }
  if (!configSchema || Object.keys(configSchema).length === 0) {
    throw new Error('config_schema is required.');
  }
  return {
    name: String(name),
    version: String(version),
    entrypoint: String(entrypoint),
    python: String(python),
    dependencies,
    defaultConfig: defaultConfig && typeof defaultConfig === 'object' ? defaultConfig : {},
    configSchema: configSchema && typeof configSchema === 'object' ? configSchema : {},
    resourceProfile: resourceProfile && typeof resourceProfile === 'object' ? resourceProfile : undefined,
    envConstraints: envConstraints && typeof envConstraints === 'object' ? envConstraints : undefined,
    algoId: algoId ? String(algoId) : undefined,
  };
};

const parseManifest = (value: string) => {
  if (!value.trim()) {
    return { manifest: null as AlgoManifest | null, error: 'Manifest is required.', raw: null as any };
  }
  try {
    const raw = JSON.parse(value);
    const manifest = normalizeManifest(raw);
    return { manifest, error: '', raw };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { manifest: null, error: detail, raw: null };
  }
};

const buildManifestFromVersion = (version: AlgoVersion) => {
  const meta = (version.metadata || {}) as Record<string, unknown>;
  const runtimePackages = Array.isArray((meta as any).runtimePackages)
    ? ((meta as any).runtimePackages as unknown[]).map(item => String(item))
    : version.package
      ? [version.package]
      : [];
  return {
    name: version.algoId,
    version: version.version,
    entrypoint: version.entrypoint,
    python: '3.10',
    dependencies: runtimePackages,
    default_config: version.defaultConfig || {},
    config_schema: version.configSchema || { type: 'object' },
    resource_profile: version.resourceProfile || {},
    env_constraints: version.envConstraints || {},
    algo_id: version.algoId,
  };
};

export const AlgorithmRegistry: React.FC = () => {
  const { showToast } = useToast();
  const { tx } = useI18n();
  const [algos, setAlgos] = useState<Algo[]>([]);
  const [algoVersions, setAlgoVersions] = useState<Record<string, AlgoVersion[]>>({});
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedAlgoIds, setSelectedAlgoIds] = useState<Set<string>>(new Set());

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
  const [newManifest, setNewManifest] = useState(MANIFEST_TEMPLATE);
  const [newSourceType, setNewSourceType] = useState<'code' | 'path' | 'git' | 'package'>('code');
  const [newSourcePath, setNewSourcePath] = useState('');
  const [newGitRepo, setNewGitRepo] = useState('');
  const [newGitBranch, setNewGitBranch] = useState('');
  const [newGitCommit, setNewGitCommit] = useState('');
  const [newGitSubdir, setNewGitSubdir] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newArtifactUri, setNewArtifactUri] = useState('');
  const [newConfigSchema, setNewConfigSchema] = useState('{}');
  const [newDefaultConfig, setNewDefaultConfig] = useState('{}');
  const [newResourceProfile, setNewResourceProfile] = useState('{}');
  const [newEnvConstraints, setNewEnvConstraints] = useState('{}');
  const [newMetadata, setNewMetadata] = useState('{}');
  const [newActive, setNewActive] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [editEntrypoint, setEditEntrypoint] = useState('');
  const [editManifest, setEditManifest] = useState(MANIFEST_TEMPLATE);
  const [editSourceType, setEditSourceType] = useState<'none' | 'code' | 'path' | 'git'>('none');
  const [editSourcePath, setEditSourcePath] = useState('');
  const [editGitRepo, setEditGitRepo] = useState('');
  const [editGitBranch, setEditGitBranch] = useState('');
  const [editGitCommit, setEditGitCommit] = useState('');
  const [editGitSubdir, setEditGitSubdir] = useState('');
  const [editCode, setEditCode] = useState('');
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

  const toggleSelect = (id: string) => {
    const next = new Set(selectedAlgoIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedAlgoIds(next);
  };

  const handleBulkArchive = (archive: boolean) => {
    const ids = Array.from(selectedAlgoIds);
    if (ids.length === 0) return;
    if (!window.confirm(tx(`${archive ? '归档' : '恢复'} ${ids.length} 个算法？`, `${archive ? 'Archive' : 'Restore'} ${ids.length} algorithms?`))) return;

    Promise.all(
      ids.map(id => archive ? api.archiveAlgo(id) : api.updateAlgo(id, { archived: false }))
    ).then(() => {
        showToast(
          tx(`算法已${archive ? '归档' : '恢复'}。`, `Successfully ${archive ? 'archived' : 'restored'} algorithms.`),
          'success',
        );
        setSelectedAlgoIds(new Set());
        return api.getAlgos({ includeArchived });
    }).then(setAlgos)
    .catch(err => {
        showToast(tx(`批量操作失败：${err}`, `Bulk action failed: ${err}`), 'error');
    });
  };

  const parseJsonField = (value: string, label: string) => {
    if (!value.trim()) return undefined;
    try {
      return JSON.parse(value);
    } catch (err) {
      showToast(tx(`${label} JSON 无效。`, `${label} JSON is invalid.`), 'error');
      return null;
    }
  };

  const newManifestParsed = useMemo(() => parseManifest(newManifest), [newManifest]);
  const editManifestParsed = useMemo(() => parseManifest(editManifest), [editManifest]);

  const resetVersionFields = () => {
    setNewVersion('');
    setNewEntrypoint('');
    setNewManifest(MANIFEST_TEMPLATE);
    setNewSourceType('code');
    setNewSourcePath('');
    setNewGitRepo('');
    setNewGitBranch('');
    setNewGitCommit('');
    setNewGitSubdir('');
    setNewCode('');
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
    setEditManifest(MANIFEST_TEMPLATE);
    setEditSourceType('none');
    setEditSourcePath('');
    setEditGitRepo('');
    setEditGitBranch('');
    setEditGitCommit('');
    setEditGitSubdir('');
    setEditCode('');
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
        showToast(tx(`更新算法失败：${detail}`, `Failed to update algorithm: ${detail}`), 'error');
      });
  };

  const handleCreateAlgo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlgoId.trim() || !newAlgoName.trim()) {
      showToast(tx('算法 ID 与名称必填。', 'Algorithm ID and name are required.'), 'error');
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
        showToast(tx(`注册算法失败：${detail}`, `Failed to register algorithm: ${detail}`), 'error');
      });
  };

  const handleCreateVersion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionTarget) return;
    if (!newManifestParsed.manifest) {
      showToast(
        tx(`Manifest 无效：${newManifestParsed.error || '必填'}`, `Manifest invalid: ${newManifestParsed.error || 'required'}`),
        'error',
      );
      return;
    }
    if (newSourceType === 'path' && !newSourcePath.trim()) {
      showToast(tx('Path 来源必须填写本地路径。', 'Local path is required for Path source.'), 'error');
      return;
    }
    if (newSourceType === 'git' && !newGitRepo.trim()) {
      showToast(tx('Git 来源必须填写仓库地址。', 'Git repo is required for Git source.'), 'error');
      return;
    }
    const configSchema = newManifestParsed.manifest.configSchema;
    const defaultConfig = newManifestParsed.manifest.defaultConfig;
    const resourceProfile = newManifestParsed.manifest.resourceProfile;
    const envConstraints = newManifestParsed.manifest.envConstraints;
    const metadata = parseJsonField(newMetadata, 'Metadata');
    if (metadata === null) return;
    const finalMetadata: Record<string, unknown> = metadata ? { ...metadata } : {};
    finalMetadata.manifest = newManifestParsed.raw;
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
        version: newManifestParsed.manifest.version,
        entrypoint: newManifestParsed.manifest.entrypoint,
        code: newSourceType === 'code' ? newCode.trim() || undefined : undefined,
        package: newManifestParsed.manifest.dependencies[0] || undefined,
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
        showToast(tx(`创建算法版本失败：${detail}`, `Failed to create algorithm version: ${detail}`), 'error');
      });
  };

  const openEditModal = (version: AlgoVersion) => {
    if (version.frozen) {
      showToast(tx('冻结版本不可编辑。', 'Frozen versions cannot be edited.'), 'error');
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
    if (meta?.manifest) {
      setEditManifest(JSON.stringify(meta.manifest, null, 2));
    } else {
      setEditManifest(JSON.stringify(buildManifestFromVersion(version), null, 2));
    }
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
      showToast(tx('冻结版本不可编辑。', 'Frozen versions cannot be edited.'), 'error');
      return;
    }
    if (!editManifestParsed.manifest) {
      showToast(
        tx(`Manifest 无效：${editManifestParsed.error || '必填'}`, `Manifest invalid: ${editManifestParsed.error || 'required'}`),
        'error',
      );
      return;
    }
    if (editSourceType === 'path' && !editSourcePath.trim()) {
      showToast(tx('Path 来源必须填写本地路径。', 'Local path is required for Path source.'), 'error');
      return;
    }
    if (editSourceType === 'git' && !editGitRepo.trim()) {
      showToast(tx('Git 来源必须填写仓库地址。', 'Git repo is required for Git source.'), 'error');
      return;
    }
    const configSchema = editManifestParsed.manifest.configSchema;
    const defaultConfig = editManifestParsed.manifest.defaultConfig;
    const resourceProfile = editManifestParsed.manifest.resourceProfile;
    const envConstraints = editManifestParsed.manifest.envConstraints;
    const metadata = parseJsonField(editMetadata, 'Metadata');
    if (metadata === null) return;
    const finalMetadata: Record<string, unknown> = metadata ? { ...metadata } : {};
    finalMetadata.manifest = editManifestParsed.raw;
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
        entrypoint: editManifestParsed.manifest.entrypoint,
        code: editSourceType === 'code' ? editCode.trim() || undefined : undefined,
        package: editManifestParsed.manifest.dependencies[0] || undefined,
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
        showToast(tx(`更新版本失败：${detail}`, `Failed to update version: ${detail}`), 'error');
      });
  };

  const toggleVersionActive = (version: AlgoVersion) => {
    if (version.frozen) {
      showToast(tx('冻结版本不可修改。', 'Frozen versions cannot be modified.'), 'error');
      return;
    }
    api
      .updateAlgoVersion(version.algoId, version.version, { active: !(version.active ?? true) })
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(tx(`更新状态失败：${detail}`, `Failed to update status: ${detail}`), 'error');
      });
  };

  const handleArchiveAlgo = (algo: Algo, archived: boolean) => {
    const action = archived ? api.updateAlgo(algo.id, { archived: false }) : api.archiveAlgo(algo.id);
    action
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(
          tx(
            `${archived ? '恢复' : '归档'}算法失败：${detail}`,
            `Failed to ${archived ? 'restore' : 'archive'} algorithm: ${detail}`,
          ),
          'error',
        );
      });
  };

  const handleFreezeVersion = (version: AlgoVersion) => {
    api
      .freezeAlgoVersion(version.algoId, version.version)
      .then(() => api.getAlgos({ includeArchived }))
      .then(setAlgos)
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(tx(`冻结版本失败：${detail}`, `Failed to freeze version: ${detail}`), 'error');
      });
  };

  const filteredAlgos = algos.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6 relative pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{tx('算法仓库', 'Algorithm Registry')}</h1>
          <p className="text-gray-500 mt-1">{tx('管理算法实现、版本与可复现元数据。', 'Manage algorithm implementations, versions, and reproducibility metadata.')}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500 flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={e => setIncludeArchived(e.target.checked)}
              className="rounded border-gray-300"
            />
            {tx('显示归档', 'Show archived')}
          </label>
          <button
            onClick={() => setIsAlgoModalOpen(true)}
            className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            <Plus className="w-4 h-4 mr-2" /> {tx('注册算法', 'Register Algorithm')}
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder={tx('搜索算法...', 'Search algorithms...')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAlgos.map(algo => {
          const versions = algoVersions[algo.id] || [];
          const latest = versions.length > 0 ? versions[versions.length - 1] : undefined;
          const isSelected = selectedAlgoIds.has(algo.id);
          return (
            <div 
                key={algo.id} 
                className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden relative ${isSelected ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/10' : 'border-gray-200'}`}
            >
              <button 
                onClick={() => toggleSelect(algo.id)}
                className="absolute top-4 right-4 text-gray-400 hover:text-blue-600 z-10"
              >
                  {isSelected ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5" />}
              </button>
              
              <div className="p-6 flex-1">
                <div className="flex justify-between items-start mb-4 pr-8">
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
                    {tx('已归档', 'Archived')}
                  </span>
                )}
                {algo.description && <p className="text-sm text-gray-600 line-clamp-2">{algo.description}</p>}
                <div className="mt-4 space-y-2 text-sm text-gray-600">
                  <div>
                    <span className="font-medium text-gray-900">{versions.length}</span> {tx('个版本', 'Versions')}
                  </div>
                  <div className="text-xs text-gray-500 line-clamp-1">
                    {latest?.entrypoint ? `${tx('入口点', 'Entrypoint')}: ${latest.entrypoint}` : tx('暂无版本', 'No versions yet')}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedAlgoIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-6 animate-in slide-in-from-bottom duration-200 z-50">
              <span className="font-medium text-sm">{tx(`已选 ${selectedAlgoIds.size} 个`, `${selectedAlgoIds.size} selected`)}</span>
              <div className="h-4 w-px bg-gray-700"></div>
              <button 
                onClick={() => handleBulkArchive(true)}
                className="flex items-center text-sm font-bold text-gray-300 hover:text-white"
              >
                  <Archive className="w-4 h-4 mr-2" /> {tx('归档', 'Archive')}
              </button>
              <button 
                onClick={() => handleBulkArchive(false)}
                className="flex items-center text-sm font-bold text-gray-300 hover:text-white"
              >
                  <Archive className="w-4 h-4 mr-2 rotate-180" /> {tx('恢复', 'Restore')}
              </button>
              <button 
                onClick={() => setSelectedAlgoIds(new Set())}
                className="text-gray-400 hover:text-gray-200 text-sm"
              >
                  {tx('清空', 'Clear')}
              </button>
          </div>
      )}

      {isAlgoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">{tx('注册算法', 'Register Algorithm')}</h2>
              <button onClick={() => setIsAlgoModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAlgo} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('算法 ID', 'Algorithm ID')}</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newAlgoId}
                  onChange={e => setNewAlgoId(e.target.value)}
                  placeholder={tx('例如：mappo', 'e.g., mappo')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('名称', 'Name')}</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newAlgoName}
                  onChange={e => setNewAlgoName(e.target.value)}
                  placeholder={tx('例如：MAPPO', 'e.g., MAPPO')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('描述', 'Description')}</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 resize-none"
                  value={newAlgoDescription}
                  onChange={e => setNewAlgoDescription(e.target.value)}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsAlgoModalOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">{tx('取消', 'Cancel')}</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">{tx('注册', 'Register')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isVersionModalOpen && versionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">{tx('新增算法版本', 'Add Algorithm Version')}</h2>
              <button onClick={() => { setIsVersionModalOpen(false); setVersionTarget(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVersion} className="p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              <div className="bg-blue-50 p-4 rounded-lg flex gap-3 items-start">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-700">
                  {tx('版本应指向可复现产物（入口点 + 依赖包或产物 URI）。', 'Versions should point to reproducible artifacts (entrypoint + package or artifact URI).')}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('算法', 'Algorithm')}</label>
                <div className="text-sm text-gray-600">{versionTarget.name}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('算法 Manifest（必填）', 'Algorithm Manifest (required)')}</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-44 font-mono text-xs"
                  value={newManifest}
                  onChange={e => setNewManifest(e.target.value)}
                />
                {newManifestParsed.error && (
                  <p className="text-xs text-red-600 mt-1">{newManifestParsed.error}</p>
                )}
                {!newManifestParsed.error && newManifestParsed.manifest && (
                  <p className="text-xs text-green-700 mt-1">
                    {tx('Manifest 校验通过：', 'Manifest OK:')} {newManifestParsed.manifest.name} v{newManifestParsed.manifest.version}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('版本', 'Version')}</label>
                  <input
                    type="text"
                    required
                    readOnly={!!newManifestParsed.manifest}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newManifestParsed.manifest?.version ?? newVersion}
                    onChange={e => setNewVersion(e.target.value)}
                    placeholder={tx('例如：1.0.0', 'e.g., 1.0.0')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('激活状态', 'Active')}</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newActive ? 'true' : 'false'}
                    onChange={e => setNewActive(e.target.value === 'true')}
                  >
                    <option value="true">{tx('激活', 'Active')}</option>
                    <option value="false">{tx('禁用', 'Disabled')}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('入口点', 'Entrypoint')}</label>
                <input
                  type="text"
                  required
                  readOnly={!!newManifestParsed.manifest}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newManifestParsed.manifest?.entrypoint ?? newEntrypoint}
                  onChange={e => setNewEntrypoint(e.target.value)}
                  placeholder={tx('例如：myalgo.train:main', 'e.g., myalgo.train:main')}
                />
                <p className="text-xs text-gray-500 mt-1">{tx('格式：module:function（例如 algorithms.mappo_train:train）', 'Format: module:function (e.g. algorithms.mappo_train:train)')}</p>
                {newSourceType === 'git' && (
                  <p className="text-xs text-amber-600 mt-1">{tx('Git 来源下，模块必须能从仓库/子目录被导入。', 'For Git sources, module must be importable from the repo/subdir.')}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('来源', 'Source')}</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={newSourceType}
                  onChange={e => setNewSourceType(e.target.value as 'code' | 'path' | 'git' | 'package')}
                >
                  <option value="code">{tx('内联代码', 'Inline code')}</option>
                  <option value="path">{tx('服务器文件路径', 'Server file path')}</option>
                  <option value="git">{tx('Git 仓库', 'Git repository')}</option>
                  <option value="package">{tx('仅依赖包/产物', 'Package/Artifact only')}</option>
                </select>
              </div>
              {newSourceType === 'code' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('内联代码', 'Inline Code')}</label>
                  <textarea
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-40 font-mono text-xs"
                    value={newCode}
                    onChange={e => setNewCode(e.target.value)}
                    placeholder={tx('在此粘贴 Python 代码，入口点需与本文件中的 module:function 一致。', 'Paste your Python code here. The entrypoint should match the module:function in this file.')}
                  />
                </div>
              )}
              {newSourceType === 'path' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('服务器文件路径', 'Server File Path')}</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newSourcePath}
                    onChange={e => setNewSourcePath(e.target.value)}
                    placeholder="/home/dwj/algos/mappo_train.py"
                  />
                  <p className="text-xs text-gray-500 mt-1">{tx('后端会将此文件复制到算法存储。', 'The backend will copy this file into the algorithm store.')}</p>
                </div>
              )}
              {newSourceType === 'git' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('仓库 URL', 'Repo URL')}</label>
                    <input
                      type="text"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={newGitRepo}
                      onChange={e => setNewGitRepo(e.target.value)}
                      placeholder={tx('https://github.com/org/repo.git', 'https://github.com/org/repo.git')}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('分支（可选）', 'Branch (optional)')}</label>
                      <input
                        type="text"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={newGitBranch}
                        onChange={e => setNewGitBranch(e.target.value)}
                        placeholder={tx('main', 'main')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('Commit（可选）', 'Commit (optional)')}</label>
                      <input
                        type="text"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={newGitCommit}
                        onChange={e => setNewGitCommit(e.target.value)}
                        placeholder={tx('abc123', 'abc123')}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('子目录（可选）', 'Subdirectory (optional)')}</label>
                    <input
                      type="text"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={newGitSubdir}
                      onChange={e => setNewGitSubdir(e.target.value)}
                      placeholder={tx('src/algos', 'src/algos')}
                    />
                  </div>
                </div>
              )}
              {newSourceType === 'package' && (
                <p className="text-xs text-gray-500">
                  {tx('不会保存源码。请使用下方依赖包/产物字段保证可复现安装。', 'No source will be stored. Use Package/Artifact fields below for reproducible installs.')}
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('依赖', 'Dependencies')}</label>
                  <input
                    type="text"
                    readOnly
                    className="w-full p-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600"
                    value={(newManifestParsed.manifest?.dependencies || []).join(', ') || tx('无', 'None')}
                  />
                  <p className="text-xs text-gray-500 mt-1">{tx('来自 manifest.dependencies。', 'Derived from manifest.dependencies.')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('产物 URI（可选）', 'Artifact URI (optional)')}</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={newArtifactUri}
                    onChange={e => setNewArtifactUri(e.target.value)}
                    placeholder={tx('s3://.../artifact.tar.gz', 's3://.../artifact.tar.gz')}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700">{tx('高级字段', 'Advanced fields')}</div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {showAdvanced ? tx('隐藏', 'Hide') : tx('显示', 'Show')}
                </button>
              </div>
              {showAdvanced ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('配置 Schema (JSON)', 'Config Schema (JSON)')}</label>
                    <textarea
                      readOnly={!!newManifestParsed.manifest}
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={
                        newManifestParsed.manifest
                          ? JSON.stringify(newManifestParsed.manifest.configSchema || {}, null, 2)
                          : newConfigSchema
                      }
                      onChange={e => setNewConfigSchema(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('默认配置 (JSON)', 'Default Config (JSON)')}</label>
                    <textarea
                      readOnly={!!newManifestParsed.manifest}
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={
                        newManifestParsed.manifest
                          ? JSON.stringify(newManifestParsed.manifest.defaultConfig || {}, null, 2)
                          : newDefaultConfig
                      }
                      onChange={e => setNewDefaultConfig(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('资源画像 (JSON)', 'Resource Profile (JSON)')}</label>
                      <textarea
                        readOnly={!!newManifestParsed.manifest}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                        value={
                          newManifestParsed.manifest
                            ? JSON.stringify(newManifestParsed.manifest.resourceProfile || {}, null, 2)
                            : newResourceProfile
                        }
                        onChange={e => setNewResourceProfile(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('环境约束 (JSON)', 'Env Constraints (JSON)')}</label>
                      <textarea
                        readOnly={!!newManifestParsed.manifest}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                        value={
                          newManifestParsed.manifest
                            ? JSON.stringify(newManifestParsed.manifest.envConstraints || {}, null, 2)
                            : newEnvConstraints
                        }
                        onChange={e => setNewEnvConstraints(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('元数据 (JSON)', 'Metadata (JSON)')}</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={newMetadata}
                      onChange={e => setNewMetadata(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">{tx('保留字段：path、git（由来源自动填充）。', 'Reserved keys: path, git (auto-filled by Source).')}</p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-500">
                  {tx('配置 schema、资源画像、约束与元数据将使用默认值。', 'Using defaults for config schema, resource profile, constraints, and metadata.')}
                </p>
              )}
              <div className="pt-4 flex justify-end gap-3 sticky bottom-0 bg-white pb-2">
                <button type="button" onClick={() => { setIsVersionModalOpen(false); setVersionTarget(null); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">{tx('取消', 'Cancel')}</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">{tx('创建版本', 'Create Version')}</button>
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
                <h2 className="text-lg font-bold text-gray-900">{tx('版本管理', 'Manage Versions')}</h2>
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
                  {manageAlgo.archived ? tx('恢复', 'Restore') : tx('归档', 'Archive')}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => openAlgoEditModal(manageAlgo)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
                  >
                    {tx('编辑', 'Edit')}
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
                    {tx('新增版本', 'Add Version')}
                  </button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-2">{tx('版本', 'Version')}</th>
                      <th className="px-4 py-2">{tx('入口点', 'Entrypoint')}</th>
                      <th className="px-4 py-2">{tx('依赖包', 'Package')}</th>
                      <th className="px-4 py-2">{tx('状态', 'Status')}</th>
                      <th className="px-4 py-2">{tx('Manifest', 'Manifest')}</th>
                      <th className="px-4 py-2">{tx('冻结', 'Frozen')}</th>
                      <th className="px-4 py-2 text-right">{tx('操作', 'Actions')}</th>
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
                            {version.active === false ? tx('禁用', 'Disabled') : tx('激活', 'Active')}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            version.metadata?.manifest ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {version.metadata?.manifest ? tx('Manifest', 'Manifest') : tx('旧版', 'Legacy')}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            version.frozen ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'
                          }`}>
                            {version.frozen ? tx('已冻结', 'Frozen') : tx('可变更', 'Mutable')}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right space-x-2">
                          <button onClick={() => openEditModal(version)} className="text-xs text-blue-600 hover:text-blue-800">
                            {tx('编辑', 'Edit')}
                          </button>
                          <button onClick={() => toggleVersionActive(version)} className="text-xs text-gray-600 hover:text-gray-800">
                            {version.active === false ? tx('启用', 'Enable') : tx('禁用', 'Disable')}
                          </button>
                          <button
                            onClick={() => handleFreezeVersion(version)}
                            disabled={version.frozen}
                            className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                          >
                            {tx('冻结', 'Freeze')}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(algoVersions[manageAlgo.id] || []).length === 0 && (
                      <tr>
                        <td className="px-4 py-4 text-sm text-gray-400" colSpan={7}>{tx('暂无已注册版本。', 'No versions registered.')}</td>
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
              <h2 className="text-lg font-bold text-gray-900">{tx('编辑算法版本', 'Edit Algorithm Version')}</h2>
              <button onClick={() => { setIsEditOpen(false); setEditTarget(null); resetEditFields(); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateVersion} className="p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('算法 Manifest（必填）', 'Algorithm Manifest (required)')}</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-44 font-mono text-xs"
                  value={editManifest}
                  onChange={e => setEditManifest(e.target.value)}
                />
                {editManifestParsed.error && (
                  <p className="text-xs text-red-600 mt-1">{editManifestParsed.error}</p>
                )}
                {!editManifestParsed.error && editManifestParsed.manifest && (
                  <p className="text-xs text-green-700 mt-1">
                    {tx('Manifest 校验通过：', 'Manifest OK:')} {editManifestParsed.manifest.name} v{editManifestParsed.manifest.version}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('入口点', 'Entrypoint')}</label>
                  <input
                    type="text"
                    required
                    readOnly={!!editManifestParsed.manifest}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editManifestParsed.manifest?.entrypoint ?? editEntrypoint}
                    onChange={e => setEditEntrypoint(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('激活状态', 'Active')}</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editActive ? 'true' : 'false'}
                    onChange={e => setEditActive(e.target.value === 'true')}
                  >
                    <option value="true">{tx('激活', 'Active')}</option>
                    <option value="false">{tx('禁用', 'Disabled')}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('依赖', 'Dependencies')}</label>
                  <input
                    type="text"
                    readOnly
                    className="w-full p-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600"
                    value={(editManifestParsed.manifest?.dependencies || []).join(', ') || tx('无', 'None')}
                  />
                  <p className="text-xs text-gray-500 mt-1">{tx('来自 manifest.dependencies。', 'Derived from manifest.dependencies.')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('产物 URI', 'Artifact URI')}</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editArtifactUri}
                    onChange={e => setEditArtifactUri(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('来源覆盖', 'Source Override')}</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={editSourceType}
                  onChange={e => setEditSourceType(e.target.value as 'none' | 'code' | 'path' | 'git')}
                >
                  <option value="none">{tx('保持现有来源', 'Keep existing source')}</option>
                  <option value="code">{tx('内联代码', 'Inline code')}</option>
                  <option value="path">{tx('服务器文件路径', 'Server file path')}</option>
                  <option value="git">{tx('Git 仓库', 'Git repository')}</option>
                </select>
              </div>
              {editSourceType === 'code' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('内联代码', 'Inline Code')}</label>
                  <textarea
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-40 font-mono text-xs"
                    value={editCode}
                    onChange={e => setEditCode(e.target.value)}
                    placeholder={tx('在此粘贴更新后的 Python 代码。', 'Paste updated Python code here.')}
                  />
                </div>
              )}
              {editSourceType === 'path' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('服务器文件路径', 'Server File Path')}</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('仓库 URL', 'Repo URL')}</label>
                    <input
                      type="text"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={editGitRepo}
                      onChange={e => setEditGitRepo(e.target.value)}
                      placeholder={tx('https://github.com/org/repo.git', 'https://github.com/org/repo.git')}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('分支（可选）', 'Branch (optional)')}</label>
                      <input
                        type="text"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={editGitBranch}
                        onChange={e => setEditGitBranch(e.target.value)}
                        placeholder={tx('main', 'main')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('Commit（可选）', 'Commit (optional)')}</label>
                      <input
                        type="text"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={editGitCommit}
                        onChange={e => setEditGitCommit(e.target.value)}
                        placeholder={tx('abc123', 'abc123')}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('子目录（可选）', 'Subdirectory (optional)')}</label>
                    <input
                      type="text"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={editGitSubdir}
                      onChange={e => setEditGitSubdir(e.target.value)}
                      placeholder={tx('src/algos', 'src/algos')}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700">{tx('高级字段', 'Advanced fields')}</div>
                <button
                  type="button"
                  onClick={() => setEditShowAdvanced(!editShowAdvanced)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {editShowAdvanced ? tx('隐藏', 'Hide') : tx('显示', 'Show')}
                </button>
              </div>
              {editShowAdvanced ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('配置 Schema (JSON)', 'Config Schema (JSON)')}</label>
                    <textarea
                      readOnly={!!editManifestParsed.manifest}
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={
                        editManifestParsed.manifest
                          ? JSON.stringify(editManifestParsed.manifest.configSchema || {}, null, 2)
                          : editConfigSchema
                      }
                      onChange={e => setEditConfigSchema(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('默认配置 (JSON)', 'Default Config (JSON)')}</label>
                    <textarea
                      readOnly={!!editManifestParsed.manifest}
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={
                        editManifestParsed.manifest
                          ? JSON.stringify(editManifestParsed.manifest.defaultConfig || {}, null, 2)
                          : editDefaultConfig
                      }
                      onChange={e => setEditDefaultConfig(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('资源画像 (JSON)', 'Resource Profile (JSON)')}</label>
                      <textarea
                        readOnly={!!editManifestParsed.manifest}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                        value={
                          editManifestParsed.manifest
                            ? JSON.stringify(editManifestParsed.manifest.resourceProfile || {}, null, 2)
                            : editResourceProfile
                        }
                        onChange={e => setEditResourceProfile(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('环境约束 (JSON)', 'Env Constraints (JSON)')}</label>
                      <textarea
                        readOnly={!!editManifestParsed.manifest}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                        value={
                          editManifestParsed.manifest
                            ? JSON.stringify(editManifestParsed.manifest.envConstraints || {}, null, 2)
                            : editEnvConstraints
                        }
                        onChange={e => setEditEnvConstraints(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('元数据 (JSON)', 'Metadata (JSON)')}</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={editMetadata}
                      onChange={e => setEditMetadata(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">{tx('保留字段：path、git（由来源自动填充）。', 'Reserved keys: path, git (auto-filled by Source).')}</p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-500">
                  {tx('高级配置字段已隐藏，将保留默认值。', 'Advanced config fields hidden. Defaults will be preserved.')}
                </p>
              )}
              <div className="pt-4 flex justify-end gap-3 sticky bottom-0 bg-white pb-2">
                <button type="button" onClick={() => { setIsEditOpen(false); setEditTarget(null); resetEditFields(); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">{tx('取消', 'Cancel')}</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">{tx('保存', 'Save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAlgoEditOpen && editAlgoTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">{tx('编辑算法', 'Edit Algorithm')}</h2>
              <button onClick={() => { setIsAlgoEditOpen(false); setEditAlgoTarget(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateAlgo} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('名称', 'Name')}</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={editAlgoName}
                  onChange={e => setEditAlgoName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('描述', 'Description')}</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 resize-none"
                  value={editAlgoDescription}
                  onChange={e => setEditAlgoDescription(e.target.value)}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => { setIsAlgoEditOpen(false); setEditAlgoTarget(null); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">{tx('取消', 'Cancel')}</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">{tx('保存', 'Save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
