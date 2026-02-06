/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MetricPoint } from './MetricPoint';
export type RunMetricsResponse = {
    runId: string;
    series: Record<string, Array<MetricPoint>>;
};

