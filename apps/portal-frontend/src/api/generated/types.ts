/* eslint-disable */
// AUTO-GENERATED FROM docs/openapi_v1.yaml. DO NOT EDIT BY HAND.

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  tokenType?: string;
  expiresAt?: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  roles?: string[];
}

export interface ExecutorSettings {
  mode: string;
  localGpuCount: number;
  determinedMasterUrl?: string | null;
  determinedConnected?: boolean | null;
  scheduler?: string | null;
}

export interface StorageUsage {
  artifactBytes: number;
  dbBytes?: number | null;
}

export interface RetentionPolicy {
  checkpointPolicy: string;
}

export interface SettingsResponse {
  apiToken: string;
  executor: ExecutorSettings;
  storage: StorageUsage;
  retention: RetentionPolicy;
}

export interface SettingsUpdate {
  checkpointPolicy?: string;
}

export interface TokenRotateResponse {
  apiToken: string;
}

export interface RetentionApplyResponse {
  runsProcessed: number;
  checkpointsRemoved: number;
  artifactsRemoved: number;
}

export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
export type RunType = 'TRAIN' | 'EVAL' | 'MATRIX';
export type TemplateType = 'Single-Agent' | 'Multi-Agent';
export type PluginType = 'Algorithm' | 'Model' | 'Wrapper';

