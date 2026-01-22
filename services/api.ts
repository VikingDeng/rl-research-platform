import type {
  Project,
  Run,
  Template,
  TemplateDetail,
  EnvSpec,
  EnvVersion,
  Algo,
  AlgoVersion,
  OpponentPool,
  MatrixResult,
  Checkpoint,
  EvalProtocol,
  Plugin,
  PluginVersion,
  ArtifactFile,
  RunMetricsResponse,
  LogPage,
  SettingsResponse,
  SettingsUpdate,
  TokenRotateResponse,
  RetentionApplyResponse,
  BootstrapResponse,
  Dataset,
} from '../types';
import { createApiClient } from '../apps/portal-frontend/src/api/generated/client';

const resolvedBaseUrl = (() => {
  const envBaseUrl = (import.meta as any)?.env?.VITE_API_BASE_URL;
  if (typeof envBaseUrl === 'string' && envBaseUrl.length > 0) {
    return envBaseUrl;
  }
  if ((import.meta as any)?.env?.DEV) {
    return 'http://127.0.0.1:8000/api/v1';
  }
  return '/api/v1';
})();

const authFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Authorization')) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  return fetch(input, { ...init, headers });
};

const apiClient = createApiClient({
  baseUrl: resolvedBaseUrl,
  fetcher: authFetch,
});

export const apiBaseUrl = resolvedBaseUrl;

