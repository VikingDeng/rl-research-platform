/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Algo } from '../models/Algo';
import type { AlgoUpdate } from '../models/AlgoUpdate';
import type { AlgoVersion } from '../models/AlgoVersion';
import type { AlgoVersionCreate } from '../models/AlgoVersionCreate';
import type { AlgoVersionUpdate } from '../models/AlgoVersionUpdate';
import type { Template } from '../models/Template';
import type { TemplateCreate } from '../models/TemplateCreate';
import type { TemplateDetail } from '../models/TemplateDetail';
import type { TemplateUpdate } from '../models/TemplateUpdate';
import type { TemplateVersion } from '../models/TemplateVersion';
import type { TemplateVersionCreate } from '../models/TemplateVersionCreate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TemplatesService {
    /**
     * List registered algorithms
     * @param includeArchived
     * @returns Algo OK
     * @throws ApiError
     */
    public static getAlgos(
        includeArchived?: boolean,
    ): CancelablePromise<Array<Algo>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/algos',
            query: {
                'includeArchived': includeArchived,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * List algorithm versions
     * @param algoId
     * @returns AlgoVersion OK
     * @throws ApiError
     */
    public static getAlgoVersions(
        algoId: string,
    ): CancelablePromise<Array<AlgoVersion>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/algos/{algo_id}/versions',
            path: {
                'algo_id': algoId,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Register or update algorithm
     * @param requestBody
     * @returns Algo Created
     * @throws ApiError
     */
    public static postAdminAlgos(
        requestBody: Algo,
    ): CancelablePromise<Algo> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/algos',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Update algorithm metadata
     * @param algoId
     * @param requestBody
     * @returns Algo OK
     * @throws ApiError
     */
    public static patchAdminAlgos(
        algoId: string,
        requestBody: AlgoUpdate,
    ): CancelablePromise<Algo> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/algos/{algo_id}',
            path: {
                'algo_id': algoId,
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
     * Archive algorithm
     * @param algoId
     * @returns void
     * @throws ApiError
     */
    public static deleteAdminAlgos(
        algoId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/algos/{algo_id}',
            path: {
                'algo_id': algoId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Create algorithm version
     * @param algoId
     * @param requestBody
     * @returns AlgoVersion Created
     * @throws ApiError
     */
    public static postAdminAlgoVersions(
        algoId: string,
        requestBody: AlgoVersionCreate,
    ): CancelablePromise<AlgoVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/algos/{algo_id}/versions',
            path: {
                'algo_id': algoId,
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
     * Update algorithm version
     * @param algoId
     * @param version
     * @param requestBody
     * @returns AlgoVersion OK
     * @throws ApiError
     */
    public static patchAdminAlgoVersions(
        algoId: string,
        version: string,
        requestBody: AlgoVersionUpdate,
    ): CancelablePromise<AlgoVersion> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/algos/{algo_id}/versions/{version}',
            path: {
                'algo_id': algoId,
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
     * Freeze algorithm version
     * @param algoId
     * @param version
     * @returns AlgoVersion OK
     * @throws ApiError
     */
    public static postAdminAlgoVersionsFreeze(
        algoId: string,
        version: string,
    ): CancelablePromise<AlgoVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/algos/{algo_id}/versions/{version}/freeze',
            path: {
                'algo_id': algoId,
                'version': version,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * List templates
     * @param page
     * @param pageSize
     * @param projectId
     * @param includeArchived
     * @returns Template OK
     * @throws ApiError
     */
    public static getTemplates(
        page: number = 1,
        pageSize: number = 50,
        projectId?: string,
        includeArchived?: boolean,
    ): CancelablePromise<Array<Template>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/templates',
            query: {
                'page': page,
                'pageSize': pageSize,
                'projectId': projectId,
                'includeArchived': includeArchived,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Create template under project
     * @param projectId
     * @param requestBody
     * @returns Template Created
     * @throws ApiError
     */
    public static postProjectsByProjectIdTemplates(
        projectId: string,
        requestBody: TemplateCreate,
    ): CancelablePromise<Template> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{project_id}/templates',
            path: {
                'project_id': projectId,
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
     * Get template by ID
     * @param templateId
     * @returns TemplateDetail OK
     * @throws ApiError
     */
    public static getTemplatesByTemplateId(
        templateId: string,
    ): CancelablePromise<TemplateDetail> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/templates/{template_id}',
            path: {
                'template_id': templateId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Update template
     * @param templateId
     * @param requestBody
     * @returns Template OK
     * @throws ApiError
     */
    public static patchTemplatesByTemplateId(
        templateId: string,
        requestBody: TemplateUpdate,
    ): CancelablePromise<Template> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/templates/{template_id}',
            path: {
                'template_id': templateId,
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
     * Archive template
     * @param templateId
     * @returns void
     * @throws ApiError
     */
    public static deleteTemplatesByTemplateId(
        templateId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/templates/{template_id}',
            path: {
                'template_id': templateId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Create template version
     * @param templateId
     * @param requestBody
     * @returns TemplateVersion Created
     * @throws ApiError
     */
    public static postTemplatesByTemplateIdVersions(
        templateId: string,
        requestBody: TemplateVersionCreate,
    ): CancelablePromise<TemplateVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/templates/{template_id}/versions',
            path: {
                'template_id': templateId,
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
     * Freeze template version
     * @param templateId
     * @param versionId
     * @returns TemplateVersion OK
     * @throws ApiError
     */
    public static postTemplateVersionsFreeze(
        templateId: string,
        versionId: string,
    ): CancelablePromise<TemplateVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/templates/{template_id}/versions/{version_id}/freeze',
            path: {
                'template_id': templateId,
                'version_id': versionId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
}
