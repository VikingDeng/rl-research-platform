import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Plugin, PluginVersion } from '../types';
import { Archive, Package, Download, Search, CheckCircle, ExternalLink, Sliders, Box, Plus, X } from 'lucide-react';
import { useToast } from '../components/Toast';

export const PluginRegistry: React.FC = () => {
  const { showToast } = useToast();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pluginVersions, setPluginVersions] = useState<Record<string, PluginVersion[]>>({});
  const [activeTab, setActiveTab] = useState<'installed' | 'marketplace'>('installed');
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [managePlugin, setManagePlugin] = useState<Plugin | null>(null);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<Plugin | null>(null);
  const [versionPluginId, setVersionPluginId] = useState('');
  const [versionValue, setVersionValue] = useState('');
  const [versionWheelUri, setVersionWheelUri] = useState('');
  const [versionSha256, setVersionSha256] = useState('');
  const [versionManifest, setVersionManifest] = useState('{}');
  const [versionName, setVersionName] = useState('');
  const [versionType, setVersionType] = useState<'Algorithm' | 'Model' | 'Wrapper'>('Model');
  const [versionDescription, setVersionDescription] = useState('');
  const [versionAuthor, setVersionAuthor] = useState('');
  const [versionInstalled, setVersionInstalled] = useState(true);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'Algorithm' | 'Model' | 'Wrapper'>('Model');
  const [editDescription, setEditDescription] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editInstalled, setEditInstalled] = useState(true);

  useEffect(() => {
    api.getPlugins({ includeArchived }).then(setPlugins);
  }, [includeArchived]);

  const handleArchivePlugin = (plugin: Plugin, archived: boolean) => {
    const action = archived ? api.updatePlugin(plugin.id, { archived: false }) : api.archivePlugin(plugin.id);
    action
      .then(() => api.getPlugins({ includeArchived }))
      .then(setPlugins)
      .catch((err) => {
        console.error('Failed to update plugin', err);
      });
  };

  const openManage = (plugin: Plugin) => {
    setManagePlugin(plugin);
    setEditName(plugin.name || '');
    setEditType((plugin.type as 'Algorithm' | 'Model' | 'Wrapper') || 'Model');
    setEditDescription(plugin.description || '');
    setEditAuthor(plugin.author || '');
    setEditInstalled(plugin.installed ?? false);
    setIsManageOpen(true);
    api.getPluginVersions(plugin.id).then((versions) => {
      setPluginVersions(prev => ({ ...prev, [plugin.id]: versions }));
    });
  };

  const openVersionModal = (plugin?: Plugin) => {
    setVersionTarget(plugin ?? null);
    setVersionPluginId(plugin?.id ?? '');
    setVersionName(plugin?.name ?? '');
    setVersionType((plugin?.type as 'Algorithm' | 'Model' | 'Wrapper') || 'Model');
    setVersionDescription(plugin?.description ?? '');
    setVersionAuthor(plugin?.author ?? '');
    setVersionInstalled(plugin?.installed ?? true);
    setVersionValue('');
    setVersionWheelUri('');
    setVersionSha256('');
    setVersionManifest('{}');
    setIsVersionOpen(true);
  };

  const handleSavePlugin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!managePlugin) return;
    api
      .updatePlugin(managePlugin.id, {
        name: editName.trim() || managePlugin.name,
        type: editType,
        description: editDescription.trim() || undefined,
        author: editAuthor.trim() || undefined,
        installed: editInstalled,
      })
      .then(() => api.getPlugins({ includeArchived }))
      .then(setPlugins)
      .then(() => {
        setIsManageOpen(false);
        setManagePlugin(null);
      });
  };

  const handleCreateVersion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionPluginId.trim() || !versionValue.trim() || !versionWheelUri.trim() || !versionSha256.trim()) {
      showToast('Plugin ID, version, wheel URI, and sha256 are required.', 'error');
      return;
    }
    let manifest: Record<string, unknown> | undefined;
    try {
      manifest = versionManifest.trim() ? JSON.parse(versionManifest) : undefined;
    } catch (err) {
      showToast('Manifest JSON is invalid.', 'error');
      return;
    }
    api
      .createPluginVersion({
        pluginId: versionPluginId.trim(),
        version: versionValue.trim(),
        wheelUri: versionWheelUri.trim(),
        sha256: versionSha256.trim(),
        manifest,
      })
      .then(() =>
        api.updatePlugin(versionPluginId.trim(), {
          name: versionName.trim() || undefined,
          type: versionType,
          description: versionDescription.trim() || undefined,
          author: versionAuthor.trim() || undefined,
          installed: versionInstalled,
        }),
      )
      .then(() => api.getPlugins({ includeArchived }))
      .then(setPlugins)
      .then(() => {
        if (versionTarget) {
          return api.getPluginVersions(versionTarget.id).then((versions) => {
            setPluginVersions(prev => ({ ...prev, [versionTarget.id]: versions }));
          });
        }
        return undefined;
      })
      .then(() => {
        setIsVersionOpen(false);
        setVersionTarget(null);
      });
  };

  const handleFreezeVersion = (pluginId: string, version: string) => {
    api
      .freezePluginVersion(pluginId, version)
      .then(() => api.getPluginVersions(pluginId))
      .then((versions) => {
        setPluginVersions(prev => ({ ...prev, [pluginId]: versions }));
      });
  };

  const filteredPlugins = plugins.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
      if (activeTab === 'installed') return matchesSearch && p.installed;
      return matchesSearch; // Marketplace shows all
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
           <h1 className="text-2xl font-bold text-gray-900">Plugin Registry</h1>
           <p className="text-gray-500 mt-1">Extend the platform with custom algorithms, models, and wrappers.</p>
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
            <div className="flex bg-gray-100 p-1 rounded-lg">
            <button 
                onClick={() => setActiveTab('installed')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'installed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
                Installed
            </button>
            <button 
                onClick={() => setActiveTab('marketplace')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'marketplace' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
                Marketplace
            </button>
          </div>
          <button
            onClick={() => openVersionModal()}
            className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            <Plus className="w-4 h-4 mr-2" /> Register Plugin
          </button>
        </div>
      </div>

      <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Search plugins..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
      </div>

      <div className="space-y-4">
        {filteredPlugins.map(plugin => (
            <div key={plugin.id} className="bg-white rounded-xl border border-gray-200 p-6 flex items-start justify-between hover:shadow-sm transition-shadow">
                <div className="flex items-start gap-4">
                    <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
                        {plugin.type === 'Algorithm' ? <Sliders className="w-6 h-6" /> : 
                         plugin.type === 'Model' ? <Box className="w-6 h-6" /> : <Package className="w-6 h-6" />}
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-lg font-bold text-gray-900">{plugin.name}</h3>
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full border border-gray-200">{plugin.type}</span>
                            {plugin.archived && (
                              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full border border-gray-200">Archived</span>
                            )}
                        </div>
                        <p className="text-gray-600 text-sm mb-2 max-w-2xl">{plugin.description}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                            <span>v{plugin.version}</span>
                            <span>•</span>
                            <span>By {plugin.author}</span>
                            <span>•</span>
                            <a href="#" className="flex items-center hover:text-blue-600 transition-colors">
                                View Documentation <ExternalLink className="w-3 h-3 ml-1" />
                            </a>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                    {plugin.installed ? (
                         <button className="px-4 py-2 bg-gray-50 text-gray-500 border border-gray-200 rounded-lg text-sm font-medium flex items-center cursor-default">
                             <CheckCircle className="w-4 h-4 mr-2" /> Installed
                         </button>
                    ) : (
                         <button
                           onClick={() => openVersionModal(plugin)}
                           className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center shadow-sm"
                         >
                             <Download className="w-4 h-4 mr-2" /> Install
                         </button>
                    )}
                    <button
                      onClick={() => openManage(plugin)}
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-xs hover:bg-gray-50"
                    >
                      Manage
                    </button>
                    <button
                      onClick={() => handleArchivePlugin(plugin, !!plugin.archived)}
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-xs hover:bg-gray-50 flex items-center"
                    >
                      <Archive className="w-4 h-4 mr-1" />
                      {plugin.archived ? 'Restore' : 'Archive'}
                    </button>
                </div>
            </div>
        ))}

        {filteredPlugins.length === 0 && (
            <div className="text-center py-12 text-gray-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No plugins found matching your criteria.</p>
            </div>
        )}
      </div>

      {isManageOpen && managePlugin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Manage Plugin</h2>
                <p className="text-xs text-gray-500">{managePlugin.id}</p>
              </div>
              <button onClick={() => { setIsManageOpen(false); setManagePlugin(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <form onSubmit={handleSavePlugin} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editType}
                    onChange={e => setEditType(e.target.value as 'Algorithm' | 'Model' | 'Wrapper')}
                  >
                    <option value="Algorithm">Algorithm</option>
                    <option value="Model">Model</option>
                    <option value="Wrapper">Wrapper</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editAuthor}
                    onChange={e => setEditAuthor(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Installed</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={editInstalled ? 'true' : 'false'}
                    onChange={e => setEditInstalled(e.target.value === 'true')}
                  >
                    <option value="true">Installed</option>
                    <option value="false">Not installed</option>
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 resize-none"
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                  />
                </div>
                <div className="lg:col-span-2 flex justify-end gap-3">
                  <button type="button" onClick={() => { setIsManageOpen(false); setManagePlugin(null); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
                </div>
              </form>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-700">Versions</h3>
                  <button
                    onClick={() => openVersionModal(managePlugin)}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs hover:bg-blue-700"
                  >
                    Add Version
                  </button>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-2">Version</th>
                      <th className="px-4 py-2">Wheel URI</th>
                      <th className="px-4 py-2">Frozen</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(pluginVersions[managePlugin.id] || []).map(version => (
                      <tr key={`${version.pluginId}-${version.version}`}>
                        <td className="px-4 py-2 font-mono">v{version.version}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{version.wheelUri}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            version.frozen ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'
                          }`}>
                            {version.frozen ? 'Frozen' : 'Mutable'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleFreezeVersion(version.pluginId, version.version)}
                            disabled={version.frozen}
                            className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                          >
                            Freeze
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(pluginVersions[managePlugin.id] || []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-4 text-sm text-gray-400">No versions registered.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {isVersionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Register Plugin Version</h2>
              <button onClick={() => { setIsVersionOpen(false); setVersionTarget(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVersion} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plugin ID</label>
                <input
                  type="text"
                  required
                  disabled={!!versionTarget}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-50"
                  value={versionPluginId}
                  onChange={e => setVersionPluginId(e.target.value)}
                  placeholder="e.g., policy-eval"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                  <input
                    type="text"
                    required
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={versionValue}
                    onChange={e => setVersionValue(e.target.value)}
                    placeholder="e.g., 1.0.0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={versionType}
                    onChange={e => setVersionType(e.target.value as 'Algorithm' | 'Model' | 'Wrapper')}
                  >
                    <option value="Algorithm">Algorithm</option>
                    <option value="Model">Model</option>
                    <option value="Wrapper">Wrapper</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Wheel URI</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={versionWheelUri}
                  onChange={e => setVersionWheelUri(e.target.value)}
                  placeholder="s3://.../plugin.whl"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SHA256</label>
                <input
                  type="text"
                  required
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={versionSha256}
                  onChange={e => setVersionSha256(e.target.value)}
                  placeholder="hex digest"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Manifest (JSON, optional)</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-24 font-mono text-xs"
                  value={versionManifest}
                  onChange={e => setVersionManifest(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={versionName}
                    onChange={e => setVersionName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={versionAuthor}
                    onChange={e => setVersionAuthor(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 resize-none"
                  value={versionDescription}
                  onChange={e => setVersionDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={versionInstalled}
                    onChange={e => setVersionInstalled(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Mark as installed
                </label>
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => { setIsVersionOpen(false); setVersionTarget(null); }} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