export const api = {
  login: async (payload: { email: string; password: string }) => apiClient.login(payload),
  getProjects: async (): Promise<Project[]> => apiClient.listProjects(),
  getProjectById: async (id: string): Promise<Project> => apiClient.getProject(id),
  createProject: async (payload: { name: string; description?: string; tags?: string[]; gitRepo?: string; gitBranch?: string }): Promise<Project> =>
    apiClient.createProject(payload),
  deleteProject: async (id: string): Promise<void> => apiClient.deleteProject(id),
  getRuns: async (params?: { projectId?: string; type?: string; status?: string; groupId?: string; page?: number; pageSize?: number }): Promise<Run[]> => apiClient.listRuns(params),
  getRunById: async (id: string): Promise<Run> => apiClient.getRun(id),
  getRunGroupSummary: async (groupId: string): Promise<any> => {
    const res = await authFetch(`${apiBaseUrl}/runs/groups/${groupId}`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'group_summary_failed');
    }
    return res.json();
  },
  exportRunTemplate: async (runId: string, payload: { templateId?: string; name?: string; version?: string; description?: string }) => {
    const res = await authFetch(`${apiBaseUrl}/runs/${runId}/export-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'export_template_failed');
    }
    return res.json();
  },
  getRunJob: async (runId: string) => apiClient.getRunJob(runId),
  getRunMetrics: async (runId: string, params?: { keys?: string[]; fromStep?: number }): Promise<RunMetricsResponse> =>
    apiClient.queryRunMetrics(runId, params),
  getRunLogs: async (runId: string, params?: { page?: number; pageSize?: number }): Promise<LogPage> =>
    apiClient.queryRunLogs(runId, params),
  getSettings: async (): Promise<SettingsResponse> => apiClient.getSettings(),
  updateSettings: async (payload: SettingsUpdate): Promise<SettingsResponse> => apiClient.updateSettings(payload),
  rotateToken: async (): Promise<TokenRotateResponse> => apiClient.rotateToken(),
  applyRetention: async (): Promise<RetentionApplyResponse> => apiClient.applyRetention(),
  bootstrapDefaults: async (): Promise<BootstrapResponse> => {
    const res = await authFetch(`${apiBaseUrl}/admin/bootstrap`, { method: 'POST' });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'bootstrap_failed');
    }
    return res.json();
  },
  getCheckpoints: async (runId: string): Promise<Checkpoint[]> => apiClient.listCheckpoints(runId),
  tagCheckpoint: async (runId: string, checkpointId: string, payload: { tag: string }): Promise<Checkpoint> =>
    apiClient.tagCheckpoint(runId, checkpointId, payload),
  deleteRun: async (runId: string): Promise<void> => apiClient.deleteRun(runId),
  deleteRunsBatch: async (runIds: string[]): Promise<{ deleted: number }> => apiClient.deleteRunsBatch(runIds),

  getTemplates: async (params?: { projectId?: string; includeArchived?: boolean }): Promise<Template[]> =>
    apiClient.listTemplates(params),
  getTemplateById: async (id: string): Promise<TemplateDetail> => apiClient.getTemplate(id),
  createTemplate: async (
    projectId: string,
    payload: { name: string; description?: string; type: 'Single-Agent' | 'Multi-Agent'; defaultConfig?: Record<string, unknown> },
  ) => apiClient.createProjectTemplate(projectId, payload),
  updateTemplate: async (
    templateId: string,
    payload: { name?: string; description?: string; defaultConfig?: Record<string, unknown>; archived?: boolean },
  ): Promise<Template> => apiClient.updateTemplate(templateId, payload),
  archiveTemplate: async (templateId: string): Promise<void> => apiClient.archiveTemplate(templateId),
  createTemplateVersion: async (
    templateId: string,
    payload: { version: string; algoVersionId: string; defaultConfig?: Record<string, unknown> },
  ) => apiClient.createTemplateVersion(templateId, payload),
  freezeTemplateVersion: async (templateId: string, versionId: string) =>
    apiClient.freezeTemplateVersion(templateId, versionId),
  getAlgos: async (params?: { includeArchived?: boolean }): Promise<Algo[]> => apiClient.listAlgos(params),
  getAlgoVersions: async (algoId: string): Promise<AlgoVersion[]> => apiClient.listAlgoVersions(algoId),
  upsertAlgo: async (payload: { id: string; name: string; description?: string }): Promise<Algo> =>
    apiClient.upsertAlgo(payload),
  updateAlgo: async (
    algoId: string,
    payload: { name?: string; description?: string; archived?: boolean },
  ): Promise<Algo> => apiClient.updateAlgo(algoId, payload),
  archiveAlgo: async (algoId: string): Promise<void> => apiClient.archiveAlgo(algoId),
  createAlgoVersion: async (
    algoId: string,
    payload: {
      version: string;
      entrypoint: string;
      code?: string;
      package?: string;
      artifactUri?: string;
      configSchema?: Record<string, unknown>;
      defaultConfig?: Record<string, unknown>;
      resourceProfile?: Record<string, unknown>;
      envConstraints?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      active?: boolean;
    },
  ) => apiClient.createAlgoVersion(algoId, payload),
  updateAlgoVersion: async (
    algoId: string,
    version: string,
    payload: {
      entrypoint?: string;
      code?: string;
      package?: string;
      artifactUri?: string;
      configSchema?: Record<string, unknown>;
      defaultConfig?: Record<string, unknown>;
      resourceProfile?: Record<string, unknown>;
      envConstraints?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      active?: boolean;
    },
  ) => apiClient.updateAlgoVersion(algoId, version, payload),
  freezeAlgoVersion: async (algoId: string, version: string): Promise<AlgoVersion> =>
    apiClient.freezeAlgoVersion(algoId, version),
  getEnvs: async (params?: { includeArchived?: boolean }): Promise<EnvSpec[]> => apiClient.listEnvs(params),
  getEnvVersions: async (envId: string) => apiClient.listEnvVersions(envId),
  updateEnv: async (envId: string, payload: { archived?: boolean }): Promise<EnvSpec> =>
    apiClient.updateEnv(envId, payload),
  archiveEnv: async (envId: string): Promise<void> => apiClient.archiveEnv(envId),
  upsertEnv: async (payload: {
    envId: string;
    version: string;
    apiMode: string;
    entrypoint: string;
    package?: string;
    mapSets?: { id: string; maps: string[] }[];
    scenarioSchema?: Record<string, unknown>;
  }) => apiClient.upsertEnv(payload),
  createEnvVersion: async (
    envId: string,
    payload: {
      version: string;
      apiMode: string;
      entrypoint: string;
      package?: string;
      mapSets?: { id: string; maps: string[] }[];
      scenarioSchema?: Record<string, unknown>;
    },
  ) => apiClient.createEnvVersion(envId, payload),
  updateEnvVersion: async (
    envId: string,
    version: string,
    payload: {
      apiMode?: string;
      entrypoint?: string;
      package?: string;
      active?: boolean;
      mapSets?: { id: string; maps: string[] }[];
      scenarioSchema?: Record<string, unknown>;
    },
  ) => apiClient.updateEnvVersion(envId, version, payload),
  freezeEnvVersion: async (envId: string, version: string): Promise<EnvVersion> =>
    apiClient.freezeEnvVersion(envId, version),
  getPools: async (): Promise<OpponentPool[]> => apiClient.listOpponentPools(),
  getPoolById: async (id: string): Promise<OpponentPool> => apiClient.getOpponentPool(id),
  createPool: async (payload: { name: string; env: string; version?: string; memberSnapshotIds?: string[] }) =>
    apiClient.createOpponentPool(payload),
  createPoolVersion: async (poolId: string, payload?: { version?: string; memberSnapshotIds?: string[] }) =>
    apiClient.createOpponentPoolVersion(poolId, payload),
  listPoolVersions: async (poolId: string): Promise<OpponentPool[]> => apiClient.listOpponentPoolVersions(poolId),
  updatePoolMembers: async (poolId: string, payload: { snapshotIds: string[]; mode: 'append' | 'remove' }) =>
    apiClient.updateOpponentPoolMembers(poolId, payload),
  freezePool: async (poolId: string): Promise<OpponentPool> => apiClient.freezeOpponentPool(poolId),
  deletePool: async (poolId: string): Promise<void> => apiClient.deleteOpponentPool(poolId),
  getProtocols: async (): Promise<EvalProtocol[]> => apiClient.listEvalProtocols(),
  getProtocolById: async (id: string) => apiClient.getEvalProtocol(id),
  createProtocol: async (payload: {
    name: string;
    version?: string;
    env: { envId: string; version: string; mapSet: string };
    evalSeeds: number[];
    episodesPerMatch: number;
    scenarioGrid?: Record<string, unknown>;
    opponentSampling?: Record<string, unknown>;
    opponentPoolRef?: { poolId: string; version: string };
  }) => apiClient.createEvalProtocol(payload),
  updateProtocol: async (
    protocolId: string,
    payload: {
      name?: string;
      env?: { envId: string; version: string; mapSet: string };
      evalSeeds?: number[];
      episodesPerMatch?: number;
      scenarioGrid?: Record<string, unknown> | null;
      opponentSampling?: Record<string, unknown> | null;
      opponentPoolRef?: { poolId: string; version: string } | null;
    },
  ) => apiClient.updateEvalProtocol(protocolId, payload),
  createProtocolVersion: async (
    protocolId: string,
    payload?: {
      version?: string;
      name?: string;
      env?: { envId: string; version: string; mapSet: string };
      evalSeeds?: number[];
      episodesPerMatch?: number;
      scenarioGrid?: Record<string, unknown>;
      opponentSampling?: Record<string, unknown>;
      opponentPoolRef?: { poolId: string; version: string };
    },
  ) => apiClient.createEvalProtocolVersion(protocolId, payload),
  listProtocolVersions: async (protocolId: string): Promise<EvalProtocol[]> => apiClient.listEvalProtocolVersions(protocolId),
  freezeProtocol: async (protocolId: string) => apiClient.freezeEvalProtocol(protocolId),
  deleteProtocol: async (protocolId: string): Promise<void> => apiClient.deleteEvalProtocol(protocolId),
  submitEvalJob: async (payload: { policySnapshotId: string; protocolId: string; resources?: { gpus: number } }) =>
    apiClient.submitEvalJob(payload),
  getDatasets: async (): Promise<Dataset[]> => {
    const res = await authFetch(`${apiBaseUrl}/datasets`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'datasets_fetch_failed');
    }
    return res.json();
  },
  registerDataset: async (payload: { name: string; description?: string; path: string; format?: string }): Promise<Dataset> => {
    const res = await authFetch(`${apiBaseUrl}/datasets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: payload.name,
        description: payload.description,
        path: payload.path,
        format: payload.format ?? 'jsonl',
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'dataset_register_failed');
    }
    return res.json();
  },
  uploadDataset: async (payload: { name: string; description?: string; format?: string; file: File }): Promise<Dataset> => {
    const form = new FormData();
    form.append('name', payload.name);
    if (payload.description) form.append('description', payload.description);
    form.append('format', payload.format ?? 'jsonl');
    form.append('file', payload.file);
    const res = await authFetch(`${apiBaseUrl}/datasets/upload`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'dataset_upload_failed');
    }
    return res.json();
  },
  submitTrainJob: async (payload: {
    projectId: string;
    templateVersionId: string;
    env: { envId: string; version: string; mapSet: string; wrappers?: string[] } & Record<string, unknown>;
    algo: { algoId: string; algoVersionId: string; preset?: string } & Record<string, unknown>;
    train: { totalEnvSteps: number; rolloutLen: number; batchSize: number; lr: number } & Record<string, unknown>;
    network?: Record<string, unknown>;
    resources: { gpus: number; priority?: number };
    seedSet?: number[];
    plugin?: { pluginId: string; version: string };
    git?: { repo?: string; branch?: string; commit?: string };
    groupId?: string;
    datasetId?: string;
  }) => apiClient.submitTrainJob(payload),
  getTuningStudy: async (studyName: string) => apiClient.getTuningStudy(studyName),
  submitMatrixJob: async (payload: {
    poolId?: string;
    policySnapshotIds: string[];
    protocolId: string;
    gamesPerPair?: number;
    metric?: string;
    resources?: { gpus: number };
  }) => apiClient.submitMatrixJob(payload),
  getEvalResultById: async (id: string) => apiClient.getEvalResult(id),
  getMatrixResults: async (params?: { runId?: string; protocolId?: string; poolId?: string }): Promise<MatrixResult[]> =>
    apiClient.listMatrixResults(params),
  getMatrixResultById: async (id: string): Promise<MatrixResult> => apiClient.getMatrixResult(id),
  getJobById: async (jobId: string) => apiClient.getJob(jobId),
  pauseJob: async (jobId: string, payload?: { reason?: string }) => apiClient.pauseJob(jobId, payload),
  resumeJob: async (jobId: string, payload?: { reason?: string }) => apiClient.resumeJob(jobId, payload),
  cancelJob: async (jobId: string, payload?: { reason?: string }) => apiClient.cancelJob(jobId, payload),
  downloadRunArtifactsArchive: async (runId: string): Promise<Blob> => apiClient.downloadRunArtifactsArchive(runId),
  getPlugins: async (params?: { includeArchived?: boolean }): Promise<Plugin[]> => apiClient.listPlugins(params),
  getPluginVersions: async (pluginId: string): Promise<PluginVersion[]> => apiClient.listPluginVersions(pluginId),
  createPluginVersion: async (payload: {
    pluginId: string;
    version: string;
    wheelUri: string;
    sha256: string;
    manifest?: Record<string, unknown>;
  }) => apiClient.createPluginVersion(payload),
  updatePlugin: async (pluginId: string, payload: { name?: string; description?: string; author?: string; type?: string; installed?: boolean; archived?: boolean }): Promise<Plugin> =>
    apiClient.updatePlugin(pluginId, payload),
  archivePlugin: async (pluginId: string): Promise<void> => apiClient.archivePlugin(pluginId),
  freezePluginVersion: async (pluginId: string, version: string) =>
    apiClient.freezePluginVersion(pluginId, version),
  getArtifacts: async (runId: string): Promise<ArtifactFile[]> => apiClient.listRunArtifacts(runId),
  getArtifactDownloadUrl: async (artifactId: string) => apiClient.getArtifactDownloadUrl(artifactId),
  getReproBundle: async (runId: string) => apiClient.getReproBundle(runId),

  // Notebooks
  createNotebook: async (projectId: string, name?: string) => apiClient.createNotebook(projectId, name),
  deleteNotebook: async (runId: string) => apiClient.deleteNotebook(runId),

  // Model Registry
  getModels: async (): Promise<RegisteredModel[]> => apiClient.listModels(),
  createModel: async (name: string, description?: string): Promise<RegisteredModel> => apiClient.createModel({ name, description }),
  getModelVersions: async (modelId: string): Promise<ModelVersion[]> => apiClient.listModelVersions(modelId),
  registerModelVersion: async (modelId: string, checkpointId: string): Promise<ModelVersion> => apiClient.createModelVersion(modelId, { checkpointId }),
  updateModelStage: async (versionId: string, stage: string): Promise<ModelVersion> => apiClient.updateModelVersionStage(versionId, stage),
  
  getSystemResources: async (): Promise<SystemResources> => apiClient.getSystemResources(),
};
