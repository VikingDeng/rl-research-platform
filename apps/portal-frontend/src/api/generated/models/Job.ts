/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { JobStatus } from './JobStatus';
export type Job = {
    id: string;
    runId: string;
    status: JobStatus;
    createdAt?: string;
    updatedAt?: string;
    message?: string;
};

