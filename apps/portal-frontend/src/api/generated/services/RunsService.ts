/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Checkpoint } from '../models/Checkpoint';
import type { CheckpointTagRequest } from '../models/CheckpointTagRequest';
import type { Job } from '../models/Job';
import type { JobStatus } from '../models/JobStatus';
import type { Run } from '../models/Run';
import type { RunExportTemplateRequest } from '../models/RunExportTemplateRequest';
import type { RunGroupSummary } from '../models/RunGroupSummary';
import type { RunType } from '../models/RunType';
import type { TemplateVersion } from '../models/TemplateVersion';
import type { TrainJobRequest } from '../models/TrainJobRequest';
import type { TrainJobResponse } from '../models/TrainJobResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class RunsService {
    /**
     * Submit training job
     * @param requestBody
     * @returns TrainJobResponse Created
     * @throws ApiError
     */
    public static postTrainJobs(
        requestBody: TrainJobRequest,
    ): CancelablePromise<TrainJobResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/train-jobs',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Bad request`,
                401: `Unauthorized`,
            },
        });
    }
    /**
     * List runs
     * @param page
     * @param pageSize
     * @param projectId
     * @param type
     * @param status
     * @returns Run OK
     * @throws ApiError
     */
    public static getRuns(
        page: number = 1,
        pageSize: number = 50,
        projectId?: string,
        type?: RunType,
        status?: JobStatus,
    ): CancelablePromise<Array<Run>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs',
            query: {
                'page': page,
                'pageSize': pageSize,
                'projectId': projectId,
                'type': type,
                'status': status,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Get run by ID
     * @param runId
     * @returns Run OK
     * @throws ApiError
     */
    public static getRunsByRunId(
        runId: string,
    ): CancelablePromise<Run> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/{run_id}',
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
     * Export run config to template version
     * @param runId
     * @param requestBody
     * @returns TemplateVersion Created
     * @throws ApiError
     */
    public static postRunsByRunIdExportTemplate(
        runId: string,
        requestBody: RunExportTemplateRequest,
    ): CancelablePromise<TemplateVersion> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/runs/{run_id}/export-template',
            path: {
                'run_id': runId,
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
     * Get run group summary
     * @param groupId
     * @returns RunGroupSummary OK
     * @throws ApiError
     */
    public static getRunsByGroupId(
        groupId: string,
    ): CancelablePromise<RunGroupSummary> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/groups/{group_id}',
            path: {
                'group_id': groupId,
            },
            errors: {
                401: `Unauthorized`,
                404: `Not found`,
            },
        });
    }
    /**
     * Get job for run
     * @param runId
     * @returns Job OK
     * @throws ApiError
     */
    public static getRunsByRunIdJob(
        runId: string,
    ): CancelablePromise<Job> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/{run_id}/job',
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
     * List run checkpoints
     * @param runId
     * @returns Checkpoint OK
     * @throws ApiError
     */
    public static getRunsByRunIdCheckpoints(
        runId: string,
    ): CancelablePromise<Array<Checkpoint>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/runs/{run_id}/checkpoints',
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
     * Tag a checkpoint
     * @param runId
     * @param ckptId
     * @param requestBody
     * @returns Checkpoint OK
     * @throws ApiError
     */
    public static postRunsByRunIdCheckpointsByCkptIdTag(
        runId: string,
        ckptId: string,
        requestBody: CheckpointTagRequest,
    ): CancelablePromise<Checkpoint> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/runs/{run_id}/checkpoints/{ckpt_id}/tag',
            path: {
                'run_id': runId,
                'ckpt_id': ckptId,
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
}
