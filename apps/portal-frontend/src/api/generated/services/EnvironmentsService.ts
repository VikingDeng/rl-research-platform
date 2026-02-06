/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EnvSpec } from '../models/EnvSpec';
import type { EnvSpecUpdate } from '../models/EnvSpecUpdate';
import type { EnvVersion } from '../models/EnvVersion';
import type { EnvVersionCreate } from '../models/EnvVersionCreate';
import type { EnvVersionUpdate } from '../models/EnvVersionUpdate';
import type { EnvVersionUpsert } from '../models/EnvVersionUpsert';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class EnvironmentsService {
    /**
     * List environments
     * @param page
     * @param pageSize
     * @param includeArchived
     * @returns EnvSpec OK
     * @throws ApiError
     */
    public static getEnvs(
        page: number = 1,
        pageSize: number = 50,
        includeArchived?: boolean,
    ): CancelablePromise<Array<EnvSpec>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/envs',
            query: {
                'page': page,
                'pageSize': pageSize,
                'includeArchived': includeArchived,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * List environment versions
     * @param envId
     * @returns EnvVersion OK
     * @throws ApiError
     */
    public static getEnvsByEnvIdVersions(
        envId: string,
    ): CancelablePromise<Array<EnvVersion>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/envs/{env_id}/versions',
            path: {
                'env_id': envId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Register or update environment metadata
     * @param requestBody
     * @returns EnvVersion Created
     * @throws ApiError
     */
    public static postAdminEnvs(
        requestBody: EnvVersionUpsert,
    ): CancelablePromise<EnvVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/envs',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Update environment metadata
     * @param envId
     * @param requestBody
     * @returns EnvSpec OK
     * @throws ApiError
     */
    public static patchAdminEnvs(
        envId: string,
        requestBody: EnvSpecUpdate,
    ): CancelablePromise<EnvSpec> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/envs/{env_id}',
            path: {
                'env_id': envId,
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
     * Archive environment
     * @param envId
     * @returns void
     * @throws ApiError
     */
    public static deleteAdminEnvs(
        envId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/envs/{env_id}',
            path: {
                'env_id': envId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Add environment version
     * @param envId
     * @param requestBody
     * @returns EnvVersion Created
     * @throws ApiError
     */
    public static postAdminEnvsByEnvIdVersions(
        envId: string,
        requestBody: EnvVersionCreate,
    ): CancelablePromise<EnvVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/envs/{env_id}/versions',
            path: {
                'env_id': envId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Update environment version
     * @param envId
     * @param version
     * @param requestBody
     * @returns EnvVersion OK
     * @throws ApiError
     */
    public static patchAdminEnvsByEnvIdVersionsByVersion(
        envId: string,
        version: string,
        requestBody: EnvVersionUpdate,
    ): CancelablePromise<EnvVersion> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/envs/{env_id}/versions/{version}',
            path: {
                'env_id': envId,
                'version': version,
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
     * Freeze environment version
     * @param envId
     * @param version
     * @returns EnvVersion OK
     * @throws ApiError
     */
    public static postAdminEnvVersionsFreeze(
        envId: string,
        version: string,
    ): CancelablePromise<EnvVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/envs/{env_id}/versions/{version}/freeze',
            path: {
                'env_id': envId,
                'version': version,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
}
