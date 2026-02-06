/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RetentionApplyResponse } from '../models/RetentionApplyResponse';
import type { SettingsResponse } from '../models/SettingsResponse';
import type { SettingsUpdate } from '../models/SettingsUpdate';
import type { TokenRotateResponse } from '../models/TokenRotateResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SettingsService {
    /**
     * Get system settings summary
     * @returns SettingsResponse OK
     * @throws ApiError
     */
    public static getSettings(): CancelablePromise<SettingsResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/settings',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Update settings
     * @param requestBody
     * @returns SettingsResponse OK
     * @throws ApiError
     */
    public static patchSettings(
        requestBody: SettingsUpdate,
    ): CancelablePromise<SettingsResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/settings',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Rotate API token
     * @returns TokenRotateResponse OK
     * @throws ApiError
     */
    public static postSettingsTokenRotate(): CancelablePromise<TokenRotateResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/settings/token/rotate',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Apply checkpoint retention policy to all runs
     * @returns RetentionApplyResponse OK
     * @throws ApiError
     */
    public static postSettingsRetentionApply(): CancelablePromise<RetentionApplyResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/settings/retention/apply',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
}
