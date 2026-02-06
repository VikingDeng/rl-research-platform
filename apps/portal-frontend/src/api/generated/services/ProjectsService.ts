/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Project } from '../models/Project';
import type { ProjectCreate } from '../models/ProjectCreate';
import type { ProjectUpdate } from '../models/ProjectUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ProjectsService {
    /**
     * List projects
     * @param page
     * @param pageSize
     * @returns Project OK
     * @throws ApiError
     */
    public static getProjects(
        page: number = 1,
        pageSize: number = 50,
    ): CancelablePromise<Array<Project>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects',
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
     * Create project
     * @param requestBody
     * @returns Project Created
     * @throws ApiError
     */
    public static postProjects(
        requestBody: ProjectCreate,
    ): CancelablePromise<Project> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Get project by ID
     * @param projectId
     * @returns Project OK
     * @throws ApiError
     */
    public static getProjectsByProjectId(
        projectId: string,
    ): CancelablePromise<Project> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{project_id}',
            path: {
                'project_id': projectId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Update project
     * @param projectId
     * @param requestBody
     * @returns Project OK
     * @throws ApiError
     */
    public static patchProjectsByProjectId(
        projectId: string,
        requestBody: ProjectUpdate,
    ): CancelablePromise<Project> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/projects/{project_id}',
            path: {
                'project_id': projectId,
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
     * Delete project
     * @param projectId
     * @returns void
     * @throws ApiError
     */
    public static deleteProjectsByProjectId(
        projectId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{project_id}',
            path: {
                'project_id': projectId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
}
