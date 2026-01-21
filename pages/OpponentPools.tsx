import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { OpponentPool, EnvSpec, Run, Checkpoint } from '../types';
import { Database, Plus, Users, Calendar, X, Trash2, Bot, Lock, CheckSquare, Square } from 'lucide-react';
import { useToast } from '../components/Toast';

export const OpponentPools: React.FC = () => {
  const { showToast } = useToast();
  const [pools, setPools] = useState<OpponentPool[]>([]);
  const [envs, setEnvs] = useState<EnvSpec[]>([]);
  const [selectedPoolIds, setSelectedPoolIds] = useState<Set<string>>(new Set());
  
  // Create Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedEnv, setSelectedEnv] = useState('');

  // Member Management State
  const [selectedPool, setSelectedPool] = useState<OpponentPool | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [newMemberId, setNewMemberId] = useState('');
  const [versionName, setVersionName] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [runCheckpoints, setRunCheckpoints] = useState<Checkpoint[]>([]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState('');

  useEffect(() => {
    api.getPools().then(setPools);
    api.getEnvs().then(setEnvs);
    api.getRuns().then(setRuns);
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setRunCheckpoints([]);
      setSelectedCheckpointId('');
      return;
    }
    api.getCheckpoints(selectedRunId).then(setRunCheckpoints);
  }, [selectedRunId]);

  useEffect(() => {
    if (selectedCheckpointId) {
      setNewMemberId(selectedCheckpointId);
    }
  }, [selectedCheckpointId]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEnv || !newName) return;
    api
      .createPool({ name: newName, env: selectedEnv })
      .then(() => api.getPools().then(setPools))
      .finally(() => setIsCreateOpen(false));
  }

  const handleOpenMembers = (pool: OpponentPool) => {
      setSelectedPool(pool);
      api.getPoolById(pool.id).then(full => {
        setMembers(full.memberSnapshotIds || []);
        setSelectedPool(full);
        setSelectedRunId('');
        setRunCheckpoints([]);
        setSelectedCheckpointId('');
      });
  }

  const handleFreezePool = () => {
      if (selectedPool) {
          api.freezePool(selectedPool.id).then(updated => {
            setPools(pools.map(p => p.id === selectedPool.id ? updated : p));
            setSelectedPool(updated);
          });
      }
  }

  const handleAddMember = (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedPool || !newMemberId) return;
      api.updatePoolMembers(selectedPool.id, { snapshotIds: [newMemberId], mode: 'append' }).then(pool => {
        setMembers(pool.memberSnapshotIds || []);
        setSelectedPool(pool);
        setNewMemberId('');
        setSelectedCheckpointId('');
        setPools(pools.map(p => p.id === pool.id ? pool : p));
      });
  }

  const handleRemoveMember = (snapshotId: string) => {
      if (!selectedPool) return;
      api.updatePoolMembers(selectedPool.id, { snapshotIds: [snapshotId], mode: 'remove' }).then(pool => {
        setMembers(pool.memberSnapshotIds || []);
        setSelectedPool(pool);
        setPools(pools.map(p => p.id === pool.id ? pool : p));
      });
  }

  const handleCreateVersion = () => {
      if (!selectedPool) return;
      api.createPoolVersion(selectedPool.id, { version: versionName || undefined, memberSnapshotIds: members }).then(pool => {
        setPools(pools.map(p => p.id === selectedPool.id ? pool : p));
        setSelectedPool(pool);
        setVersionName('');
      });
  }

  const handleDeletePool = (pool: OpponentPool) => {
      if (!window.confirm(`Delete pool "${pool.name}" and all its versions/results?`)) {
        return;
      }
      api
        .deletePool(pool.id)
        .then(() => {
          setPools(prev => prev.filter(p => p.id !== pool.id));
          if (selectedPool?.id === pool.id) {
            setSelectedPool(null);
            setMembers([]);
          }
          showToast(`Deleted pool "${pool.name}".`, 'success');
        })
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(`Failed to delete pool: ${detail}`, 'error');
        });
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedPoolIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedPoolIds(next);
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedPoolIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected pools?`)) return;

    Promise.all(ids.map(id => api.deletePool(id)))
      .then(() => {
        setPools(prev => prev.filter(p => !selectedPoolIds.has(p.id)));
        setSelectedPoolIds(new Set());
        if (selectedPool && selectedPoolIds.has(selectedPool.id)) {
            setSelectedPool(null);
        }
        showToast(`Deleted ${ids.length} pools.`, 'success');
      })
      .catch(err => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Bulk delete failed: ${detail}`, 'error');
      });
  };

  const filteredRuns = selectedPool
    ? runs.filter(run => run.env.startsWith(`${selectedPool.env}:`))
    : runs;

  return (
    <div className="space-y-6 relative h-[calc(100vh-4rem)] flex flex-col pb-20">
       <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Opponent Pools</h1>
          <p className="text-gray-500 mt-1">Manage fixed sets of agents for evaluation and matrix analysis.</p>
        </div>
        <button 
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" /> New Pool
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pool List */}
        <div className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col ${selectedPool ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs text-gray-500 font-semibold uppercase">
                <tr>
                <th className="px-6 py-3 w-10"></th>
                <th className="px-6 py-3">Pool Name</th>
                <th className="px-6 py-3">Env</th>
                <th className="px-6 py-3">Version</th>
                <th className="px-6 py-3">Size</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3"></th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {pools.map(pool => (
                <tr key={pool.id} 
                    className={`hover:bg-gray-50 cursor-pointer transition-colors ${selectedPool?.id === pool.id ? 'bg-blue-50' : ''}`}
                    onClick={() => handleOpenMembers(pool)}
                >
                    <td className="px-6 py-4" onClick={(e) => { e.stopPropagation(); toggleSelect(pool.id); }}>
                        {selectedPoolIds.has(pool.id) ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5 text-gray-400" />}
                    </td>
                    <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                        <Database className="w-4 h-4" />
                        </div>
                        <div>
                        <div className="font-medium text-gray-900">{pool.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{pool.id}</div>
                        </div>
                    </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{pool.env}</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-600">v{pool.version}</td>
                    <td className="px-6 py-4">
                    <div className="flex items-center text-sm text-gray-700">
                        <Users className="w-4 h-4 mr-1 text-gray-400" /> {pool.size} Agents
                    </div>
                    </td>
                    <td className="px-6 py-4">
                    {pool.frozen ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        Frozen
                        </span>
                    ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Active
                        </span>
                    )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 flex items-center">
                    <Calendar className="w-4 h-4 mr-1 text-gray-400" /> {pool.created || '-'}
                    </td>
                    <td className="px-6 py-4 text-right space-x-3">
                    <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">Manage</button>
                    <button
                      className="text-red-500 hover:text-red-700"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleDeletePool(pool);
                      }}
                      aria-label="Delete pool"
                      title="Delete pool"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    </td>
                </tr>
                ))}
            </tbody>
            </table>
        </div>

        {/* Members Sidebar (Conditional) */}
        {selectedPool && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <div>
                        <div className="flex items-center gap-2">
                             <h3 className="font-bold text-gray-900">Pool Members</h3>
                             {selectedPool.frozen && <Lock className="w-4 h-4 text-gray-400" />}
                        </div>
                        <p className="text-xs text-gray-500">{selectedPool.name}</p>
                    </div>
                    <button onClick={() => setSelectedPool(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {members.map(member => (
                        <div key={member} className="p-3 border border-gray-200 rounded-lg flex justify-between items-center group hover:border-blue-300 transition-all">
                            <div>
                                <div className="text-sm font-bold text-gray-900 flex items-center">
                                    <Bot className="w-3 h-3 mr-1 text-gray-400"/> Policy Snapshot
                                </div>
                                <div className="text-xs text-gray-400 font-mono">{member}</div>
                            </div>
                            {!selectedPool.frozen && (
                                <button
                                  onClick={() => handleRemoveMember(member)}
                                  className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ))}
                    {members.length === 0 && (
                        <div className="text-center text-gray-400 py-8 text-sm">No agents in this pool.</div>
                    )}
                </div>

                {!selectedPool.frozen ? (
                    <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-3">
                        <form onSubmit={handleAddMember} className="space-y-3">
                            <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Pick from Run</label>
                              <select
                                className="w-full p-2 border border-gray-300 rounded-md text-sm"
                                value={selectedRunId}
                                onChange={e => setSelectedRunId(e.target.value)}
                              >
                                <option value="">Select Run</option>
                                {filteredRuns.map(run => (
                                  <option key={run.id} value={run.id}>
                                    {run.name} ({run.id.slice(0, 6)}) · {run.status}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Checkpoint</label>
                              <select
                                className="w-full p-2 border border-gray-300 rounded-md text-sm"
                                value={selectedCheckpointId}
                                onChange={e => setSelectedCheckpointId(e.target.value)}
                                disabled={!selectedRunId}
                              >
                                <option value="">Select Checkpoint</option>
                                {runCheckpoints.map(ckpt => (
                                  <option key={ckpt.id} value={ckpt.id}>
                                    step {ckpt.step} · {ckpt.tags.join(', ') || 'no tags'}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Or paste Snapshot ID</label>
                              <div className="flex gap-2">
                                  <input 
                                      type="text" 
                                      placeholder="ckpt_..." 
                                      className="flex-1 p-2 border border-gray-300 rounded-md text-sm"
                                      value={newMemberId}
                                      onChange={e => setNewMemberId(e.target.value)}
                                  />
                                  <button type="submit" className="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                                      <Plus className="w-4 h-4" />
                                  </button>
                              </div>
                            </div>
                        </form>
                        <button 
                            onClick={handleFreezePool}
                            className="w-full py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 flex items-center justify-center text-sm"
                        >
                            <Lock className="w-3 h-3 mr-2" /> Freeze Pool (Finalize)
                        </button>
                        <div className="pt-2 border-t border-gray-200">
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Create New Version</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="e.g., 2.0.0"
                              className="flex-1 p-2 border border-gray-300 rounded-md text-sm"
                              value={versionName}
                              onChange={e => setVersionName(e.target.value)}
                            />
                            <button onClick={handleCreateVersion} className="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-4 border-t border-gray-100 bg-gray-50 text-center text-xs text-gray-500">
                        This pool is frozen. Members cannot be added or removed.
                    </div>
                )}
            </div>
        )}
      </div>

      {selectedPoolIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-6 animate-in slide-in-from-bottom duration-200 z-50">
              <span className="font-medium text-sm">{selectedPoolIds.size} selected</span>
              <div className="h-4 w-px bg-gray-700"></div>
              <button 
                onClick={handleBulkDelete}
                className="flex items-center text-sm font-bold text-red-400 hover:text-red-300"
              >
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
              </button>
              <button 
                onClick={() => setSelectedPoolIds(new Set())}
                className="text-gray-400 hover:text-gray-200 text-sm"
              >
                  Clear
              </button>
          </div>
      )}

       {/* Create Modal */}
       {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-900">Create Opponent Pool</h2>
                    <button onClick={() => setIsCreateOpen(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleCreate} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Pool Name</label>
                        <input 
                            type="text" 
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            placeholder="e.g., Hard Bots v1"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                        />
                    </div>
                    
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">Initial Version</label>
                        <input type="text" disabled value="v1.0.0" className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-500"/>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create Pool</button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};