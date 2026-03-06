import type {
  AgenticApproverListResponse,
  AgenticApprovalPolicyTemplateListResponse,
  AgenticAuditReplayResponse,
  AgenticActionResponse,
  AgenticIdeaInput,
  AgenticListResponse,
  AgenticMatrixResponse,
  AgenticReproResponse,
  AgenticRunReportResponse,
  AgenticRunCreateResponse,
  AgenticRunDetail,
  AgenticSubAgentListResponse,
  AgenticSpecValidationResponse,
  Algo,
  AlgoVersion,
  ArtifactFile,
  BootstrapResponse,
  Checkpoint,
  Dataset,
  EnvSpec,
  EnvVersion,
  EvalProtocol,
  LogPage,
  MatrixResult,
  ModelVersion,
  OpponentPool,
  Plugin,
  PluginVersion,
  Project,
  RegisteredModel,
  RetentionApplyResponse,
  Run,
  RunMetricsResponse,
  SettingsResponse,
  SettingsUpdate,
  SystemResources,
  Template,
  TemplateDetail,
  TokenRotateResponse,
} from '../types';
import { createApiClient } from '../apps/portal-frontend/src/api/generated/client';
import { createMockApi } from './mockApi';

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

const DEMO_STORAGE_KEY = 'rl_platform_demo_mode';

const isTruthyFlag = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const resolveDemoMode = () => {
  const envDemo = isTruthyFlag((import.meta as any)?.env?.VITE_DEMO_MODE);
  if (typeof window === 'undefined') {
    return envDemo;
  }

  const savedPreference = localStorage.getItem(DEMO_STORAGE_KEY);

  try {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('demo');
    if (query === '1' || query?.toLowerCase() === 'true') {
      localStorage.setItem(DEMO_STORAGE_KEY, '1');
    } else if (query === '0' || query?.toLowerCase() === 'false') {
      localStorage.setItem(DEMO_STORAGE_KEY, '0');
    }
  } catch {
    // Ignore malformed URL/search params.
  }

  const localFlag = localStorage.getItem(DEMO_STORAGE_KEY);
  if (localFlag === '1') return true;
  if (localFlag === '0') return false;

  return envDemo;
};

export const isDemoMode = resolveDemoMode();

export const setDemoMode = (enabled: boolean) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DEMO_STORAGE_KEY, enabled ? '1' : '0');
  window.location.reload();
};

