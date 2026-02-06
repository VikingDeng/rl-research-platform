/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Webhook } from '../models/Webhook';
import type { WebhookCreate } from '../models/WebhookCreate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class WebhooksService {
    /**
     * Create webhook subscription
     * @param requestBody
     * @returns Webhook Created
     * @throws ApiError
     */
    public static postAdminWebhooks(
        requestBody: WebhookCreate,
    ): CancelablePromise<Webhook> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/admin/webhooks',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
}
