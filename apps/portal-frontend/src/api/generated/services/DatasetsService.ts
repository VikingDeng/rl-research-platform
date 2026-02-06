/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Dataset } from '../models/Dataset';
import type { DatasetCreate } from '../models/DatasetCreate';
import type { DatasetPreview } from '../models/DatasetPreview';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DatasetsService {
    /**
     * List datasets
     * @returns Dataset OK
     * @throws ApiError
     */
    public static getDatasets(): CancelablePromise<Array<Dataset>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/datasets',
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Register dataset by path
     * @param requestBody
     * @returns Dataset Created
     * @throws ApiError
     */
    public static postDatasets(
        requestBody: DatasetCreate,
    ): CancelablePromise<Dataset> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/datasets',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Upload dataset file
     * @param formData
     * @returns Dataset Created
     * @throws ApiError
     */
    public static postDatasetsUpload(
        formData: {
            name: string;
            description?: string;
            format?: string;
            file: Blob;
        },
    ): CancelablePromise<Dataset> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/datasets/upload',
            formData: formData,
            mediaType: 'multipart/form-data',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Download dataset
     * @param datasetId
     * @returns void
     * @throws ApiError
     */
    public static getDatasetsByDatasetIdDownload(
        datasetId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/datasets/{dataset_id}/download',
            path: {
                'dataset_id': datasetId,
            },
            errors: {
                302: `Redirect to download URL`,
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Preview dataset contents
     * @param datasetId
     * @returns DatasetPreview OK
     * @throws ApiError
     */
    public static getDatasetsByDatasetIdPreview(
        datasetId: string,
    ): CancelablePromise<DatasetPreview> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/datasets/{dataset_id}/preview',
            path: {
                'dataset_id': datasetId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
}
