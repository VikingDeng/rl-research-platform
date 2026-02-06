/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Job } from '../models/Job';
import type { JobControlRequest } from '../models/JobControlRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class JobsService {
    /**
     * Get job status
     * @param jobId
     * @returns Job OK
     * @throws ApiError
     */
    public static getJobsByJobId(
        jobId: string,
    ): CancelablePromise<Job> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/jobs/{job_id}',
            path: {
                'job_id': jobId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Cancel job
     * @param jobId
     * @param requestBody
     * @returns Job OK
     * @throws ApiError
     */
    public static postJobsByJobIdCancel(
        jobId: string,
        requestBody?: JobControlRequest,
    ): CancelablePromise<Job> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/jobs/{job_id}/cancel',
            path: {
                'job_id': jobId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Pause job
     * @param jobId
     * @param requestBody
     * @returns Job OK
     * @throws ApiError
     */
    public static postJobsByJobIdPause(
        jobId: string,
        requestBody?: JobControlRequest,
    ): CancelablePromise<Job> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/jobs/{job_id}/pause',
            path: {
                'job_id': jobId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Resume job
     * @param jobId
     * @param requestBody
     * @returns Job OK
     * @throws ApiError
     */
    public static postJobsByJobIdResume(
        jobId: string,
        requestBody?: JobControlRequest,
    ): CancelablePromise<Job> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/jobs/{job_id}/resume',
            path: {
                'job_id': jobId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
}
