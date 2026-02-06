/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { JobStatus } from './JobStatus';
export type RunGroupItem = {
    id: string;
    name: string;
    status: JobStatus;
    created: string;
    algo: string;
    env: string;
    seed?: number;
    metrics: Record<string, number>;
};

