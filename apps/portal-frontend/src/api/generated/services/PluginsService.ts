/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Plugin } from '../models/Plugin';
import type { PluginUpdate } from '../models/PluginUpdate';
import type { PluginVersion } from '../models/PluginVersion';
import type { PluginVersionCreate } from '../models/PluginVersionCreate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PluginsService {
    /**
     * List plugins
     * @param page
     * @param pageSize
     * @param includeArchived
     * @returns Plugin OK
     * @throws ApiError
     */
    public static getPlugins(
        page: number = 1,
        pageSize: number = 50,
        includeArchived?: boolean,
    ): CancelablePromise<Array<Plugin>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/plugins',
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
     * Register plugin version
     * @param requestBody
     * @returns PluginVersion Created
     * @throws ApiError
     */
    public static postAdminPlugins(
        requestBody: PluginVersionCreate,
    ): CancelablePromise<PluginVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/plugins',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Update plugin metadata
     * @param pluginId
     * @param requestBody
     * @returns Plugin OK
     * @throws ApiError
     */
    public static patchAdminPlugins(
        pluginId: string,
        requestBody: PluginUpdate,
    ): CancelablePromise<Plugin> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/admin/plugins/{plugin_id}',
            path: {
                'plugin_id': pluginId,
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
     * Archive plugin
     * @param pluginId
     * @returns void
     * @throws ApiError
     */
    public static deleteAdminPlugins(
        pluginId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/admin/plugins/{plugin_id}',
            path: {
                'plugin_id': pluginId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * List plugin versions
     * @param pluginId
     * @returns PluginVersion OK
     * @throws ApiError
     */
    public static getPluginsByPluginIdVersions(
        pluginId: string,
    ): CancelablePromise<Array<PluginVersion>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/plugins/{plugin_id}/versions',
            path: {
                'plugin_id': pluginId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Freeze plugin version
     * @param pluginId
     * @param version
     * @returns PluginVersion OK
     * @throws ApiError
     */
    public static postAdminPluginVersionsFreeze(
        pluginId: string,
        version: string,
    ): CancelablePromise<PluginVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/plugins/{plugin_id}/versions/{version}/freeze',
            path: {
                'plugin_id': pluginId,
                'version': version,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
}
