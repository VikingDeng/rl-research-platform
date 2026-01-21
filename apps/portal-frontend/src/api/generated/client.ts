/* eslint-disable */
// AUTO-GENERATED FROM docs/openapi_v1.yaml. DO NOT EDIT BY HAND.

import {
  LoginRequest,
  LoginResponse,
  User,
  SettingsResponse,
  SettingsUpdate,
  TokenRotateResponse,
  RetentionApplyResponse,
  Project,
  ProjectCreate,
  ProjectUpdate,
  EnvSpec,
  EnvSpecUpdate,
  EnvVersion,
  EnvVersionCreate,
  EnvVersionUpsert,
  EnvVersionUpdate,
  Algo,
  AlgoUpdate,
  AlgoVersion,
  AlgoVersionCreate,
  AlgoVersionUpdate,
  Template,
  TemplateCreate,
  TemplateDetail,
  TemplateUpdate,
  TemplateVersion,
  TemplateVersionCreate,
  Plugin,
  PluginUpdate,
  PluginVersion,
  PluginVersionCreate,
  TrainJobRequest,
  TrainJobResponse,
  Run,
  Checkpoint,
  CheckpointTagRequest,
  Job,
  JobControlRequest,
  EvalProtocolSummary,
  EvalProtocol,
  EvalProtocolCreate,
  EvalProtocolUpdate,
  EvalProtocolVersionCreate,
  OpponentPoolSummary,
  OpponentPool,
  OpponentPoolCreate,
  OpponentPoolVersionCreate,
  OpponentPoolMembersUpdate,
  EvalJobRequest,
  EvalJobResponse,
  MatrixJobRequest,
  MatrixJobResponse,
  EvalResult,
  MatrixResult,
  RunMetricsResponse,
  LogPage,
  ArtifactFile,
  ArtifactDownloadResponse,
  ReproBundleResponse,
  WebhookCreate,
  Webhook,
  JobStatus,
  RunType,
} from './types';

export interface ApiClientOptions {
  baseUrl?: string;
  token?: string;
  fetcher?: typeof fetch;
}

const buildQuery = (params?: Record<string, unknown>): string => {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, String(item)));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};

const mergeHeaders = (base: HeadersInit | undefined, extra: HeadersInit | undefined): HeadersInit => {
  if (!base) return extra || {};
  if (!extra) return base;
  return { ...Object.fromEntries(new Headers(base)), ...Object.fromEntries(new Headers(extra)) };
};

