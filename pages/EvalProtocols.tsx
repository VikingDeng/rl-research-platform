import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { EvalProtocol, EvalProtocolDetail, EnvSpec, EnvVersion, OpponentPool } from '../types';
import { Plus, Lock, Unlock, FileText, X, AlertTriangle, Trash2, Eye, Pencil, Copy } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useI18n } from '../services/i18n';

export const EvalProtocols: React.FC = () => {
  const { showToast } = useToast();
  const { tx } = useI18n();
  const [protocols, setProtocols] = useState<EvalProtocol[]>([]);
  const [envs, setEnvs] = useState<EnvSpec[]>([]);
  const [envVersions, setEnvVersions] = useState<EnvVersion[]>([]);
  const [pools, setPools] = useState<OpponentPool[]>([]);
  const [poolVersions, setPoolVersions] = useState<Record<string, OpponentPool[]>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'frozen'>('all');
  const [scenarioFilter, setScenarioFilter] = useState<'all' | 'custom'>('all');
  const [opponentFilter, setOpponentFilter] = useState<'all' | 'custom'>('all');
  const [hideArchivedEnvs, setHideArchivedEnvs] = useState(true);
  const [showFilterAdvanced, setShowFilterAdvanced] = useState(false);
  
  // Create Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedEnv, setSelectedEnv] = useState('');
  const [selectedEnvVersion, setSelectedEnvVersion] = useState('');
  const [selectedMap, setSelectedMap] = useState('');
  const [episodes, setEpisodes] = useState(50);
  const [seedCount, setSeedCount] = useState(3);
  const [newScenarioGrid, setNewScenarioGrid] = useState('');
  const [newOpponentSampling, setNewOpponentSampling] = useState('');
  const [newPoolId, setNewPoolId] = useState('');
  const [newPoolVersion, setNewPoolVersion] = useState('');
  const [versionName, setVersionName] = useState('');
  const [versionTarget, setVersionTarget] = useState<EvalProtocol | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [versionScenarioGrid, setVersionScenarioGrid] = useState('');
  const [versionOpponentSampling, setVersionOpponentSampling] = useState('');
  const [showVersionAdvanced, setShowVersionAdvanced] = useState(false);
  const [versionPoolId, setVersionPoolId] = useState('');
  const [versionPoolVersion, setVersionPoolVersion] = useState('');
  const [detailTarget, setDetailTarget] = useState<EvalProtocol | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EvalProtocolDetail | null>(null);
  const [editName, setEditName] = useState('');
  const [editEnvId, setEditEnvId] = useState('');
  const [editEnvVersion, setEditEnvVersion] = useState('');
  const [editMapSet, setEditMapSet] = useState('');
  const [editEnvVersions, setEditEnvVersions] = useState<EnvVersion[]>([]);
  const [editSeedCount, setEditSeedCount] = useState(3);
  const [editEpisodes, setEditEpisodes] = useState(50);
  const [editScenarioGrid, setEditScenarioGrid] = useState('');
  const [editOpponentSampling, setEditOpponentSampling] = useState('');
  const [showEditAdvanced, setShowEditAdvanced] = useState(false);
  const [editPoolId, setEditPoolId] = useState('');
  const [editPoolVersion, setEditPoolVersion] = useState('');

  const parseJsonField = (value: string, label: string) => {
    if (!value.trim()) return undefined;
    try {
      return JSON.parse(value);
    } catch (err) {
      showToast(tx(`${label} JSON 无效。`, `${label} JSON is invalid.`), 'error');
      return null;
    }
  };

  const countScenarioGrid = (grid?: Record<string, any>) => {
    if (!grid) return 0;
    if (Array.isArray((grid as any).scenarios)) {
      return (grid as any).scenarios.length;
    }
    const axes = (grid as any).axes;
    if (axes && typeof axes === 'object') {
      const lengths = Object.values(axes).map(val => Array.isArray(val) ? val.length : 0);
      if (lengths.length === 0) return 0;
      return lengths.reduce((acc, len) => acc * Math.max(1, len), 1);
    }
    return 0;
  };

  const formatJson = (value?: Record<string, any>) => {
    if (!value) return tx('默认', 'Default');
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

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
    api.getPools().then(setPools);
  }, []);

  const loadPoolVersions = (poolId: string) => {
    if (!poolId || poolVersions[poolId]) return;
    api.listPoolVersions(poolId).then((versions) => {
      setPoolVersions(prev => ({ ...prev, [poolId]: versions }));
    });
  };

  useEffect(() => {
    if (!isEditOpen || !editEnvId) {
      setEditEnvVersions([]);
      return;
    }
    api.getEnvVersions(editEnvId).then(versions => {
      const enabled = versions.filter(v => v.active !== false);
      const usable = enabled.length ? enabled : versions;
      const sorted = [...usable].sort((a, b) => (b.version || '').localeCompare(a.version || ''));
      setEditEnvVersions(sorted);
      if (!editEnvVersion) {
        const chosen = sorted[0] || versions[0];
        setEditEnvVersion(chosen?.version || '');
        const env = envs.find(e => e.id === editEnvId);
        setEditMapSet(selectDefaultMap(chosen, env));
      }
    });
  }, [isEditOpen, editEnvId]);

  useEffect(() => {
    if (!isEditOpen || !editPoolId) {
      return;
    }
    loadPoolVersions(editPoolId);
    const latest = poolVersions[editPoolId]?.[0]?.version || pools.find(p => p.id === editPoolId)?.version || '';
    if (!editPoolVersion && latest) {
      setEditPoolVersion(latest);
    }
  }, [isEditOpen, editPoolId, poolVersions, pools, editPoolVersion]);

  useEffect(() => {
    if (!isEditOpen || !editEnvId || !editEnvVersion) return;
    const env = envs.find(e => e.id === editEnvId);
    const version = editEnvVersions.find(v => v.version === editEnvVersion);
    const options = resolveMapOptions(version, env);
    if (options.length === 0) {
      if (editMapSet !== 'default') {
        setEditMapSet('default');
      }
      return;
    }
    if (!options.includes(editMapSet)) {
      setEditMapSet(options[0]);
    }
  }, [isEditOpen, editEnvId, editEnvVersion, editEnvVersions, editMapSet, envs]);

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
    if (newPoolId) {
      loadPoolVersions(newPoolId);
      const latest = poolVersions[newPoolId]?.[0]?.version || pools.find(p => p.id === newPoolId)?.version || '';
      if (!newPoolVersion && latest) {
        setNewPoolVersion(latest);
      }
    }
  }, [newPoolId, poolVersions, pools, newPoolVersion]);

  useEffect(() => {
    if (versionPoolId) {
      loadPoolVersions(versionPoolId);
      const latest = poolVersions[versionPoolId]?.[0]?.version || pools.find(p => p.id === versionPoolId)?.version || '';
      if (!versionPoolVersion && latest) {
        setVersionPoolVersion(latest);
      }
    }
  }, [versionPoolId, poolVersions, pools, versionPoolVersion]);

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
    const scenarioGrid = parseJsonField(newScenarioGrid, 'Scenario Grid');
    if (scenarioGrid === null) return;
    const opponentSampling = parseJsonField(newOpponentSampling, 'Opponent Sampling');
    if (opponentSampling === null) return;
    const resolvedPoolVersion =
      newPoolVersion || pools.find(p => p.id === newPoolId)?.version || '';
    if (newPoolId && !resolvedPoolVersion) {
      showToast(tx('请选择对手池版本。', 'Please select an opponent pool version.'), 'error');
      return;
    }
    const evalSeeds = Array.from({ length: seedCount }, (_, idx) => idx + 1);
    api
      .createProtocol({
        name: newName,
        env: { envId: selectedEnv, version: selectedEnvVersion, mapSet: selectedMap },
        evalSeeds,
        episodesPerMatch: episodes,
        scenarioGrid,
        opponentSampling,
        opponentPoolRef: newPoolId
          ? { poolId: newPoolId, version: resolvedPoolVersion }
          : undefined,
      })
      .then(() => api.getProtocols().then(setProtocols))
      .finally(() => {
        setIsCreateOpen(false);
        setNewScenarioGrid('');
        setNewOpponentSampling('');
        setNewPoolId('');
        setNewPoolVersion('');
        setShowAdvanced(false);
      });
  }

  const handleFreeze = (id: string) => {
      api.freezeProtocol(id).then(() => {
        setProtocols(protocols.map(p => p.id === id ? { ...p, frozen: true } : p));
      });
  }

  const handleCreateVersion = (e: React.FormEvent) => {
      e.preventDefault();
      if (!versionTarget) return;
      const scenarioGrid = parseJsonField(versionScenarioGrid, 'Scenario Grid');
      if (scenarioGrid === null) return;
      const opponentSampling = parseJsonField(versionOpponentSampling, 'Opponent Sampling');
      if (opponentSampling === null) return;
      const resolvedPoolVersion =
        versionPoolVersion || pools.find(p => p.id === versionPoolId)?.version || '';
      if (versionPoolId && !resolvedPoolVersion) {
        showToast(tx('请选择对手池版本。', 'Please select an opponent pool version.'), 'error');
        return;
      }
      api
        .createProtocolVersion(versionTarget.id, {
          version: versionName || undefined,
          scenarioGrid,
          opponentSampling,
          opponentPoolRef: versionPoolId
            ? { poolId: versionPoolId, version: resolvedPoolVersion }
            : undefined,
        })
        .then(() => api.getProtocols().then(setProtocols))
        .finally(() => closeVersionModal());
  }

  const closeVersionModal = () => {
    setVersionName('');
    setVersionScenarioGrid('');
    setVersionOpponentSampling('');
    setVersionPoolId('');
    setVersionPoolVersion('');
    setShowVersionAdvanced(false);
    setVersionTarget(null);
  };

  const openVersionModal = (proto: EvalProtocol, mode: 'blank' | 'copy') => {
    setVersionTarget(proto);
    setVersionName('');
    if (mode === 'copy') {
      setVersionScenarioGrid(
        proto.scenarioGrid ? JSON.stringify(proto.scenarioGrid, null, 2) : '',
      );
      setVersionOpponentSampling(
        proto.opponentSampling ? JSON.stringify(proto.opponentSampling, null, 2) : '',
      );
      setVersionPoolId(proto.opponentPoolRef?.poolId || '');
      setVersionPoolVersion(proto.opponentPoolRef?.version || '');
      setShowVersionAdvanced(true);
    } else {
      setVersionScenarioGrid('');
      setVersionOpponentSampling('');
      setVersionPoolId('');
      setVersionPoolVersion('');
      setShowVersionAdvanced(false);
    }
  };

  const handleDelete = (protocol: EvalProtocol) => {
    if (!window.confirm(tx(`删除协议 "${protocol.name}" 及其所有版本/结果？`, `Delete protocol "${protocol.name}" and all its versions/results?`))) {
      return;
    }
    api
      .deleteProtocol(protocol.id)
      .then(() => api.getProtocols().then(setProtocols))
      .then(() => showToast(tx(`已删除协议 "${protocol.name}"。`, `Deleted protocol "${protocol.name}".`), 'success'))
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(tx(`删除协议失败：${detail}`, `Failed to delete protocol: ${detail}`), 'error');
      });
  }

  const closeDetailModal = () => {
    setDetailTarget(null);
  };

  const filteredProtocols = protocols.filter((proto) => {
    if (hideArchivedEnvs) {
      const env = envs.find(e => e.id === proto.envId);
      if (env?.archived) return false;
    }
    if (statusFilter === 'draft' && proto.frozen) return false;
    if (statusFilter === 'frozen' && !proto.frozen) return false;
    if (scenarioFilter === 'custom' && !proto.scenarioGrid) return false;
    if (opponentFilter === 'custom' && !proto.opponentSampling) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      proto.name.toLowerCase().includes(q) ||
      proto.id.toLowerCase().includes(q) ||
      proto.envId.toLowerCase().includes(q) ||
      proto.map.toLowerCase().includes(q)
    );
  });

  const hasActiveFilters =
    search.trim().length > 0 ||
    statusFilter !== 'all' ||
    scenarioFilter !== 'all' ||
    opponentFilter !== 'all' ||
    !hideArchivedEnvs;

  const totalCount = protocols.length;
  const draftCount = protocols.filter(p => !p.frozen).length;
  const frozenCount = protocols.filter(p => p.frozen).length;
  const scenarioCustomCount = protocols.filter(p => !!p.scenarioGrid).length;
  const opponentCustomCount = protocols.filter(p => !!p.opponentSampling).length;
  const filteredCount = filteredProtocols.length;

  const openEditModal = (proto: EvalProtocol) => {
    api
      .getProtocolById(proto.id)
      .then((detail) => {
        setEditTarget(detail as EvalProtocolDetail);
        setEditName(detail.name || '');
        setEditEnvId(detail.env.envId);
        setEditEnvVersion(detail.env.version);
        setEditMapSet(detail.env.mapSet);
        setEditEnvVersions([]);
        setEditPoolId(detail.opponentPoolRef?.poolId || '');
        setEditPoolVersion(detail.opponentPoolRef?.version || '');
        setEditSeedCount(detail.evalSeeds.length || 1);
        setEditEpisodes(detail.episodesPerMatch || 1);
        setEditScenarioGrid(detail.scenarioGrid ? JSON.stringify(detail.scenarioGrid, null, 2) : '');
        setEditOpponentSampling(detail.opponentSampling ? JSON.stringify(detail.opponentSampling, null, 2) : '');
        setShowEditAdvanced(false);
        setIsEditOpen(true);
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(tx(`加载协议失败：${detail}`, `Failed to load protocol: ${detail}`), 'error');
      });
  };

  const closeEditModal = () => {
    setIsEditOpen(false);
    setEditTarget(null);
    setEditName('');
    setEditEnvId('');
    setEditEnvVersion('');
    setEditMapSet('');
    setEditEnvVersions([]);
    setEditPoolId('');
    setEditPoolVersion('');
    setEditSeedCount(3);
    setEditEpisodes(50);
    setEditScenarioGrid('');
    setEditOpponentSampling('');
    setShowEditAdvanced(false);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editName.trim() || !editEnvId || !editEnvVersion || !editMapSet) return;
    const scenarioGrid = editScenarioGrid.trim()
      ? parseJsonField(editScenarioGrid, 'Scenario Grid')
      : null;
    if (scenarioGrid === null && editScenarioGrid.trim()) return;
    const opponentSampling = editOpponentSampling.trim()
      ? parseJsonField(editOpponentSampling, 'Opponent Sampling')
      : null;
    if (opponentSampling === null && editOpponentSampling.trim()) return;
    const resolvedPoolVersion =
      editPoolVersion || pools.find(p => p.id === editPoolId)?.version || '';
    if (editPoolId && !resolvedPoolVersion) {
      showToast(tx('请选择对手池版本。', 'Please select an opponent pool version.'), 'error');
      return;
    }
    const evalSeeds = Array.from({ length: editSeedCount }, (_, idx) => idx + 1);
    api
      .updateProtocol(editTarget.id, {
        name: editName.trim(),
        env: {
          envId: editEnvId,
          version: editEnvVersion,
          mapSet: editMapSet,
        },
        evalSeeds,
        episodesPerMatch: editEpisodes,
        scenarioGrid,
        opponentSampling,
        opponentPoolRef: editPoolId
          ? { poolId: editPoolId, version: resolvedPoolVersion }
          : null,
      })
      .then(() => api.getProtocols().then(setProtocols))
      .then(() => showToast(tx('协议已更新。', 'Protocol updated.'), 'success'))
      .finally(() => closeEditModal());
  };

  return (
    <div className="space-y-6 relative">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{tx('评估协议', 'Evaluation Protocols')}</h1>
          <p className="text-gray-500 mt-1">{tx('标准化评估设置，保障对比公平。', 'Standardize evaluation settings for fair comparisons.')}</p>
        </div>
        <button 
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" /> {tx('新建协议', 'New Protocol')}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm sticky top-6 z-20">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">{tx('搜索', 'Search')}</label>
            <input
              type="text"
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder={tx('名称、ID、环境、地图...', 'Name, ID, env, map...')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="min-w-[140px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">{tx('状态', 'Status')}</label>
            <select
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as 'all' | 'draft' | 'frozen')}
            >
              <option value="all">{tx('全部', 'All')}</option>
              <option value="draft">{tx('草稿', 'Draft')}</option>
              <option value="frozen">{tx('冻结', 'Frozen')}</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setScenarioFilter(scenarioFilter === 'custom' ? 'all' : 'custom')}
              className={`px-3 py-2 rounded-lg border text-xs font-medium ${scenarioFilter === 'custom' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {tx('自定义场景网格', 'Custom Grid')}
            </button>
            <button
              type="button"
              onClick={() => setOpponentFilter(opponentFilter === 'custom' ? 'all' : 'custom')}
              className={`px-3 py-2 rounded-lg border text-xs font-medium ${opponentFilter === 'custom' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {tx('自定义对手采样', 'Custom Opponents')}
            </button>
            <button
              type="button"
              onClick={() => setShowFilterAdvanced(!showFilterAdvanced)}
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              {showFilterAdvanced ? tx('隐藏高级筛选', 'Hide Advanced') : tx('高级筛选', 'Advanced')}
            </button>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setScenarioFilter('all');
                setOpponentFilter('all');
                setHideArchivedEnvs(true);
              }}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-2"
            >
              {tx('清除筛选', 'Clear Filters')}
            </button>
          )}
        </div>
        {showFilterAdvanced && (
          <div className="mt-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={hideArchivedEnvs}
                onChange={e => setHideArchivedEnvs(e.target.checked)}
              />
              {tx('隐藏已归档环境', 'Hide Archived Envs')}
            </label>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-medium text-gray-600">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-full border ${statusFilter === 'all' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
          >
            {tx('总计', 'Total')} {totalCount}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('draft')}
            className={`px-3 py-1.5 rounded-full border ${statusFilter === 'draft' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
          >
            {tx('草稿', 'Draft')} {draftCount}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('frozen')}
            className={`px-3 py-1.5 rounded-full border ${statusFilter === 'frozen' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
          >
            {tx('冻结', 'Frozen')} {frozenCount}
          </button>
          <button
            type="button"
            onClick={() => setScenarioFilter(scenarioFilter === 'custom' ? 'all' : 'custom')}
            className={`px-3 py-1.5 rounded-full border ${scenarioFilter === 'custom' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
          >
            {tx('自定义网格', 'Custom Grid')} {scenarioCustomCount}
          </button>
          <button
            type="button"
            onClick={() => setOpponentFilter(opponentFilter === 'custom' ? 'all' : 'custom')}
            className={`px-3 py-1.5 rounded-full border ${opponentFilter === 'custom' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
          >
            {tx('自定义对手', 'Custom Opponents')} {opponentCustomCount}
          </button>
        </div>
        <div className="text-xs text-gray-500">
          {tx('显示', 'Showing')} {filteredCount} {tx('共', 'of')} {totalCount}
          {search.trim() && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="ml-2 text-xs text-blue-600 hover:text-blue-700"
            >
              {tx('清除搜索', 'Clear search')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProtocols.map(proto => {
          const scenarioCount = countScenarioGrid(proto.scenarioGrid as Record<string, any> | undefined);
          const envArchived = envs.find(e => e.id === proto.envId)?.archived;
          return (
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
                  <Lock className="w-3 h-3 mr-1" /> {tx('冻结', 'Frozen')}
                </span>
              ) : (
                <span className="px-2 py-1 bg-green-50 text-green-600 text-xs rounded-full flex items-center font-medium">
                  <Unlock className="w-3 h-3 mr-1" /> {tx('草稿', 'Draft')}
                </span>
              )}
            </div>
            
            <h3 className="font-bold text-gray-900 mb-1 relative z-10">{proto.name}</h3>
            <p className="text-xs text-gray-400 font-mono mb-1">{proto.id}</p>
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
              <span>{tx('版本', 'Version')}: v{proto.version}</span>
              {envArchived && (
                <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded-full border border-red-100">{tx('环境已归档', 'Env Archived')}</span>
              )}
            </div>
            
            <div className="space-y-2 text-sm text-gray-600 relative z-10">
              <div className="flex justify-between border-b border-gray-50 pb-2">
                <span>{tx('环境：', 'Environment:')}</span>
                <span className="font-medium">{proto.envId} / {proto.map}</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-2">
                <span>{tx('评估种子：', 'Eval Seeds:')}</span>
                <span className="font-medium text-gray-900">{proto.evalSeeds.length}</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-2">
                <span>{tx('每种子回合数：', 'Episodes/Seed:')}</span>
                <span className="font-medium text-gray-900">{proto.episodes}</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-2">
                <span>{tx('场景：', 'Scenarios:')}</span>
                <span className="font-medium text-gray-900">{scenarioCount > 0 ? scenarioCount : tx('默认', 'Default')}</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-2">
                <span>{tx('对手采样：', 'Opponent Sampling:')}</span>
                <span className="font-medium text-gray-900">{proto.opponentSampling ? tx('自定义', 'Custom') : tx('默认', 'Default')}</span>
              </div>
            </div>

            <div className="mt-6 flex gap-2 relative z-10">
              {proto.frozen ? (
                <>
                  <button
                    onClick={() => openVersionModal(proto, 'blank')}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {tx('新版本', 'New Version')}
                  </button>
                  <button
                    onClick={() => openVersionModal(proto, 'copy')}
                    className="px-3 py-2 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-100 flex items-center"
                    title={tx('复制为新版本', 'Copy as new version')}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => openEditModal(proto)}
                  className="flex-1 px-3 py-2 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-100 flex items-center justify-center"
                  title={tx('编辑协议', 'Edit protocol')}
                >
                  <Pencil className="w-4 h-4 mr-2" /> {tx('编辑草稿', 'Edit Draft')}
                </button>
              )}
              <button
                onClick={() => setDetailTarget(proto)}
                className="px-3 py-2 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-sm font-medium hover:bg-blue-100 flex items-center"
                title={tx('查看协议详情', 'View protocol details')}
              >
                <Eye className="w-4 h-4" />
              </button>
              {!proto.frozen && (
                 <button 
                    onClick={() => handleFreeze(proto.id)}
                    className="px-3 py-2 bg-orange-50 text-orange-700 border border-orange-100 rounded-lg text-sm font-medium hover:bg-orange-100 flex items-center"
                    title={tx('冻结协议', 'Freeze Protocol')}
                 >
                    <Lock className="w-4 h-4" />
                 </button>
              )}
              <button
                onClick={() => handleDelete(proto)}
                className="px-3 py-2 bg-red-50 text-red-700 border border-red-100 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center"
                title={tx('删除协议', 'Delete Protocol')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )})}
        {filteredProtocols.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-400">
            {tx('没有协议匹配当前筛选条件。', 'No protocols match the current filters.')}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-900">{tx('创建评估协议', 'Create Eval Protocol')}</h2>
                    <button onClick={() => setIsCreateOpen(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleCreate} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{tx('协议名称', 'Protocol Name')}</label>
                        <input 
                            type="text" 
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            placeholder={tx('例如：Standard Benchmark v2', 'e.g., Standard Benchmark v2')}
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                        />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{tx('环境', 'Environment')}</label>
                          <select 
                              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              value={selectedEnv}
                              onChange={e => setSelectedEnv(e.target.value)}
                          >
                            <option value="">{tx('选择环境', 'Select Env')}</option>
                            {envs.map(e => <option key={e.id} value={e.id}>{e.id}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{tx('版本', 'Version')}</label>
                          <select 
                              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              value={selectedEnvVersion}
                              onChange={e => setSelectedEnvVersion(e.target.value)}
                              disabled={!selectedEnv}
                          >
                             <option value="">{tx('选择版本', 'Select Version')}</option>
                             {envVersions.map(v => <option key={v.version} value={v.version}>{v.version}</option>)}
                          </select>
                      </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{tx('地图集', 'Map Set')}</label>
                        <select 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={selectedMap}
                            onChange={e => setSelectedMap(e.target.value)}
                            disabled={!selectedEnvVersion}
                        >
                           <option value="">{tx('选择地图集', 'Select Map Set')}</option>
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
                             : <option value="default">{tx('默认', 'default')}</option>
                           }
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          {resolveMapOptions(
                            envVersions.find(v => v.version === selectedEnvVersion),
                            envs.find(e => e.id === selectedEnv),
                          ).length > 0
                            ? tx('请选择预定义地图集。', 'Select a predefined map set.')
                            : tx('未注册地图集，将使用默认值。', 'No map sets registered; using default.')}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                             <label className="block text-sm font-medium text-gray-700 mb-1">{tx('随机种子', 'Random Seeds')}</label>
                             <input 
                                type="number" 
                                className="w-full p-2 border border-gray-300 rounded-lg"
                                value={seedCount}
                                onChange={e => setSeedCount(Number(e.target.value))}
                                min={1} max={100}
                             />
                             <p className="text-xs text-gray-500 mt-1">{tx('不同种子运行数量。', 'Number of distinct seed runs.')}</p>
                        </div>
                        <div>
                             <label className="block text-sm font-medium text-gray-700 mb-1">{tx('每种子回合数', 'Episodes / Seed')}</label>
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
                            {tx('协议将以', 'Protocol will be created in ')}<strong>{tx('草稿', 'Draft')}</strong>{tx('模式创建，在用于正式基准报告前必须', ' mode. You must ')}<strong>{tx('冻结', 'Freeze')}</strong>{tx('。', ' it before using it in official benchmark reports.')}
                        </p>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <button
                        type="button"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        {showAdvanced ? tx('隐藏高级评估控制', 'Hide advanced evaluation controls') : tx('显示高级评估控制', 'Show advanced evaluation controls')}
                      </button>
                    </div>

                    {showAdvanced && (
                      <div className="space-y-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{tx('对手池', 'Opponent Pool')}</label>
                          <select
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={newPoolId}
                            onChange={e => {
                              setNewPoolId(e.target.value);
                              setNewPoolVersion('');
                            }}
                          >
                            <option value="">{tx('无', 'None')}</option>
                            {pools.map(pool => (
                              <option key={pool.id} value={pool.id}>{pool.name} (v{pool.version})</option>
                            ))}
                          </select>
                        </div>
                        {newPoolId && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{tx('池版本', 'Pool Version')}</label>
                            <select
                              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              value={newPoolVersion}
                              onChange={e => setNewPoolVersion(e.target.value)}
                            >
                              <option value="">{tx('选择版本', 'Select Version')}</option>
                              {(poolVersions[newPoolId] || []).map(v => (
                                <option key={v.version} value={v.version}>{v.version}</option>
                              ))}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">{tx('为空则使用最新池版本。', 'If empty, the latest pool version is used.')}</p>
                          </div>
                        )}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{tx('场景网格 (JSON)', 'Scenario Grid (JSON)')}</label>
                          <textarea
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                            placeholder={`{\n  \"axes\": {\n    \"delay\": [\"low\", \"mid\", \"high\"],\n    \"uncertainty\": [\"low\", \"high\"]\n  }\n}`}
                            value={newScenarioGrid}
                            onChange={e => setNewScenarioGrid(e.target.value)}
                          />
                          <p className="text-xs text-gray-500 mt-1">{tx('留空则使用环境默认设置。', 'Leave blank to use the environment default.')}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{tx('对手采样 (JSON)', 'Opponent Sampling (JSON)')}</label>
                          <textarea
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                            placeholder={`{\n  \"poolId\": \"pool_01\",\n  \"strategy\": \"weighted\",\n  \"weights\": {\n    \"baseline\": 0.7,\n    \"adversarial\": 0.3\n  }\n}`}
                            value={newOpponentSampling}
                            onChange={e => setNewOpponentSampling(e.target.value)}
                          />
                          <p className="text-xs text-gray-500 mt-1">{tx('可选：对手群体采样策略。', 'Optional sampling policy for opponent populations.')}</p>
                        </div>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end gap-3">
                        <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">{tx('取消', 'Cancel')}</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">{tx('创建协议', 'Create Protocol')}</button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {versionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">{tx('创建协议版本', 'Create Protocol Version')}</h2>
              <button onClick={closeVersionModal} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVersion} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('基础协议', 'Base Protocol')}</label>
                <div className="text-sm text-gray-600">{versionTarget.name} (v{versionTarget.version})</div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
                <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                  <div className="font-medium text-gray-600">{tx('场景', 'Scenarios')}</div>
                  <div>{countScenarioGrid(versionTarget.scenarioGrid as Record<string, any> | undefined) || tx('默认', 'Default')}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                  <div className="font-medium text-gray-600">{tx('对手采样', 'Opponent Sampling')}</div>
                  <div>{versionTarget.opponentSampling ? tx('自定义', 'Custom') : tx('默认', 'Default')}</div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('新版本号', 'New Version')}</label>
                <input
                  type="text"
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder={tx('例如：2.0.0', 'e.g., 2.0.0')}
                  value={versionName}
                  onChange={e => setVersionName(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setShowVersionAdvanced(!showVersionAdvanced)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  {showVersionAdvanced ? tx('隐藏高级覆盖项', 'Hide advanced overrides') : tx('显示高级覆盖项', 'Show advanced overrides')}
                </button>
              </div>
              {showVersionAdvanced && (
                <div className="space-y-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('对手池', 'Opponent Pool')}</label>
                    <select
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={versionPoolId}
                      onChange={e => {
                        setVersionPoolId(e.target.value);
                        setVersionPoolVersion('');
                      }}
                    >
                      <option value="">{tx('无', 'None')}</option>
                      {pools.map(pool => (
                        <option key={pool.id} value={pool.id}>{pool.name} (v{pool.version})</option>
                      ))}
                    </select>
                  </div>
                  {versionPoolId && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('池版本', 'Pool Version')}</label>
                      <select
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={versionPoolVersion}
                        onChange={e => setVersionPoolVersion(e.target.value)}
                      >
                        <option value="">{tx('选择版本', 'Select Version')}</option>
                        {(poolVersions[versionPoolId] || []).map(v => (
                          <option key={v.version} value={v.version}>{v.version}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">{tx('为空则使用最新池版本。', 'If empty, the latest pool version is used.')}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('场景网格 (JSON)', 'Scenario Grid (JSON)')}</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      placeholder={`{\n  \"axes\": {\n    \"delay\": [\"low\", \"mid\", \"high\"],\n    \"uncertainty\": [\"low\", \"high\"]\n  }\n}`}
                      value={versionScenarioGrid}
                      onChange={e => setVersionScenarioGrid(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">{tx('留空则继承基础协议。', 'Leave blank to inherit from the base protocol.')}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('对手采样 (JSON)', 'Opponent Sampling (JSON)')}</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      placeholder={`{\n  \"poolId\": \"pool_01\",\n  \"strategy\": \"weighted\",\n  \"weights\": {\n    \"baseline\": 0.7,\n    \"adversarial\": 0.3\n  }\n}`}
                      value={versionOpponentSampling}
                      onChange={e => setVersionOpponentSampling(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">{tx('留空则继承基础协议。', 'Leave blank to inherit from the base protocol.')}</p>
                  </div>
                </div>
              )}
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={closeVersionModal} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">{tx('取消', 'Cancel')}</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">{tx('创建版本', 'Create Version')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isEditOpen && editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">{tx('编辑草稿协议', 'Edit Draft Protocol')}</h2>
              <button onClick={closeEditModal} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tx('协议名称', 'Protocol Name')}</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
              </div>
              {envs.find(e => e.id === editEnvId)?.archived && (
                <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-xs text-red-700">
                  {tx('该环境已归档，建议切换到激活环境/版本。', 'This environment is archived. Consider switching to an active environment/version.')}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('随机种子', 'Random Seeds')}</label>
                  <input
                    type="number"
                    className="w-full p-2 border border-gray-300 rounded-lg"
                    value={editSeedCount}
                    onChange={e => setEditSeedCount(Number(e.target.value))}
                    min={1} max={100}
                  />
                  <p className="text-xs text-gray-500 mt-1">{tx('种子将按 1..N 重新生成。', 'Seeds regenerate from 1..N.')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{tx('每种子回合数', 'Episodes / Seed')}</label>
                  <input
                    type="number"
                    className="w-full p-2 border border-gray-300 rounded-lg"
                    value={editEpisodes}
                    onChange={e => setEditEpisodes(Number(e.target.value))}
                    min={1}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setShowEditAdvanced(!showEditAdvanced)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  {showEditAdvanced ? tx('隐藏高级覆盖项', 'Hide advanced overrides') : tx('显示高级覆盖项', 'Show advanced overrides')}
                </button>
              </div>

              {showEditAdvanced && (
                <div className="space-y-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('环境', 'Environment')}</label>
                    <select
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={editEnvId}
                      onChange={e => {
                        setEditEnvId(e.target.value);
                        setEditEnvVersion('');
                        setEditMapSet('');
                      }}
                    >
                      <option value="">{tx('选择环境', 'Select Env')}</option>
                      {envs.map(e => <option key={e.id} value={e.id}>{e.id}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('版本', 'Version')}</label>
                      <select
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={editEnvVersion}
                        onChange={e => setEditEnvVersion(e.target.value)}
                        disabled={!editEnvId}
                      >
                        <option value="">{tx('选择版本', 'Select Version')}</option>
                        {editEnvVersions.map(v => <option key={v.version} value={v.version}>{v.version}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('地图集', 'Map Set')}</label>
                      <select
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={editMapSet}
                        onChange={e => setEditMapSet(e.target.value)}
                        disabled={!editEnvVersion}
                      >
                        <option value="">{tx('选择地图集', 'Select Map Set')}</option>
                        {resolveMapOptions(
                          editEnvVersions.find(v => v.version === editEnvVersion),
                          envs.find(e => e.id === editEnvId),
                        ).length > 0
                          ? resolveMapOptions(
                              editEnvVersions.find(v => v.version === editEnvVersion),
                              envs.find(e => e.id === editEnvId),
                            ).map(option => (
                              <option key={option} value={option}>{option}</option>
                            ))
                          : <option value="default">{tx('默认', 'default')}</option>
                        }
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    {resolveMapOptions(
                      editEnvVersions.find(v => v.version === editEnvVersion),
                      envs.find(e => e.id === editEnvId),
                    ).length > 0
                      ? tx('请选择预定义地图集。', 'Select a predefined map set.')
                      : tx('未注册地图集，将使用默认值。', 'No map sets registered; using default.')}
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('对手池', 'Opponent Pool')}</label>
                    <select
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={editPoolId}
                      onChange={e => {
                        setEditPoolId(e.target.value);
                        setEditPoolVersion('');
                      }}
                    >
                      <option value="">{tx('无', 'None')}</option>
                      {pools.map(pool => (
                        <option key={pool.id} value={pool.id}>{pool.name} (v{pool.version})</option>
                      ))}
                    </select>
                  </div>
                  {editPoolId && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tx('池版本', 'Pool Version')}</label>
                      <select
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={editPoolVersion}
                        onChange={e => setEditPoolVersion(e.target.value)}
                      >
                        <option value="">{tx('选择版本', 'Select Version')}</option>
                        {(poolVersions[editPoolId] || []).map(v => (
                          <option key={v.version} value={v.version}>{v.version}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">{tx('为空则使用最新池版本。', 'If empty, the latest pool version is used.')}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('场景网格 (JSON)', 'Scenario Grid (JSON)')}</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={editScenarioGrid}
                      onChange={e => setEditScenarioGrid(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">{tx('留空将清空并使用默认值。', 'Leave blank to clear and use defaults.')}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{tx('对手采样 (JSON)', 'Opponent Sampling (JSON)')}</label>
                    <textarea
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                      value={editOpponentSampling}
                      onChange={e => setEditOpponentSampling(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">{tx('留空将清空并使用默认值。', 'Leave blank to clear and use defaults.')}</p>
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-3">
                <button type="button" onClick={closeEditModal} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">{tx('取消', 'Cancel')}</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">{tx('保存更改', 'Save Changes')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{tx('协议详情', 'Protocol Details')}</h2>
                <p className="text-xs text-gray-500 mt-1">{detailTarget.name} (v{detailTarget.version})</p>
              </div>
              <button onClick={closeDetailModal} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                {envs.find(e => e.id === detailTarget.envId)?.archived && (
                  <div className="col-span-2 bg-red-50 border border-red-100 rounded-lg p-3 text-xs text-red-700">
                    {tx('环境已归档，建议将该协议迁移到激活环境/版本。', 'Environment is archived. Consider migrating this protocol to an active environment/version.')}
                  </div>
                )}
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="text-xs text-gray-500">{tx('环境', 'Environment')}</div>
                  <div className="font-medium text-gray-900">{detailTarget.envId} / {detailTarget.map}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="text-xs text-gray-500">{tx('每种子回合数', 'Episodes/Seed')}</div>
                  <div className="font-medium text-gray-900">{detailTarget.episodes}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="text-xs text-gray-500">{tx('评估种子', 'Eval Seeds')}</div>
                  <div className="font-medium text-gray-900">{detailTarget.evalSeeds.length}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="text-xs text-gray-500">{tx('场景数量', 'Scenario Count')}</div>
                  <div className="font-medium text-gray-900">{countScenarioGrid(detailTarget.scenarioGrid as Record<string, any> | undefined) || tx('默认', 'Default')}</div>
                </div>
                {detailTarget.opponentPoolRef && (
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 col-span-2">
                    <div className="text-xs text-gray-500">{tx('对手池', 'Opponent Pool')}</div>
                    <div className="font-medium text-gray-900">
                      {detailTarget.opponentPoolRef.poolId} (v{detailTarget.opponentPoolRef.version})
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{tx('场景网格', 'Scenario Grid')}</label>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 overflow-auto max-h-64">
                  {formatJson(detailTarget.scenarioGrid as Record<string, any> | undefined)}
                </pre>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{tx('对手采样', 'Opponent Sampling')}</label>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 overflow-auto max-h-64">
                  {formatJson(detailTarget.opponentSampling as Record<string, any> | undefined)}
                </pre>
              </div>
            </div>
            <div className="p-6 pt-0 flex justify-between items-center">
              <div className="flex items-center gap-2">
                {detailTarget.frozen ? (
                  <button
                    onClick={() => {
                      openVersionModal(detailTarget, 'copy');
                      closeDetailModal();
                    }}
                    className="px-4 py-2 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-100 flex items-center"
                  >
                    <Copy className="w-4 h-4 mr-2" /> {tx('复制为版本', 'Copy as Version')}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      openEditModal(detailTarget);
                      closeDetailModal();
                    }}
                    className="px-4 py-2 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-100 flex items-center"
                  >
                    <Pencil className="w-4 h-4 mr-2" /> {tx('编辑草稿', 'Edit Draft')}
                  </button>
                )}
              </div>
              <button onClick={closeDetailModal} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">{tx('关闭', 'Close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
