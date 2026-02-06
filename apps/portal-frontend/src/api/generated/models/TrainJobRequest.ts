/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AutoEvalConfig } from './AutoEvalConfig';
import type { PluginRef } from './PluginRef';
import type { ResourceSpec } from './ResourceSpec';
import type { TrainJobAgent } from './TrainJobAgent';
import type { TrainJobAlgo } from './TrainJobAlgo';
import type { TrainJobEnv } from './TrainJobEnv';
import type { TrainJobTrain } from './TrainJobTrain';
export type TrainJobRequest = {
    projectId: string;
    templateVersionId: string;
    env: TrainJobEnv;
    algo: TrainJobAlgo;
    agent?: TrainJobAgent;
    train: TrainJobTrain;
    network?: Record<string, any>;
    resources: ResourceSpec;
    seedSet?: Array<number>;
    plugin?: PluginRef;
    autoEval?: AutoEvalConfig;
};