export const createApiClient = (options: ApiClientOptions = {}) => {
  const baseUrl = options.baseUrl ?? '/api/v1';
  const fetcher = options.fetcher ?? fetch;

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const hasAuthHeader = new Headers(init.headers || {}).has('Authorization');
    const authHeader = !hasAuthHeader && options.token ? { Authorization: `Bearer ${options.token}` } : undefined;
    const headers = mergeHeaders(init.headers, authHeader);
    const response = await fetcher(`${baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const payload = JSON.parse(text);
        if (payload && typeof payload === 'object') {
          if ('detail' in payload) {
            const detail = (payload as { detail?: unknown }).detail;
            message = typeof detail === 'string' ? detail : JSON.stringify(detail);
          } else if ('error' in payload) {
            const errorMessage = (payload as { error?: { message?: string } }).error?.message;
            if (errorMessage) {
              message = errorMessage;
            }
          }
        }
      } catch {
        // keep raw text
      }
      throw new Error(`API ${response.status}: ${message}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  };

  const requestJson = async <T>(path: string, method: string, body?: unknown, init: RequestInit = {}): Promise<T> => {
    const headers = mergeHeaders(init.headers, { 'Content-Type': 'application/json' });
    return request<T>(path, { ...init, method, headers, body: body ? JSON.stringify(body) : undefined });
  };

  const requestBlob = async (path: string, init: RequestInit = {}): Promise<Blob> => {
    const hasAuthHeader = new Headers(init.headers || {}).has('Authorization');
    const authHeader = !hasAuthHeader && options.token ? { Authorization: `Bearer ${options.token}` } : undefined;
    const headers = mergeHeaders(init.headers, authHeader);
    const response = await fetcher(`${baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const payload = JSON.parse(text);
        if (payload && typeof payload === 'object') {
          if ('detail' in payload) {
            const detail = (payload as { detail?: unknown }).detail;
            message = typeof detail === 'string' ? detail : JSON.stringify(detail);
          } else if ('error' in payload) {
            const errorMessage = (payload as { error?: { message?: string } }).error?.message;
            if (errorMessage) {
              message = errorMessage;
            }
          }
        }
      } catch {
        // keep raw text
      }
      throw new Error(`API ${response.status}: ${message}`);
    }
    return response.blob();
  };

  return {
    // Auth
    login: (body: LoginRequest) => requestJson<LoginResponse>('/auth/login', 'POST', body, { headers: { Authorization: '' } }),
    getMe: () => request<User>('/auth/me'),

    // Settings
    getSettings: () => request<SettingsResponse>('/settings'),
    updateSettings: (body: SettingsUpdate) => requestJson<SettingsResponse>('/settings', 'PATCH', body),
    rotateToken: () => request<TokenRotateResponse>('/settings/token/rotate', { method: 'POST' }),
    applyRetention: () => request<RetentionApplyResponse>('/settings/retention/apply', { method: 'POST' }),

    // Projects
    listProjects: (params?: { page?: number; pageSize?: number }) =>
      request<Project[]>(`/projects${buildQuery(params)}`),
    createProject: (body: ProjectCreate) => requestJson<Project>('/projects', 'POST', body),
    getProject: (projectId: string) => request<Project>(`/projects/${projectId}`),
    updateProject: (projectId: string, body: ProjectUpdate) =>
      requestJson<Project>(`/projects/${projectId}`, 'PATCH', body),
    deleteProject: (projectId: string) => request<void>(`/projects/${projectId}`, { method: 'DELETE' }),

    // Environments
    listEnvs: (params?: { page?: number; pageSize?: number; includeArchived?: boolean }) =>
      request<EnvSpec[]>(`/envs${buildQuery(params)}`),
    listEnvVersions: (envId: string) => request<EnvVersion[]>(`/envs/${envId}/versions`),
    upsertEnv: (body: EnvVersionUpsert) => requestJson<EnvVersion>('/admin/envs', 'POST', body),
    updateEnv: (envId: string, body: EnvSpecUpdate) => requestJson<EnvSpec>(`/admin/envs/${envId}`, 'PATCH', body),
    archiveEnv: (envId: string) => request<void>(`/admin/envs/${envId}`, { method: 'DELETE' }),
    createEnvVersion: (envId: string, body: EnvVersionCreate) =>
      requestJson<EnvVersion>(`/admin/envs/${envId}/versions`, 'POST', body),
    updateEnvVersion: (envId: string, version: string, body: EnvVersionUpdate) =>
      requestJson<EnvVersion>(`/admin/envs/${envId}/versions/${version}`, 'PATCH', body),
    freezeEnvVersion: (envId: string, version: string) =>
      request<EnvVersion>(`/admin/envs/${envId}/versions/${version}/freeze`, { method: 'POST' }),

    // Templates / Algos
    listAlgos: (params?: { includeArchived?: boolean }) => request<Algo[]>(`/algos${buildQuery(params)}`),
    listAlgoVersions: (algoId: string) => request<AlgoVersion[]>(`/algos/${algoId}/versions`),
    upsertAlgo: (body: Algo) => requestJson<Algo>('/admin/algos', 'POST', body),
    updateAlgo: (algoId: string, body: AlgoUpdate) =>
      requestJson<Algo>(`/admin/algos/${algoId}`, 'PATCH', body),
    archiveAlgo: (algoId: string) => request<void>(`/admin/algos/${algoId}`, { method: 'DELETE' }),
    createAlgoVersion: (algoId: string, body: AlgoVersionCreate) =>
      requestJson<AlgoVersion>(`/admin/algos/${algoId}/versions`, 'POST', body),
    updateAlgoVersion: (algoId: string, version: string, body: AlgoVersionUpdate) =>
      requestJson<AlgoVersion>(`/admin/algos/${algoId}/versions/${version}`, 'PATCH', body),
    freezeAlgoVersion: (algoId: string, version: string) =>
      request<AlgoVersion>(`/admin/algos/${algoId}/versions/${version}/freeze`, { method: 'POST' }),
    listTemplates: (params?: { page?: number; pageSize?: number; projectId?: string; includeArchived?: boolean }) =>
      request<Template[]>(`/templates${buildQuery(params)}`),
    createProjectTemplate: (projectId: string, body: TemplateCreate) =>
      requestJson<Template>(`/projects/${projectId}/templates`, 'POST', body),
    getTemplate: (templateId: string) => request<TemplateDetail>(`/templates/${templateId}`),
    updateTemplate: (templateId: string, body: TemplateUpdate) =>
      requestJson<Template>(`/templates/${templateId}`, 'PATCH', body),
    archiveTemplate: (templateId: string) => request<void>(`/templates/${templateId}`, { method: 'DELETE' }),
    createTemplateVersion: (templateId: string, body: TemplateVersionCreate) =>
      requestJson<TemplateVersion>(`/templates/${templateId}/versions`, 'POST', body),
    freezeTemplateVersion: (templateId: string, versionId: string) =>
      request<TemplateVersion>(`/templates/${templateId}/versions/${versionId}/freeze`, { method: 'POST' }),

    // Plugins
    listPlugins: (params?: { page?: number; pageSize?: number; includeArchived?: boolean }) =>
      request<Plugin[]>(`/plugins${buildQuery(params)}`),
    createPluginVersion: (body: PluginVersionCreate) => requestJson<PluginVersion>('/admin/plugins', 'POST', body),
    updatePlugin: (pluginId: string, body: PluginUpdate) =>
      requestJson<Plugin>(`/admin/plugins/${pluginId}`, 'PATCH', body),
    archivePlugin: (pluginId: string) => request<void>(`/admin/plugins/${pluginId}`, { method: 'DELETE' }),
    listPluginVersions: (pluginId: string) => request<PluginVersion[]>(`/plugins/${pluginId}/versions`),
    freezePluginVersion: (pluginId: string, version: string) =>
      request<PluginVersion>(`/admin/plugins/${pluginId}/versions/${version}/freeze`, { method: 'POST' }),

    // Runs
    submitTrainJob: (body: TrainJobRequest) => requestJson<TrainJobResponse>('/train-jobs', 'POST', body),
    listRuns: (params?: {
      page?: number;
      pageSize?: number;
      projectId?: string;
      type?: RunType;
      status?: JobStatus;
    }) => request<Run[]>(`/runs${buildQuery(params)}`),
    getRun: (runId: string) => request<Run>(`/runs/${runId}`),
    getRunJob: (runId: string) => request<Job>(`/runs/${runId}/job`),
    listCheckpoints: (runId: string) => request<Checkpoint[]>(`/runs/${runId}/checkpoints`),
    tagCheckpoint: (runId: string, checkpointId: string, body: CheckpointTagRequest) =>
      requestJson<Checkpoint>(`/runs/${runId}/checkpoints/${checkpointId}/tag`, 'POST', body),
    deleteRun: (runId: string) => request<void>(`/runs/${runId}`, { method: 'DELETE' }),
    deleteRunsBatch: (runIds: string[]) => requestJson<{ deleted: number }>('/runs/batch/delete', 'POST', runIds),

    // Jobs
    getJob: (jobId: string) => request<Job>(`/jobs/${jobId}`),
    cancelJob: (jobId: string, body?: JobControlRequest) =>
      requestJson<Job>(`/jobs/${jobId}/cancel`, 'POST', body),
    pauseJob: (jobId: string, body?: JobControlRequest) => requestJson<Job>(`/jobs/${jobId}/pause`, 'POST', body),
    resumeJob: (jobId: string, body?: JobControlRequest) =>
      requestJson<Job>(`/jobs/${jobId}/resume`, 'POST', body),

    // Eval protocols & pools
    listEvalProtocols: (params?: { page?: number; pageSize?: number }) =>
      request<EvalProtocolSummary[]>(`/eval-protocols${buildQuery(params)}`),
    createEvalProtocol: (body: EvalProtocolCreate) => requestJson<EvalProtocol>('/eval-protocols', 'POST', body),
    getEvalProtocol: (protocolId: string) => request<EvalProtocol>(`/eval-protocols/${protocolId}`),
    deleteEvalProtocol: (protocolId: string) => request<void>(`/eval-protocols/${protocolId}`, { method: 'DELETE' }),
    updateEvalProtocol: (protocolId: string, body: EvalProtocolUpdate) =>
      requestJson<EvalProtocol>(`/eval-protocols/${protocolId}`, 'PATCH', body),
    listEvalProtocolVersions: (protocolId: string) =>
      request<EvalProtocolSummary[]>(`/eval-protocols/${protocolId}/versions`),
    createEvalProtocolVersion: (protocolId: string, body?: EvalProtocolVersionCreate) =>
      requestJson<EvalProtocol>(`/eval-protocols/${protocolId}/versions`, 'POST', body),
    freezeEvalProtocol: (protocolId: string) => request<EvalProtocol>(`/eval-protocols/${protocolId}/freeze`, { method: 'POST' }),

    listOpponentPools: (params?: { page?: number; pageSize?: number }) =>
      request<OpponentPoolSummary[]>(`/opponent-pools${buildQuery(params)}`),
    getOpponentPool: (poolId: string) => request<OpponentPool>(`/opponent-pools/${poolId}`),
    createOpponentPool: (body: OpponentPoolCreate) => requestJson<OpponentPool>('/opponent-pools', 'POST', body),
    deleteOpponentPool: (poolId: string) => request<void>(`/opponent-pools/${poolId}`, { method: 'DELETE' }),
    updateOpponentPoolMembers: (poolId: string, body: OpponentPoolMembersUpdate) =>
      requestJson<OpponentPool>(`/opponent-pools/${poolId}/members`, 'POST', body),
    listOpponentPoolVersions: (poolId: string) =>
      request<OpponentPoolSummary[]>(`/opponent-pools/${poolId}/versions`),
    createOpponentPoolVersion: (poolId: string, body?: OpponentPoolVersionCreate) =>
      requestJson<OpponentPool>(`/opponent-pools/${poolId}/versions`, 'POST', body),
    freezeOpponentPool: (poolId: string) => request<OpponentPool>(`/opponent-pools/${poolId}/freeze`, { method: 'POST' }),

    // Eval / Matrix jobs
    submitEvalJob: (body: EvalJobRequest) => requestJson<EvalJobResponse>('/eval-jobs', 'POST', body),
    submitMatrixJob: (body: MatrixJobRequest) => requestJson<MatrixJobResponse>('/matrix-jobs', 'POST', body),
    getEvalResult: (evalResultId: string) => request<EvalResult>(`/eval-results/${evalResultId}`),
    listMatrixResults: (params?: { page?: number; pageSize?: number; runId?: string; protocolId?: string; poolId?: string }) =>
      request<MatrixResult[]>(`/matrix-results${buildQuery(params)}`),
    getMatrixResult: (matrixId: string) => request<MatrixResult>(`/matrix-results/${matrixId}`),

    // Metrics & logs
    queryRunMetrics: (runId: string, params?: { keys?: string[]; fromStep?: number }) =>
      request<RunMetricsResponse>(`/runs/${runId}/metrics${buildQuery(params)}`),
    queryRunLogs: (runId: string, params?: { page?: number; pageSize?: number }) =>
      request<LogPage>(`/runs/${runId}/logs${buildQuery(params)}`),

    // Artifacts
    listRunArtifacts: (runId: string) => request<ArtifactFile[]>(`/runs/${runId}/artifacts`),
    downloadRunArtifactsArchive: (runId: string) => requestBlob(`/runs/${runId}/artifacts/archive`),
    getArtifactDownloadUrl: (artifactId: string) => request<ArtifactDownloadResponse>(`/artifacts/${artifactId}/download_url`),
    getReproBundle: (runId: string) => request<ReproBundleResponse>(`/runs/${runId}/repro-bundle`),

    // Webhooks
    // Tuning
    submitTuningJob: (body: TuningRequest) => requestJson<TuningResponse>('/tuning-jobs', 'POST', body),
    getTuningStudy: (studyName: string) => request<any>(`/tuning/${studyName}`),

    // Notebooks
    createNotebook: (projectId: string, name?: string) => requestJson<{ runId: string; url: string; token: string }>('/notebooks', 'POST', { projectId, name }),
    deleteNotebook: (runId: string) => request<void>(`/notebooks/${runId}`, { method: 'DELETE' }),

    // Model Registry
    listModels: () => request<RegisteredModel[]>('/models'),
    createModel: (body: ModelCreate) => requestJson<RegisteredModel>('/models', 'POST', body),
    listModelVersions: (modelId: string) => request<ModelVersion[]>(`/models/${modelId}/versions`),
    createModelVersion: (modelId: string, body: ModelVersionCreate) => requestJson<ModelVersion>(`/models/${modelId}/versions`, 'POST', body),
    updateModelVersionStage: (versionId: string, stage: string) => requestJson<ModelVersion>(`/models/versions/${versionId}`, 'PATCH', { stage }),
  };
};
