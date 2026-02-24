import React, { useEffect, useState } from 'react';
import { Key, HardDrive, Server, Globe2, BookOpen } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { SettingsResponse } from '../types';
import { useToast } from '../components/Toast';
import { useI18n } from '../services/i18n';

export const Settings: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { locale, setLocale, t } = useI18n();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [checkpointPolicy, setCheckpointPolicy] = useState('best_latest_5');
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [applyingRetention, setApplyingRetention] = useState(false);
  const [showAgenticDoc, setShowAgenticDoc] = useState(true);

  const activePanel = new URLSearchParams(location.search).get('panel') || '';

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
        showToast(`${t('settings.toast.loadFailed', 'Failed to load settings')}: ${detail}`, 'error');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const panelId = activePanel === 'docs' ? 'panel-docs' : activePanel === 'language' ? 'panel-language' : '';
    if (!panelId) return;
    const element = document.getElementById(panelId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activePanel]);

  const handleRotateToken = () => {
    api.rotateToken()
      .then(res => {
        setSettings(prev => prev ? { ...prev, apiToken: res.apiToken } : prev);
        showToast(t('settings.toast.rotateSuccess', 'API token rotated.'), 'success');
      })
      .catch(err => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`${t('settings.toast.rotateFailed', 'Failed to rotate token')}: ${detail}`, 'error');
      });
  };

  const handleRetentionChange = (value: string) => {
    setCheckpointPolicy(value);
    setSavingPolicy(true);
    api.updateSettings({ checkpointPolicy: value })
      .then(res => {
        setSettings(res);
        showToast(t('settings.toast.updatePolicySuccess', 'Retention policy updated.'), 'success');
      })
      .catch(err => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`${t('settings.toast.updatePolicyFailed', 'Failed to update policy')}: ${detail}`, 'error');
      })
      .finally(() => setSavingPolicy(false));
  };

  const handleApplyRetention = () => {
    setApplyingRetention(true);
    api.applyRetention()
      .then(res => {
        showToast(
          `${t('settings.toast.applyRetentionSuccess', 'Retention applied')} (${res.runsProcessed} runs / ${res.checkpointsRemoved} checkpoints).`,
          'success',
        );
      })
      .catch(err => {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`${t('settings.toast.applyRetentionFailed', 'Failed to apply retention')}: ${detail}`, 'error');
      })
      .finally(() => setApplyingRetention(false));
  };

  const handleLanguageChange = (value: string) => {
    setLocale(value === 'zh-CN' ? 'zh-CN' : 'en-US');
    showToast(
      value === 'zh-CN'
        ? t('settings.toast.language.zh', 'Language switched to Chinese.')
        : t('settings.toast.language.en', 'Language switched to English.'),
      'success',
    );
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
  const localExecutorMode = settings?.executor.localExecutorMode ?? 'real';
  const masterUrl = settings?.executor.determinedMasterUrl;
  const connected = settings?.executor.determinedConnected;
  const determinedMock = settings?.executor.determinedMock;
  const scheduler = settings?.executor.scheduler ?? (executorMode === 'local' ? 'Local' : 'Unknown');

  return (
    <div className="space-y-6 relative max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('settings.title', 'System Settings')}</h1>
        <p className="text-gray-500 mt-1">{t('settings.subtitle', 'Manage platform configuration, API access, and storage.')}</p>
      </div>

      <div className="space-y-8">
        {/* Language */}
        <div id="panel-language" className={`bg-white rounded-xl border shadow-sm p-6 ${activePanel === 'language' ? 'border-blue-300' : 'border-gray-200'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-sky-50 text-sky-600 rounded-lg">
                <Globe2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('settings.language.title', 'Language')}</h2>
                <p className="text-sm text-gray-500">{t('settings.language.subtitle', 'Set global UI language (applies immediately).')}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleLanguageChange('zh-CN')}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${locale === 'zh-CN' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                中文
              </button>
              <button
                onClick={() => handleLanguageChange('en-US')}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${locale === 'en-US' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                English
              </button>
            </div>
            <div className="mt-2 text-xs text-gray-500">{t('settings.language.current', 'Current')}: {locale}</div>
        </div>

        {/* Docs */}
        <div id="panel-docs" className={`bg-white rounded-xl border shadow-sm p-6 ${activePanel === 'docs' ? 'border-blue-300' : 'border-gray-200'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('settings.docs.title', 'Docs')}</h2>
                <p className="text-sm text-gray-500">{t('settings.docs.subtitle', 'Quick guide to understand Agentic ToT workflow.')}</p>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              <div className="font-semibold text-gray-900">{t('settings.docs.totTitle', 'ToT means Tree of Thought')}</div>
              <div className="mt-1">{t('settings.docs.totDesc', 'Each node is a hypothesis + plan + evidence + next action, with replay.')}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => navigate('/agentic')}
                  className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  {t('settings.docs.openAgentic', 'Open Agentic Lab')}
                </button>
                <button
                  onClick={() => setShowAgenticDoc(prev => !prev)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {showAgenticDoc
                    ? t('settings.docs.hideSteps', 'Hide Steps')
                    : t('settings.docs.showSteps', 'Show Steps')}
                </button>
              </div>
              {showAgenticDoc && (
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-gray-600">
                  <li>{t('settings.docs.step1', 'Input idea and constraints to generate standardized Research Spec.')}</li>
                  <li>{t('settings.docs.step2', 'Execute ToT nodes with multi-agent collaboration and safety approvals.')}</li>
                  <li>{t('settings.docs.step3', 'Inspect timeline/evidence, run matrix league, and export repro bundle.')}</li>
                </ol>
              )}
            </div>
        </div>

         {/* API Access */}
         <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
             <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <Key className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">{t('settings.api.title', 'API & Authentication')}</h2>
                    <p className="text-sm text-gray-500">{t('settings.api.subtitle', 'Access tokens for SDK and CLI integration.')}</p>
                </div>
            </div>
            
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.api.token', 'Personal Access Token')}</label>
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
                          {t('settings.api.rotate', 'Rotate')}
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
                    <h2 className="text-lg font-semibold text-gray-900">{t('settings.cluster.title', 'Compute Cluster')}</h2>
                    <p className="text-sm text-gray-500">{t('settings.cluster.subtitle', 'Connection to Determined AI master and agents.')}</p>
                </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-200">
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t('settings.cluster.executorMode', 'Executor Mode')}</span>
                    <span className="text-sm font-medium text-gray-900 capitalize">{executorMode}</span>
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t('settings.cluster.localGpuSlots', 'Local GPU Slots')}</span>
                    <span className="text-sm font-mono text-gray-900">{settings?.executor.localGpuCount ?? '-'}</span>
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t('settings.cluster.localExecutorMode', 'Local Executor Mode')}</span>
                    <span className={`text-sm font-medium ${localExecutorMode === 'real' ? 'text-green-700' : 'text-amber-700'}`}>
                        {localExecutorMode}
                    </span>
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t('settings.cluster.masterUrl', 'Determined Master URL')}</span>
                    <span className="text-sm font-mono text-gray-900">{masterUrl || 'Not configured'}</span>
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t('settings.cluster.connection', 'Connection Status')}</span>
                    {executorMode === 'determined' ? (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                            {connected
                              ? t('settings.cluster.connected', 'Connected')
                              : t('settings.cluster.disconnected', 'Disconnected')}
                        </span>
                    ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {t('settings.cluster.local', 'Local')}
                        </span>
                    )}
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t('settings.cluster.mockMode', 'Determined Mock Mode')}</span>
                    <span className={`text-sm font-medium ${determinedMock ? 'text-amber-700' : 'text-gray-900'}`}>
                        {determinedMock
                          ? t('settings.cluster.enabled', 'Enabled')
                          : t('settings.cluster.disabled', 'Disabled')}
                    </span>
                </div>
                <div className="p-4 flex justify-between items-center">
                    <span className="text-sm text-gray-600">{t('settings.cluster.scheduler', 'Scheduler Type')}</span>
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
                    <h2 className="text-lg font-semibold text-gray-900">{t('settings.storage.title', 'Storage & Retention')}</h2>
                    <p className="text-sm text-gray-500">{t('settings.storage.subtitle', 'Artifact storage policies and usage.')}</p>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="text-sm text-gray-500 mb-1">{t('settings.storage.minioUsage', 'MinIO Usage')}</div>
                    <div className="text-2xl font-bold text-gray-900">{formatBytes(settings?.storage.artifactBytes)}</div>
                    <div className="w-full bg-gray-200 h-1.5 rounded-full mt-2">
                        <div className="bg-blue-600 h-1.5 rounded-full" style={{width: `${usagePercent}%`}}></div>
                    </div>
                </div>
                 <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="text-sm text-gray-500 mb-1">{t('settings.storage.dbSize', 'Postgres DB Size')}</div>
                    <div className="text-2xl font-bold text-gray-900">{formatBytes(settings?.storage.dbBytes)}</div>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('settings.storage.retentionPolicy', 'Checkpoint Retention Policy')}</label>
                <select
                  value={checkpointPolicy}
                  onChange={(e) => handleRetentionChange(e.target.value)}
                  disabled={savingPolicy}
                  className="w-full md:w-64 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-50"
                >
                    <option value="best_latest_5">{t('settings.storage.keepBestLatest', 'Keep Best & Latest 5')}</option>
                    <option value="keep_all">{t('settings.storage.keepAll', 'Keep All (No Limit)')}</option>
                    <option value="delete_30d">{t('settings.storage.delete30d', 'Delete older than 30 days')}</option>
                </select>
            </div>
            <div>
                <button
                  onClick={handleApplyRetention}
                  disabled={applyingRetention}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-70"
                >
                  {applyingRetention
                    ? t('settings.storage.applying', 'Applying...')
                    : t('settings.storage.applyNow', 'Apply Retention Now')}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};
