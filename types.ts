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
export type ArtifactFile = ApiTypes.ArtifactFile;
export type LogPage = ApiTypes.LogPage;
export type EvalResult = ApiTypes.EvalResult;
export type SettingsResponse = ApiTypes.SettingsResponse;
export type SettingsUpdate = ApiTypes.SettingsUpdate;
export type TokenRotateResponse = ApiTypes.TokenRotateResponse;
export type RetentionApplyResponse = ApiTypes.RetentionApplyResponse;
