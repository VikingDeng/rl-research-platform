/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LogPage } from '../models/LogPage';
import type { RunMetricsResponse } from '../models/RunMetricsResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class MetricsService {
    /**
     * Query run metrics
     * @param runId
     * @param keys Metric keys to fetch
     * @param fromStep
     * @returns RunMetricsResponse OK
     * @throws ApiError
     */
    public static getRunsByRunIdMetrics(
        runId: string,
        keys?: Array<string>,
        fromStep?: number,
    ): CancelablePromise<RunMetricsResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/{run_id}/metrics',
            path: {
                'run_id': runId,
            },
            query: {
                'keys': keys,
                'fromStep': fromStep,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Query run logs
     * @param runId
     * @param page
     * @param pageSize
     * @returns LogPage OK
     * @throws ApiError
     */
    public static getRunsByRunIdLogs(
        runId: string,
        page: number = 1,
        pageSize: number = 50,
    ): CancelablePromise<LogPage> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/{run_id}/logs',
            path: {
                'run_id': runId,
            },
            query: {
                'page': page,
                'pageSize': pageSize,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Stream run metrics and status (WebSocket)
     * WebSocket endpoint that pushes metrics, job status, and checkpoint events.
     *
     * @param runId
     * @returns any OK
     * @throws ApiError
     */
    public static getRunsByRunIdStream(
        runId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/{run_id}/stream',
            path: {
                'run_id': runId,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
}
