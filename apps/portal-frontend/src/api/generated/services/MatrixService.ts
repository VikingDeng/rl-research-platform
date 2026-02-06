/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MatrixJobRequest } from '../models/MatrixJobRequest';
import type { MatrixJobResponse } from '../models/MatrixJobResponse';
import type { MatrixResult } from '../models/MatrixResult';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class MatrixService {
    /**
     * Submit matrix job
     * @param requestBody
     * @returns MatrixJobResponse Created
     * @throws ApiError
     */
    public static postMatrixJobs(
        requestBody: MatrixJobRequest,
    ): CancelablePromise<MatrixJobResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/matrix-jobs',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * List matrix results
     * @param page
     * @param pageSize
     * @param runId
     * @param protocolId
     * @param poolId
     * @returns MatrixResult OK
     * @throws ApiError
     */
    public static getMatrixResults(
        page: number = 1,
        pageSize: number = 50,
        runId?: string,
        protocolId?: string,
        poolId?: string,
    ): CancelablePromise<Array<MatrixResult>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/matrix-results',
            query: {
                'page': page,
                'pageSize': pageSize,
                'runId': runId,
                'protocolId': protocolId,
                'poolId': poolId,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Get matrix result
     * @param matrixId
     * @returns MatrixResult OK
     * @throws ApiError
     */
    public static getMatrixResultsByMatrixId(
        matrixId: string,
    ): CancelablePromise<MatrixResult> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/matrix-results/{matrix_id}',
            path: {
                'matrix_id': matrixId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
}
