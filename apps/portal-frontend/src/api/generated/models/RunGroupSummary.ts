/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RunGroupItem } from './RunGroupItem';
import type { RunGroupMetricSummary } from './RunGroupMetricSummary';
export type RunGroupSummary = {
    groupId: string;
    totalRuns: number;
    statusCounts: Record<string, number>;
    metrics: Record<string, RunGroupMetricSummary>;
    runs: Array<RunGroupItem>;
};

