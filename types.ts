import type * as ApiTypes from './apps/portal-frontend/src/api/generated/types';

export const JobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const RunType = {
  TRAIN: 'TRAIN',
  EVAL: 'EVAL',
  MATRIX: 'MATRIX',
} as const;
export type RunType = (typeof RunType)[keyof typeof RunType];

export type Project = ApiTypes.Project;
export type MetricPoint = ApiTypes.MetricPoint;
export type Run = ApiTypes.Run;
export type RunMetricsResponse = ApiTypes.RunMetricsResponse;
export type Checkpoint = ApiTypes.Checkpoint;
export type EvalProtocol = ApiTypes.EvalProtocolSummary;
export type EvalProtocolDetail = ApiTypes.EvalProtocol;
export type Template = ApiTypes.Template;
export type TemplateDetail = ApiTypes.TemplateDetail;
export type TemplateVersion = ApiTypes.TemplateVersion;
export type Algo = ApiTypes.Algo;
export type AlgoVersion = ApiTypes.AlgoVersion;
export type EnvSpec = ApiTypes.EnvSpec;
export type EnvVersion = ApiTypes.EnvVersion;
export type EnvMapSet = ApiTypes.EnvMapSet;
export type MatrixCell = ApiTypes.MatrixCell;
export type MatrixResult = ApiTypes.MatrixResult;
export type OpponentPool = ApiTypes.OpponentPoolSummary;
export type Plugin = ApiTypes.Plugin;
export type PluginVersion = ApiTypes.PluginVersion;
export type Dataset = {
  id: string;
  name: string;
  description?: string;
  path: string;
  format: string;
  sizeBytes: number;
  createdAt: string;
};
export type ArtifactFile = ApiTypes.ArtifactFile;
export type LogPage = ApiTypes.LogPage;
export type EvalResult = ApiTypes.EvalResult;
export type SettingsResponse = ApiTypes.SettingsResponse;
export type SettingsUpdate = ApiTypes.SettingsUpdate;
export type TokenRotateResponse = ApiTypes.TokenRotateResponse;
export type RetentionApplyResponse = ApiTypes.RetentionApplyResponse;
export type RegisteredModel = ApiTypes.RegisteredModel;
export type ModelVersion = ApiTypes.ModelVersion;
export type SystemResources = ApiTypes.SystemResources;
export type GpuInfo = ApiTypes.GpuInfo;
export type RunGroupSummary = {
  groupId: string;
  totalRuns: number;
  statusCounts: Record<string, number>;
  metrics: Record<string, { mean: number; std: number; min: number; max: number; n: number; bestRunId?: string; ciLow?: number; ciHigh?: number }>;
  runs: Array<{
    id: string;
    name: string;
    status: string;
    created: string;
    algo: string;
    env: string;
    seed?: number;
    metrics: Record<string, number>;
  }>;
};

export type BootstrapResponse = {
  created: {
    projects: number;
    envs: number;
    envVersions: number;
    algos: number;
    algoVersions: number;
    templates: number;
    templateVersions: number;
  };
  defaults: {
    projectId: string;
    envId: string;
    envVersion: string;
    algoId: string;
    algoVersionId: string;
    templateId: string;
    templateVersionId: string;
  };
};

export type AgenticIdeaInput = {
  title: string;
  taskGoal: string;
  environment: string;
  dataSources: string[];
  successMetrics: Record<string, unknown>;
  budget: {
    gpuHours: number;
    wallclockMinutes: number;
  };
  constraints: {
    compliance: string[];
    forbiddenActions: string[];
    allowNetwork: boolean;
    allowDependencyInstall: boolean;
  };
  executionMode?: 'offline_stub' | 'local_shell' | 'mle_runner';
  localCommand?: string | null;
  git?: {
    repo?: string;
    branch?: string;
    commit?: string;
  };
  requestedActions?: string[];
  subAgentPolicy?: {
    enabled: boolean;
    maxDepth: number;
    maxPerNode: number;
    maxTotal: number;
    timeoutMs: number;
  };
  approvalPolicy?: {
    mode: 'strict' | 'balanced' | 'permissive';
    highRiskActions: string[];
    blockedActionRoles: Array<'admin' | 'ops' | 'security'>;
    highRiskActionRoles: Array<'admin' | 'ops' | 'security'>;
    requireApprovalForUnknownActions?: boolean;
    minApprovals?: number;
    requireDistinctRoles?: boolean;
    approvalTtlMinutes?: number;
  };
};

export type AgenticNode = {
  nodeId: string;
  parentId?: string | null;
  agent: string;
  title: string;
  hypothesis: string;
  executionPlan: string;
  expectedMetrics: Record<string, unknown>;
  budget: Record<string, unknown>;
  risk: string;
  status: string;
  rationale?: string | null;
  evidence: Record<string, unknown>;
  subAgents?: Array<Record<string, unknown>>;
  nextSuggestions: string[];
  children: string[];
};

export type AgenticContractReport = {
  totalRequired: number;
  present: number;
  passRate: number;
  missing: string[];
};

export type AgenticSearchStats = {
  totalNodes: number;
  rootNodes: number;
  maxDepth: number;
  expandedNodes: number;
  visitedNodes: number;
  pendingNodes: number;
  avgBranchingFactor: number;
  avgFrontierScore: number;
  avgValue: number;
  totalVisits: number;
  selectionEvents: number;
  expansionEvents: number;
  explorationCoverage: number;
};

export type AgenticMatrixCell = {
  row: string;
  col: string;
  value: number;
  winRate: number;
  confidence: number;
  verdict: string;
  logUri: string;
  replayUri: string;
};

