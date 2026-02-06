/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CheckpointMetrics } from './CheckpointMetrics';
export type Checkpoint = {
    id: string;
    runId: string;
    step: number;
    metrics: CheckpointMetrics;
    path: string;
    tags: Array<string>;
    createdAt: string;
};

