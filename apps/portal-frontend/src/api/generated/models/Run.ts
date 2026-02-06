/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GitInfo } from './GitInfo';
import type { JobStatus } from './JobStatus';
import type { RunMetrics } from './RunMetrics';
import type { RunType } from './RunType';
export type Run = {
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
    config: Record<string, any>;
    git?: GitInfo;
    metrics: RunMetrics;
};

