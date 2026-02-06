/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConfidenceInterval } from './ConfidenceInterval';
import type { EvalResultSummary } from './EvalResultSummary';
export type EvalResult = {
    id: string;
    runId?: string;
    protocolId: string;
    metrics?: Record<string, number>;
    summary?: EvalResultSummary;
    ci?: ConfidenceInterval;
    createdAt?: string;
    artifactUrl?: string;
};