export type AgenticMatrix = {
  labels: string[];
  matrix: number[][];
  cells: AgenticMatrixCell[];
  ranking: Array<{ id: string; score: number }>;
  meta: {
    metric: string;
    gamesPerPair: number;
    generatedAt: string;
    downsampled?: boolean;
    originalCount?: number;
  };
};

export type AgenticRunSummary = {
  runId: string;
  title: string;
  objective: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  contractPassRate: number;
  failureReason?: string | null;
};

export type AgenticLlmTraceRecord = {
  ts: string;
  task: string;
  status: string;
  model: string;
  attempt: number;
  latencyMs: number;
  nodeId?: string | null;
  role?: string | null;
  promptHash: string;
  responseHash?: string | null;
  schemaValid: boolean;
  error?: string | null;
};

export type AgenticRunDetail = {
  runId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  idea: Record<string, unknown>;
  researchSpec: Record<string, unknown>;
  rootConfigDraft: Record<string, unknown>;
  evalProtocolDraft: Record<string, unknown>;
  riskStatement: string;
  totTree: AgenticNode[];
  timeline: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  pendingApprovals: Array<Record<string, unknown>>;
  nodeRuns: AgenticNodeRunRecord[];
  llmTraces: AgenticLlmTraceRecord[];
  contract: AgenticContractReport;
  searchStats: AgenticSearchStats;
  matrix?: AgenticMatrix | null;
  registryRecord: Record<string, unknown>;
  reproBundle?: Record<string, unknown> | null;
};

export type AgenticRunCreateResponse = {
  runId: string;
  status: string;
  detail: AgenticRunDetail;
};

export type AgenticSubAgentRecord = {
  subAgentId: string;
  parentNodeId: string;
  parentSubAgentId?: string | null;
  ownerAgent: string;
  role: string;
  objective: string;
  depth: number;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  evidence: Record<string, unknown>;
  children: string[];
};

export type AgenticSubAgentListResponse = {
  runId: string;
  page: number;
  pageSize: number;
  total: number;
  items: AgenticSubAgentRecord[];
};

export type AgenticNodeRunRecord = {
  nodeRunId: string;
  runId: string;
  nodeId: string;
  parentNodeId?: string | null;
  parentNodeRunId?: string | null;
  agent: string;
  title: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  patchPlan: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
  artifactPaths: string[];
  replayRef: Record<string, unknown>;
  error?: string | null;
};

export type AgenticListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: AgenticRunSummary[];
};

export type AgenticSpecValidationResponse = {
  valid: boolean;
  normalizedSpec: Record<string, unknown>;
  rootConfigDraft: Record<string, unknown>;
  evalProtocolDraft: Record<string, unknown>;
  riskStatement: string;
  retrievalContext: Array<Record<string, unknown>>;
};

export type AgenticActionResponse = {
  ok: boolean;
  message: string;
  detail: AgenticRunDetail;
};

export type AgenticMatrixResponse = {
  runId: string;
  matrix: AgenticMatrix;
};

export type AgenticReproResponse = {
  runId: string;
  bundlePath: string;
  manifest: Record<string, unknown>;
};

export type AgenticAuditReplayResponse = {
  runId: string;
  verified: boolean;
  checkedEvents: number;
  chainHead?: string | null;
  failureReason?: string | null;
  replay: {
    uptoEventSeq?: number | null;
    replayedEvents?: number;
    replayStatus?: string;
    matchesCurrentState?: boolean | null;
    nodeStates?: Record<string, string>;
    subAgentStates?: Record<string, string>;
    subAgentsStarted?: number;
    subAgentsSucceeded?: number;
    subAgentsFailed?: number;
    branchOps?: Record<string, number>;
    approvalsUpdated?: number;
    matrixGenerated?: boolean;
    reproExported?: boolean;
    semanticValid?: boolean;
    semanticIssues?: string[];
  };
};

export type AgenticRunReportModel = {
  runId: string;
  title: string;
  status: string;
  generatedAt: string;
  objective: string;
  contractPassRate: number;
  contractMissing: string[];
  totNodes: number;
  timelineEvents: number;
  failureEvents: number;
  recoveryEvents: number;
  safetyEvents: number;
  leagueEvents: number;
  approvals: {
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    reopened: number;
  };
  subAgents: {
    total: number;
    running: number;
    succeeded: number;
    failed: number;
    topRoles: Array<{ role: string; count: number }>;
  };
  nodeRuns?: {
    total: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  matrix: {
    labels: number;
    topRanking: Array<{ rank: number; id: string; score: number }>;
  };
  reproScript: string;
  replayCommand: string;
  nodeStatus?: Record<string, number>;
  registryRecord?: Record<string, unknown>;
  approvalPolicyMeta?: Record<string, unknown>;
};

export type AgenticRunReportResponse = {
  runId: string;
  generatedAt: string;
  report: AgenticRunReportModel;
  markdown: string;
  artifactJsonPath: string;
  artifactMarkdownPath: string;
};

export type AgenticApprovalPolicyTemplate = {
  templateId: string;
  label: string;
  description: string;
  rationale: string;
  recommended: boolean;
  policy: NonNullable<AgenticIdeaInput['approvalPolicy']>;
};

export type AgenticApprovalPolicyTemplateListResponse = {
  recommendedTemplateId?: string | null;
  contextSummary: Record<string, unknown>;
  items: AgenticApprovalPolicyTemplate[];
};

export type AgenticApproverRecord = {
  actorId: string;
  roles: Array<'admin' | 'ops' | 'security' | string>;
  scopes: string[];
  actionAllowlist: string[];
  actionDenylist: string[];
  active: boolean;
  note?: string | null;
};

export type AgenticApproverListResponse = {
  strictMode: boolean;
  total: number;
  items: AgenticApproverRecord[];
};