const realApi = {
  login: async (payload: { email: string; password: string }) => apiClient.login(payload),
  getProjects: async (): Promise<Project[]> => apiClient.listProjects(),
  getProjectById: async (id: string): Promise<Project> => apiClient.getProject(id),
  createProject: async (payload: { name: string; description?: string; tags?: string[]; gitRepo?: string; gitBranch?: string }): Promise<Project> =>
    apiClient.createProject(payload),
  deleteProject: async (id: string): Promise<void> => apiClient.deleteProject(id),
  getRuns: async (params?: { projectId?: string; type?: string; status?: string; groupId?: string; page?: number; pageSize?: number }): Promise<Run[]> =>
    apiClient.listRuns(params as any),
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
    apiClient.upsertAlgo(payload as any),
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
  ) => apiClient.createAlgoVersion(algoId, payload as any),
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
  ) => apiClient.updateAlgoVersion(algoId, version, payload as any),
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
  }) => apiClient.upsertEnv(payload as any),
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
  ) => apiClient.createEnvVersion(envId, payload as any),
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
  ) => apiClient.updateEnvVersion(envId, version, payload as any),
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
  }) => apiClient.createEvalProtocol(payload as any),
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
  ) => apiClient.updateEvalProtocol(protocolId, payload as any),
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
  ) => apiClient.createEvalProtocolVersion(protocolId, payload as any),
  listProtocolVersions: async (protocolId: string): Promise<EvalProtocol[]> => apiClient.listEvalProtocolVersions(protocolId),
  freezeProtocol: async (protocolId: string) => apiClient.freezeEvalProtocol(protocolId),
  deleteProtocol: async (protocolId: string): Promise<void> => apiClient.deleteEvalProtocol(protocolId),

  submitEvalJob: async (payload: { policySnapshotId: string; protocolId: string; resources?: { gpus: number } }) =>
    apiClient.submitEvalJob(payload as any),

  getDatasets: async (): Promise<Dataset[]> => {
    const res = await authFetch(`${apiBaseUrl}/datasets`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'datasets_fetch_failed');
    }
    return res.json();
  },
  getDatasetPreview: async (datasetId: string) => {
    const res = await authFetch(`${apiBaseUrl}/datasets/${datasetId}/preview`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'preview_failed');
    }
    return res.json();
  },
  getDatasetDownloadUrl: async (datasetId: string) => ({
    url: `${apiBaseUrl}/datasets/${datasetId}/download`,
  }),
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
  }) => apiClient.submitTrainJob(payload as any),

  getTuningStudy: async (studyName: string) => apiClient.getTuningStudy(studyName),
  submitMatrixJob: async (payload: {
    poolId?: string;
    policySnapshotIds: string[];
    protocolId: string;
    gamesPerPair?: number;
    metric?: string;
    resources?: { gpus: number };
  }) => apiClient.submitMatrixJob(payload as any),
  getEvalResultById: async (id: string) => apiClient.getEvalResult(id),
  getMatrixResults: async (params?: { runId?: string; protocolId?: string; poolId?: string }): Promise<MatrixResult[]> =>
    apiClient.listMatrixResults(params),
  getMatrixResultById: async (id: string): Promise<MatrixResult> => apiClient.getMatrixResult(id),
  listAgenticApprovalPolicyTemplates: async (): Promise<AgenticApprovalPolicyTemplateListResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/approval-policy/templates`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_approval_policy_templates_failed');
    }
    return res.json();
  },
  suggestAgenticApprovalPolicyTemplates: async (idea: AgenticIdeaInput): Promise<AgenticApprovalPolicyTemplateListResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/approval-policy/templates/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(idea),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_approval_policy_suggest_failed');
    }
    return res.json();
  },
  listAgenticApprovers: async (): Promise<AgenticApproverListResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/approvers`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_approvers_list_failed');
    }
    return res.json();
  },
  validateAgenticSpec: async (idea: AgenticIdeaInput): Promise<AgenticSpecValidationResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/specs/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(idea),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_spec_validate_failed');
    }
    return res.json();
  },
  createAgenticRun: async (payload: {
    idea: AgenticIdeaInput;
    autoExecute?: boolean;
    induceFailure?: boolean;
  }): Promise<AgenticRunCreateResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_run_create_failed');
    }
    return res.json();
  },
  listAgenticRuns: async (params?: { page?: number; pageSize?: number }): Promise<AgenticListResponse> => {
    const query = new URLSearchParams();
    if (typeof params?.page === 'number') query.set('page', String(params.page));
    if (typeof params?.pageSize === 'number') query.set('page_size', String(params.pageSize));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await authFetch(`${apiBaseUrl}/agentic/runs${suffix}`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_runs_list_failed');
    }
    return res.json();
  },
  getAgenticRun: async (runId: string): Promise<AgenticRunDetail> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_run_get_failed');
    }
    return res.json();
  },
  getAgenticRunReport: async (runId: string): Promise<AgenticRunReportResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/report`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_run_report_get_failed');
    }
    return res.json();
  },
  listAgenticSubAgents: async (
    runId: string,
    params?: { page?: number; pageSize?: number; nodeId?: string; status?: string },
  ): Promise<AgenticSubAgentListResponse> => {
    const query = new URLSearchParams();
    if (typeof params?.page === 'number') query.set('page', String(params.page));
    if (typeof params?.pageSize === 'number') query.set('page_size', String(params.pageSize));
    if (params?.nodeId) query.set('node_id', params.nodeId);
    if (params?.status) query.set('status', params.status);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/sub-agents${suffix}`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_sub_agents_list_failed');
    }
    return res.json();
  },
  executeAgenticRun: async (runId: string, payload?: { mode?: 'all' | 'next' }): Promise<AgenticActionResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || { mode: 'all' }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_run_execute_failed');
    }
    return res.json();
  },
  approveAgenticActions: async (
    runId: string,
    payload: {
      approvalIds: string[];
      decision: 'approve' | 'reject' | 'reopen';
      actorId: string;
      actorRole: 'admin' | 'ops' | 'security';
      idempotencyKey?: string;
      comment?: string;
    },
  ): Promise<AgenticActionResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/approvals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_approvals_failed');
    }
    return res.json();
  },
  recoverAgenticRun: async (runId: string): Promise<AgenticActionResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/recover`, {
      method: 'POST',
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_run_recover_failed');
    }
    return res.json();
  },
  addAgenticBranch: async (
    runId: string,
    nodeId: string,
    payload: {
      title: string;
      hypothesis: string;
      executionPlan: string;
      expectedMetrics?: Record<string, unknown>;
      budget?: Record<string, unknown>;
      risk?: string;
    },
  ): Promise<AgenticActionResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/nodes/${nodeId}/branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_branch_add_failed');
    }
    return res.json();
  },
  deleteAgenticBranch: async (runId: string, nodeId: string): Promise<AgenticActionResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/nodes/${nodeId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_branch_delete_failed');
    }
    return res.json();
  },
  generateAgenticMatrix: async (
    runId: string,
    payload?: { checkpointIds?: string[]; maxSize?: number; downsample?: boolean },
  ): Promise<AgenticMatrixResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/matrix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_matrix_failed');
    }
    return res.json();
  },
  exportAgenticReproBundle: async (runId: string): Promise<AgenticReproResponse> => {
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/repro-bundle`, {
      method: 'POST',
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_repro_failed');
    }
    return res.json();
  },
  replayAgenticAudit: async (runId: string, uptoEventSeq?: number): Promise<AgenticAuditReplayResponse> => {
    const query = typeof uptoEventSeq === 'number' ? `?upto_event_seq=${encodeURIComponent(String(uptoEventSeq))}` : '';
    const res = await authFetch(`${apiBaseUrl}/agentic/runs/${runId}/audit-replay${query}`);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || 'agentic_audit_replay_failed');
    }
    return res.json();
  },

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
  }) => apiClient.createPluginVersion(payload as any),
  updatePlugin: async (
    pluginId: string,
    payload: { name?: string; description?: string; author?: string; type?: string; installed?: boolean; archived?: boolean },
  ): Promise<Plugin> => apiClient.updatePlugin(pluginId, payload),
  archivePlugin: async (pluginId: string): Promise<void> => apiClient.archivePlugin(pluginId),
  freezePluginVersion: async (pluginId: string, version: string) =>
    apiClient.freezePluginVersion(pluginId, version),

  getArtifacts: async (runId: string): Promise<ArtifactFile[]> => apiClient.listRunArtifacts(runId),
  getArtifactDownloadUrl: async (artifactId: string) => apiClient.getArtifactDownloadUrl(artifactId),
  getReproBundle: async (runId: string) => apiClient.getReproBundle(runId),

  createNotebook: async (projectId: string, name?: string) => (apiClient as any).createNotebook(projectId, name),
  deleteNotebook: async (runId: string) => (apiClient as any).deleteNotebook(runId),

  getModels: async (): Promise<RegisteredModel[]> => (apiClient as any).listModels(),
  createModel: async (name: string, description?: string): Promise<RegisteredModel> => (apiClient as any).createModel({ name, description }),
  getModelVersions: async (modelId: string): Promise<ModelVersion[]> => (apiClient as any).listModelVersions(modelId),
  registerModelVersion: async (modelId: string, checkpointId: string): Promise<ModelVersion> =>
    (apiClient as any).createModelVersion(modelId, { checkpointId }),
  updateModelStage: async (versionId: string, stage: string): Promise<ModelVersion> =>
    (apiClient as any).updateModelVersionStage(versionId, stage),

  getSystemResources: async (): Promise<SystemResources> => (apiClient as any).getSystemResources(),
};

