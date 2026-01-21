import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { RegisteredModel, ModelVersion } from '../types';
import { Package, Plus, Search, ChevronRight, Hash, Clock, Tag } from 'lucide-react';
import { useToast } from '../components/Toast';

export const ModelRegistry: React.FC = () => {
  const { showToast } = useToast();
  const [models, setModels] = useState<RegisteredModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<RegisteredModel | null>(null);
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [search, setSearch] = useState('');
  
  // Create Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    api.getModels().then(setModels);
  }, []);

  useEffect(() => {
    if (selectedModel) {
        api.getModelVersions(selectedModel.id).then(setVersions);
    } else {
        setVersions([]);
    }
  }, [selectedModel]);

  const handleCreate = (e: React.FormEvent) => {
      e.preventDefault();
      if (!newName) return;
      api.createModel(newName, newDesc)
        .then(m => {
            setModels([m, ...models]);
            setIsCreateOpen(false);
            setNewName('');
            setNewDesc('');
            showToast('Model registered.', 'success');
        })
        .catch(err => showToast(`Failed: ${err}`, 'error'));
  };

  const handleStageUpdate = (versionId: string, stage: string) => {
      api.updateModelStage(versionId, stage)
        .then(updated => {
            setVersions(versions.map(v => v.id === updated.id ? updated : v));
            showToast(`Stage updated to ${stage}.`, 'success');
        });
  };

  const filteredModels = models.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6 h-[calc(100vh-4rem)] flex flex-col pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Model Registry</h1>
          <p className="text-gray-500 mt-1">Manage, version, and stage your trained policies.</p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
        >
          <Plus className="w-4 h-4 mr-2" /> Register Model Family
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
              <div className="p-4 border-b border-gray-100">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search models..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                  {filteredModels.map(m => (
                      <div 
                        key={m.id}
                        onClick={() => setSelectedModel(m)}
                        className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${selectedModel?.id === m.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                      >
                          <div className="flex justify-between items-start">
                              <div className="font-medium text-gray-900">{m.name}</div>
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                          </div>
                          {m.description && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{m.description}</div>}
                          <div className="text-xs text-gray-400 mt-2 flex items-center">
                              <Clock className="w-3 h-3 mr-1" /> Updated {new Date(m.updatedAt).toLocaleDateString()}
                          </div>
                      </div>
                  ))}
                  {filteredModels.length === 0 && (
                      <div className="p-8 text-center text-gray-500 text-sm">No models found.</div>
                  )}
              </div>
          </div>

          {/* Details */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
              {selectedModel ? (
                  <>
                    <div className="p-6 border-b border-gray-100 bg-gray-50">
                        <h2 className="text-xl font-bold text-gray-900 flex items-center">
                            <Package className="w-6 h-6 mr-2 text-blue-600" />
                            {selectedModel.name}
                        </h2>
                        <p className="text-gray-600 mt-2 text-sm">{selectedModel.description || "No description provided."}</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6">
                        <h3 className="font-semibold text-gray-900 mb-4">Version History</h3>
                        <div className="space-y-4">
                            {versions.map(v => (
                                <div key={v.id} className="border border-gray-200 rounded-lg p-4 flex justify-between items-center hover:border-blue-300 transition-all">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <div className="bg-gray-100 px-2 py-1 rounded text-sm font-mono font-bold text-gray-700">v{v.version}</div>
                                            <div className="text-xs text-gray-500 font-mono">ckpt: {v.checkpointId.slice(0, 8)}</div>
                                        </div>
                                        <div className="text-xs text-gray-400 mt-1">Created {new Date(v.createdAt).toLocaleString()}</div>
                                    </div>
                                    
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-gray-500 uppercase">Stage</span>
                                            <select 
                                                value={v.stage}
                                                onChange={(e) => handleStageUpdate(v.id, e.target.value)}
                                                className={`text-sm font-medium border-none bg-transparent focus:ring-0 cursor-pointer ${
                                                    v.stage === 'Production' ? 'text-green-600' :
                                                    v.stage === 'Staging' ? 'text-yellow-600' :
                                                    v.stage === 'Archived' ? 'text-gray-400' : 'text-gray-600'
                                                }`}
                                            >
                                                <option value="None">None</option>
                                                <option value="Staging">Staging</option>
                                                <option value="Production">Production</option>
                                                <option value="Archived">Archived</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {versions.length === 0 && (
                                <div className="text-center py-10 text-gray-500 text-sm border-2 border-dashed border-gray-100 rounded-lg">
                                    No versions registered yet.<br/>
                                    Go to a Run Detail page and click "Register Model" on a checkpoint.
                                </div>
                            )}
                        </div>
                    </div>
                  </>
              ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <Package className="w-12 h-12 mb-2 opacity-20" />
                      <div>Select a model family to view details</div>
                  </div>
              )}
          </div>
      </div>

      {isCreateOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
                  <div className="p-6 border-b border-gray-100">
                      <h2 className="text-lg font-bold text-gray-900">Register Model Family</h2>
                  </div>
                  <form onSubmit={handleCreate} className="p-6 space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Model Name</label>
                          <input 
                              className="w-full p-2 border border-gray-300 rounded-lg"
                              placeholder="e.g. MAPPO-SMAC-3s5z"
                              value={newName}
                              onChange={e => setNewName(e.target.value)}
                              autoFocus
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                          <textarea 
                              className="w-full p-2 border border-gray-300 rounded-lg h-24 resize-none"
                              value={newDesc}
                              onChange={e => setNewDesc(e.target.value)}
                          />
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                          <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg">Cancel</button>
                          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create</button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};
