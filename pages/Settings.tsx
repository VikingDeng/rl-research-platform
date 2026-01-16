import React, { useEffect, useState } from 'react';
import { Key, HardDrive, Server } from 'lucide-react';
import { api } from '../services/api';
import { SettingsResponse } from '../types';
import { useToast } from '../components/Toast';

export const Settings: React.FC = () => {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [checkpointPolicy, setCheckpointPolicy] = useState('best_latest_5');
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [applyingRetention, setApplyingRetention] = useState(false);

  const loadSettings = () => {
    setLoading(true);
    api.getSettings()
      .then(res => {
        setSettings(res);
        if (res.retention?.checkpointPolicy) {
          setCheckpointPolicy(res.retention.checkpointPolicy);
        }
      })
      .catch(err => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to load settings: ${detail}`, 'error');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleRotateToken = () => {
    api.rotateToken()
      .then(res => {
        setSettings(prev => prev ? { ...prev, apiToken: res.apiToken } : prev);
        showToast('API token rotated.', 'success');
      })
      .catch(err => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to rotate token: ${detail}`, 'error');
      });
  };

  const handleRetentionChange = (value: string) => {
    setCheckpointPolicy(value);
    setSavingPolicy(true);
    api.updateSettings({ checkpointPolicy: value })
      .then(res => {
        setSettings(res);
        showToast('Retention policy updated.', 'success');
      })
      .catch(err => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to update policy: ${detail}`, 'error');
      })
      .finally(() => setSavingPolicy(false));
  };

  const handleApplyRetention = () => {
    setApplyingRetention(true);
    api.applyRetention()
      .then(res => {
        showToast(`Retention applied to ${res.runsProcessed} runs. Removed ${res.checkpointsRemoved} checkpoints.`, 'success');
      })
      .catch(err => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to apply retention: ${detail}`, 'error');
      })
      .finally(() => setApplyingRetention(false));
  };

  const formatBytes = (value?: number | null) => {
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const usagePercent = settings ? Math.min(100, Math.round((settings.storage.artifactBytes / (1024 ** 3)) * 2)) : 0;
  const executorMode = settings?.executor.mode ?? 'local';
  const masterUrl = settings?.executor.determinedMasterUrl;
  const connected = settings?.executor.determinedConnected;
  const scheduler = settings?.executor.scheduler ?? (executorMode === 'local' ? 'Local' : 'Unknown');

  return (
    <div className="space-y-6 relative max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">System Settings</h1>
        <p className="text-gray-500 mt-1">Manage platform configuration, API access, and storage.</p>
      </div>

      <div className="space-y-8">
         {/* API Access */}
         <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
             <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <Key className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">API & Authentication</h2>
                    <p className="text-sm text-gray-500">Access tokens for SDK and CLI integration.</p>
                </div>
            </div>
            
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Personal Access Token</label>
                    <div className="flex gap-2">
                        <input
                          type="password"
                          value={settings?.apiToken ?? (loading ? 'loading...' : '')}
                          disabled
                          className="flex-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm font-mono text-gray-600"
                        />
                        <button
                          onClick={handleRotateToken}
                          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                        >
                          Rotate
                        </button>
                    </div>
                </div>
            </div>
        </div>

        {/* Compute Cluster */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
             <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-green-50 text-green-600 rounded-lg">
                    <Server className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Compute Cluster</h2>
                    <p className="text-sm text-gray-500">Connection to Determined AI master and agents.</p>
                </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-200">
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">Executor Mode</span>
                    <span className="text-sm font-medium text-gray-900 capitalize">{executorMode}</span>
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">Local GPU Slots</span>
                    <span className="text-sm font-mono text-gray-900">{settings?.executor.localGpuCount ?? '-'}</span>
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">Determined Master URL</span>
                    <span className="text-sm font-mono text-gray-900">{masterUrl || 'Not configured'}</span>
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">Connection Status</span>
                    {executorMode === 'determined' ? (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                            {connected ? 'Connected' : 'Disconnected'}
                        </span>
                    ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            Local
                        </span>
                    )}
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">Scheduler Type</span>
                    <span className="text-sm font-medium text-gray-900">{scheduler}</span>
                </div>
            </div>
        </div>

        {/* Storage */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
             <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                    <HardDrive className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Storage & Retention</h2>
                    <p className="text-sm text-gray-500">Artifact storage policies and usage.</p>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="text-sm text-gray-500 mb-1">MinIO Usage</div>
                    <div className="text-2xl font-bold text-gray-900">{formatBytes(settings?.storage.artifactBytes)}</div>
                    <div className="w-full bg-gray-200 h-1.5 rounded-full mt-2">
                        <div className="bg-blue-600 h-1.5 rounded-full" style={{width: `${usagePercent}%`}}></div>
                    </div>
                </div>
                 <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="text-sm text-gray-500 mb-1">Postgres DB Size</div>
                    <div className="text-2xl font-bold text-gray-900">{formatBytes(settings?.storage.dbBytes)}</div>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Checkpoint Retention Policy</label>
                <select
                  value={checkpointPolicy}
                  onChange={(e) => handleRetentionChange(e.target.value)}
                  disabled={savingPolicy}
                  className="w-full md:w-64 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-50"
                >
                    <option value="best_latest_5">Keep Best & Latest 5</option>
                    <option value="keep_all">Keep All (No Limit)</option>
                    <option value="delete_30d">Delete older than 30 days</option>
                </select>
            </div>
            <div>
                <button
                  onClick={handleApplyRetention}
                  disabled={applyingRetention}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-70"
                >
                  {applyingRetention ? 'Applying...' : 'Apply Retention Now'}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};
