/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EvalJobRequest } from '../models/EvalJobRequest';
import type { EvalJobResponse } from '../models/EvalJobResponse';
import type { EvalProtocol } from '../models/EvalProtocol';
import type { EvalProtocolCreate } from '../models/EvalProtocolCreate';
import type { EvalProtocolSummary } from '../models/EvalProtocolSummary';
import type { EvalProtocolVersionCreate } from '../models/EvalProtocolVersionCreate';
import type { EvalResult } from '../models/EvalResult';
import type { OpponentPool } from '../models/OpponentPool';
import type { OpponentPoolCreate } from '../models/OpponentPoolCreate';
import type { OpponentPoolMembersUpdate } from '../models/OpponentPoolMembersUpdate';
import type { OpponentPoolSummary } from '../models/OpponentPoolSummary';
import type { OpponentPoolVersionCreate } from '../models/OpponentPoolVersionCreate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class EvalService {
    /**
     * List evaluation protocols
     * @param page
     * @param pageSize
     * @returns EvalProtocolSummary OK
     * @throws ApiError
     */
    public static getEvalProtocols(
        page: number = 1,
        pageSize: number = 50,
    ): CancelablePromise<Array<EvalProtocolSummary>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/eval-protocols',
            query: {
                'page': page,
                'pageSize': pageSize,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Create evaluation protocol
     * @param requestBody
     * @returns EvalProtocol Created
     * @throws ApiError
     */
    public static postEvalProtocols(
        requestBody: EvalProtocolCreate,
    ): CancelablePromise<EvalProtocol> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/eval-protocols',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Get evaluation protocol
     * @param protocolId
     * @returns EvalProtocol OK
     * @throws ApiError
     */
    public static getEvalProtocolsByProtocolId(
        protocolId: string,
    ): CancelablePromise<EvalProtocol> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/eval-protocols/{protocol_id}',
            path: {
                'protocol_id': protocolId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Delete evaluation protocol (all versions)
     * @param protocolId
     * @returns void
     * @throws ApiError
     */
    public static deleteEvalProtocolsByProtocolId(
        protocolId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/eval-protocols/{protocol_id}',
            path: {
                'protocol_id': protocolId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * List evaluation protocol versions
     * @param protocolId
     * @returns EvalProtocolSummary OK
     * @throws ApiError
     */
    public static getEvalProtocolsByProtocolIdVersions(
        protocolId: string,
    ): CancelablePromise<Array<EvalProtocolSummary>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/eval-protocols/{protocol_id}/versions',
            path: {
                'protocol_id': protocolId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Create evaluation protocol version
     * @param protocolId
     * @param requestBody
     * @returns EvalProtocol Created
     * @throws ApiError
     */
    public static postEvalProtocolsByProtocolIdVersions(
        protocolId: string,
        requestBody?: EvalProtocolVersionCreate,
    ): CancelablePromise<EvalProtocol> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/eval-protocols/{protocol_id}/versions',
            path: {
                'protocol_id': protocolId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Freeze evaluation protocol
     * @param protocolId
     * @returns EvalProtocol OK
     * @throws ApiError
     */
    public static postEvalProtocolsByProtocolIdFreeze(
        protocolId: string,
    ): CancelablePromise<EvalProtocol> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/eval-protocols/{protocol_id}/freeze',
            path: {
                'protocol_id': protocolId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * List opponent pools
     * @param page
     * @param pageSize
     * @returns OpponentPoolSummary OK
     * @throws ApiError
     */
    public static getOpponentPools(
        page: number = 1,
        pageSize: number = 50,
    ): CancelablePromise<Array<OpponentPoolSummary>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/opponent-pools',
            query: {
                'page': page,
                'pageSize': pageSize,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Create opponent pool
     * @param requestBody
     * @returns OpponentPool Created
     * @throws ApiError
     */
    public static postOpponentPools(
        requestBody: OpponentPoolCreate,
    ): CancelablePromise<OpponentPool> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/opponent-pools',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Get opponent pool
     * @param poolId
     * @returns OpponentPool OK
     * @throws ApiError
     */
    public static getOpponentPoolsByPoolId(
        poolId: string,
    ): CancelablePromise<OpponentPool> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/opponent-pools/{pool_id}',
            path: {
                'pool_id': poolId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Delete opponent pool (all versions)
     * @param poolId
     * @returns void
     * @throws ApiError
     */
    public static deleteOpponentPoolsByPoolId(
        poolId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/opponent-pools/{pool_id}',
            path: {
                'pool_id': poolId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * List opponent pool versions
     * @param poolId
     * @returns OpponentPoolSummary OK
     * @throws ApiError
     */
    public static getOpponentPoolsByPoolIdVersions(
        poolId: string,
    ): CancelablePromise<Array<OpponentPoolSummary>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/opponent-pools/{pool_id}/versions',
            path: {
                'pool_id': poolId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Create opponent pool version
     * @param poolId
     * @param requestBody
     * @returns OpponentPool Created
     * @throws ApiError
     */
    public static postOpponentPoolsByPoolIdVersions(
        poolId: string,
        requestBody?: OpponentPoolVersionCreate,
    ): CancelablePromise<OpponentPool> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/opponent-pools/{pool_id}/versions',
            path: {
                'pool_id': poolId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Add or remove opponent pool members
     * @param poolId
     * @param requestBody
     * @returns OpponentPool OK
     * @throws ApiError
     */
    public static postOpponentPoolsByPoolIdMembers(
        poolId: string,
        requestBody: OpponentPoolMembersUpdate,
    ): CancelablePromise<OpponentPool> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/opponent-pools/{pool_id}/members',
            path: {
                'pool_id': poolId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Freeze opponent pool
     * @param poolId
     * @returns OpponentPool OK
     * @throws ApiError
     */
    public static postOpponentPoolsByPoolIdFreeze(
        poolId: string,
    ): CancelablePromise<OpponentPool> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/opponent-pools/{pool_id}/freeze',
            path: {
                'pool_id': poolId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Submit evaluation job
     * @param requestBody
     * @returns EvalJobResponse Created
     * @throws ApiError
     */
    public static postEvalJobs(
        requestBody: EvalJobRequest,
    ): CancelablePromise<EvalJobResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/eval-jobs',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Get evaluation result
     * @param evalResultId
     * @returns EvalResult OK
     * @throws ApiError
     */
    public static getEvalResultsByEvalResultId(
        evalResultId: string,
    ): CancelablePromise<EvalResult> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/eval-results/{eval_result_id}',
            path: {
                'eval_result_id': evalResultId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
}