export interface Project {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  createdAt?: string;
  updatedAt: string;
  activeRuns?: number;
  totalRuns?: number;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  tags?: string[];
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface EnvSpec {
  id: string;
  versions: string[];
  maps: string[];
  archived: boolean;
}

export interface EnvSpecUpdate {
  archived?: boolean;
}

export interface EnvMapSet {
  id: string;
  maps: string[];
}

export interface EnvVersion {
  envId: string;
  version: string;
  apiMode: string;
  entrypoint?: string;
  package?: string;
  active?: boolean;
  frozen?: boolean;
  defaultImageDigest?: string;
  mapSets?: EnvMapSet[];
  scenarioSchema?: Record<string, unknown>;
}

export interface EnvVersionCreate {
  version: string;
  apiMode: string;
  entrypoint: string;
  package?: string;
  active?: boolean;
  frozen?: boolean;
  defaultImageDigest?: string;
  mapSets?: EnvMapSet[];
  scenarioSchema?: Record<string, unknown>;
}

export interface EnvVersionUpsert {
  envId: string;
  version: string;
  apiMode: string;
  entrypoint: string;
  package?: string;
  active?: boolean;
  frozen?: boolean;
  defaultImageDigest?: string;
  mapSets?: EnvMapSet[];
  scenarioSchema?: Record<string, unknown>;
}

export interface EnvVersionUpdate {
  apiMode?: string;
  entrypoint?: string;
  package?: string;
  active?: boolean;
  frozen?: boolean;
  defaultImageDigest?: string;
  mapSets?: EnvMapSet[];
  scenarioSchema?: Record<string, unknown>;
}

export interface Algo {
  id: string;
  name: string;
  description?: string;
  archived?: boolean;
}

export interface AlgoUpdate {
  name?: string;
  description?: string;
  archived?: boolean;
}

export interface AlgoVersion {
  id: string;
  algoId: string;
  version: string;
  entrypoint: string;
  package?: string;
  artifactUri?: string;
  configSchema?: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
  resourceProfile?: Record<string, unknown>;
  envConstraints?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  active: boolean;
  frozen?: boolean;
  createdAt?: string;
}

export interface AlgoVersionCreate {
  version: string;
  entrypoint: string;
  package?: string;
  artifactUri?: string;
  configSchema?: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
  resourceProfile?: Record<string, unknown>;
  envConstraints?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  active?: boolean;
  frozen?: boolean;
}

export interface AlgoVersionUpdate {
  entrypoint?: string;
  package?: string;
  artifactUri?: string;
  configSchema?: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
  resourceProfile?: Record<string, unknown>;
  envConstraints?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  active?: boolean;
  frozen?: boolean;
}

export interface Template {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  type: TemplateType;
  defaultConfig: Record<string, unknown>;
  archived?: boolean;
}

export interface TemplateDetail extends Template {
  versions?: TemplateVersion[];
}

export interface TemplateCreate {
  name: string;
  description?: string;
  type: TemplateType;
  defaultConfig?: Record<string, unknown>;
}

export interface TemplateUpdate {
  name?: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  archived?: boolean;
}

export interface TemplateVersion {
  id: string;
  templateId: string;
  algoVersionId?: string;
  version: string;
  defaultConfig?: Record<string, unknown>;
  networkTemplate?: Record<string, unknown>;
  envConstraints?: Record<string, unknown>;
  wrappers?: string[];
  createdAt?: string;
  frozen?: boolean;
}

export interface TemplateVersionCreate {
  version: string;
  algoVersionId: string;
  defaultConfig?: Record<string, unknown>;
  networkTemplate?: Record<string, unknown>;
  envConstraints?: Record<string, unknown>;
  wrappers?: string[];
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  type: PluginType;
  description?: string;
  author?: string;
  installed?: boolean;
  archived?: boolean;
}

export interface PluginUpdate {
  name?: string;
  description?: string;
  author?: string;
  type?: PluginType;
  installed?: boolean;
  archived?: boolean;
}

export interface PluginVersion {
  pluginId: string;
  version: string;
  wheelUri: string;
  sha256: string;
  manifest?: Record<string, unknown>;
  frozen?: boolean;
}

export interface PluginVersionCreate {
  pluginId: string;
  version: string;
  wheelUri: string;
  sha256: string;
  manifest?: Record<string, unknown>;
}

export interface MetricPoint {
  step: number;
  value: number;
}

export interface RunMetrics {
  returnMean: MetricPoint[];
  winRate: MetricPoint[];
  entropy: MetricPoint[];
}

export interface GitInfo {
  branch: string;
  commit: string;
  url: string;
  isDirty: boolean;
  diff?: string;
}

export interface Run {
  id: string;
  projectId: string;
  name: string;
  type: RunType;
  status: JobStatus;
  algo: string;
  env: string;
  duration?: string;
  gpu?: number;
  created: string;
  config: Record<string, unknown>;
  git?: GitInfo;
  metrics: RunMetrics;
}

export interface CheckpointMetrics {
  winRate: number;
  returnMean: number;
}

export interface Checkpoint {
  id: string;
  runId: string;
  step: number;
  metrics: CheckpointMetrics;
  path: string;
  tags: string[];
  createdAt: string;
}

export interface CheckpointTagRequest {
  tag: string;
}

export interface Job {
  id: string;
  runId: string;
  status: string;
  priority?: number;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
}

export interface JobControlRequest {
  reason?: string;
}

export interface TrainJobEnv {
  envId: string;
  version: string;
  mapSet: string;
  wrappers?: string[];
}

export interface TrainJobAlgo {
  algoId: string;
  algoVersionId: string;
  preset?: string;
}

export interface TrainJobAgent {
  policySharing?: string;
  arch?: string;
  recurrent?: boolean;
}

export interface TrainJobTrain {
  totalEnvSteps: number;
  rolloutLen: number;
  batchSize: number;
  lr: number;
  entropyCoef?: number;
  gamma?: number;
  gaeLambda?: number;
}

export interface ResourceSpec {
  gpus: number;
  cpus?: number;
  memGb?: number;
  priority?: number;
}

export interface PluginRef {
  pluginId: string;
  version: string;
}

export interface AutoEvalConfig {
  protocolId: string;
  triggerOn: string;
}

export interface TrainJobRequest {
  projectId: string;
  templateVersionId: string;
  env: TrainJobEnv;
  algo: TrainJobAlgo;
  agent?: TrainJobAgent;
  train: TrainJobTrain;
  resources: ResourceSpec;
  seedSet?: number[];
  plugin?: PluginRef;
  autoEval?: AutoEvalConfig;
}

export interface TrainJobResponse {
  runId: string;
  jobId: string;
}

export interface EnvRef {
  envId: string;
  version: string;
  mapSet: string;
}

export interface OpponentPoolRef {
  poolId: string;
  version: string;
}

export interface EvalProtocolSummary {
  id: string;
  protocolKey?: string;
  name: string;
  version: string;
  envId: string;
  map: string;
  evalSeeds: number[];
  episodes: number;
  frozen: boolean;
  created?: string;
}

export interface EvalProtocol {
  id: string;
  protocolKey?: string;
  name: string;
  version: string;
  env: EnvRef;
  evalSeeds: number[];
  episodesPerMatch: number;
  timeoutSec?: number;
  metrics?: string[];
  opponentPoolRef?: OpponentPoolRef;
  frozen: boolean;
  createdAt?: string;
}

export interface EvalProtocolCreate {
  name: string;
  version?: string;
  env: EnvRef;
  evalSeeds: number[];
  episodesPerMatch: number;
  timeoutSec?: number;
  metrics?: string[];
  opponentPoolRef?: OpponentPoolRef;
}

export interface EvalProtocolVersionCreate {
  version?: string;
  name?: string;
  env?: EnvRef;
  evalSeeds?: number[];
  episodesPerMatch?: number;
  timeoutSec?: number;
  metrics?: string[];
  opponentPoolRef?: OpponentPoolRef;
}

export interface OpponentPoolSummary {
  id: string;
  poolKey?: string;
  name: string;
  version: string;
  size: number;
  env: string;
  frozen: boolean;
  created?: string;
}

export interface OpponentPool {
  id: string;
  poolKey?: string;
  name: string;
  version: string;
  env: string;
  size?: number;
  frozen: boolean;
  created?: string;
  memberSnapshotIds?: string[];
}

export interface OpponentPoolCreate {
  name: string;
  env: string;
  version?: string;
  memberSnapshotIds?: string[];
}

export interface OpponentPoolVersionCreate {
  version?: string;
  memberSnapshotIds?: string[];
}

export interface OpponentPoolMembersUpdate {
  snapshotIds: string[];
  mode: 'append' | 'remove';
}

export interface EvalJobRequest {
  policySnapshotId: string;
  protocolId: string;
  resources?: ResourceSpec;
}

export interface EvalJobResponse {
  runId: string;
  jobId: string;
  evalResultId: string;
}

export interface MatrixJobRequest {
  poolId?: string;
  policySnapshotIds: string[];
  protocolId: string;
  gamesPerPair?: number;
  metric?: string;
  resources?: ResourceSpec;
}

export interface MatrixJobResponse {
  matrixId: string;
  jobId: string;
}

export interface EvalResult {
  id: string;
  runId?: string;
  protocolId: string;
  metrics?: Record<string, number>;
  summary?: EvalResultSummary;
  ci?: ConfidenceInterval;
  createdAt?: string;
  artifactUrl?: string;
}

export interface EvalResultSummary {
  mean: number;
  std: number;
  n: number;
}

export interface ConfidenceInterval {
  low: number;
  high: number;
  level: number;
}

export interface MatrixCell {
  row: string;
  col: string;
  value: number;
}

export interface MatrixResult {
  id: string;
  protocolId?: string;
  poolId?: string;
  createdAt?: string;
  cells: MatrixCell[];
  labels?: string[];
  matrix?: number[][];
  meta?: MatrixMeta;
  ranking?: RankingEntry[];
  artifacts?: MatrixArtifacts;
  summary?: Record<string, unknown>;
  exportUrl?: string;
}

export interface MatrixMeta {
  gamesPerPair?: number;
  seeds?: number[];
  metric?: string;
}

export interface RankingEntry {
  id: string;
  score: number;
  ci?: ConfidenceInterval;
}

export interface MatrixArtifacts {
  csvUri?: string;
  jsonUri?: string;
  heatmapUri?: string;
}

export interface RunMetricsResponse {
  runId: string;
  series: Record<string, MetricPoint[]>;
}

export interface LogPage {
  lines: string[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ArtifactFile {
  id: string;
  name: string;
  path: string;
  size?: string;
  type: 'file' | 'folder';
  lastModified: string;
  createdAt?: string;
  objectKey?: string;
}

export interface ArtifactDownloadResponse {
  url: string;
  expiresAt?: string;
}

export interface ReproBundleResponse {
  url?: string;
  manifest?: Record<string, unknown>;
}

export interface WebhookCreate {
  url: string;
  events: string[];
  secret?: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active?: boolean;
  createdAt?: string;
}
