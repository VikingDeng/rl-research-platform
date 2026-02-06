/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ArtifactDownloadResponse } from '../models/ArtifactDownloadResponse';
import type { ArtifactFile } from '../models/ArtifactFile';
import type { ReproBundleResponse } from '../models/ReproBundleResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ArtifactsService {
    /**
     * List run artifacts
     * @param runId
     * @returns ArtifactFile OK
     * @throws ApiError
     */
    public static getRunsByRunIdArtifacts(
        runId: string,
    ): CancelablePromise<Array<ArtifactFile>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/{run_id}/artifacts',
            path: {
                'run_id': runId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Download all run artifacts as a zip archive
     * @param runId
     * @returns binary OK
     * @throws ApiError
     */
    public static getRunsByRunIdArtifactsArchive(
        runId: string,
    ): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/{run_id}/artifacts/archive',
            path: {
                'run_id': runId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Get artifact download URL
     * @param artifactId
     * @returns ArtifactDownloadResponse OK
     * @throws ApiError
     */
    public static getArtifactsByArtifactIdDownloadUrl(
        artifactId: string,
    ): CancelablePromise<ArtifactDownloadResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/artifacts/{artifact_id}/download_url',
            path: {
                'artifact_id': artifactId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Get reproducibility bundle
     * @param runId
     * @returns ReproBundleResponse OK
     * @throws ApiError
     */
    public static getRunsByRunIdReproBundle(
        runId: string,
    ): CancelablePromise<ReproBundleResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/{run_id}/repro-bundle',
            path: {
                'run_id': runId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
}