const mockApi = createMockApi(apiBaseUrl) as typeof realApi;

let runtimeFallbackToMock = false;
let backendReachable: boolean | null = null;
let backendReachabilityProbe: Promise<boolean> | null = null;

const isNetworkUnavailableError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|Failed to fetch|NetworkError|fetch failed|Load failed/i.test(message);
};

const markRuntimeFallbackToMock = () => {
  runtimeFallbackToMock = true;
  backendReachable = false;
  if (typeof window !== 'undefined') {
    console.warn('[api] Backend unavailable, switched to demo fallback.');
  }
};

const probeBackendReachability = async () => {
  if (!(import.meta as any)?.env?.DEV) return true;
  if (runtimeFallbackToMock) return false;
  if (backendReachable !== null) return backendReachable;
  if (!backendReachabilityProbe) {
    backendReachabilityProbe = authFetch(`${apiBaseUrl}/settings`, { method: 'GET' })
      .then(() => true)
      .catch((err) => !isNetworkUnavailableError(err))
      .then((reachable) => {
        backendReachable = reachable;
        if (!reachable) {
          markRuntimeFallbackToMock();
        }
        return reachable;
      })
      .finally(() => {
        backendReachabilityProbe = null;
      });
  }
  return backendReachabilityProbe;
};

const withRuntimeFallback = <T extends Record<string, any>>(primary: T, fallback: T): T =>
  new Proxy(primary, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const fallbackFn = (fallback as any)[prop];
        if (runtimeFallbackToMock && typeof fallbackFn === 'function') {
          return fallbackFn(...args);
        }
        if (typeof fallbackFn === 'function' && !(runtimeFallbackToMock || isDemoMode)) {
          const reachable = await probeBackendReachability();
          if (!reachable) {
            return fallbackFn(...args);
          }
        }
        try {
          return await value(...args);
        } catch (err) {
          if (typeof fallbackFn === 'function' && isNetworkUnavailableError(err)) {
            markRuntimeFallbackToMock();
            return fallbackFn(...args);
          }
          throw err;
        }
      };
    },
  });

export const api: typeof realApi = isDemoMode ? mockApi : withRuntimeFallback(realApi, mockApi);
