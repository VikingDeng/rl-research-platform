/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ResourceSpec } from './ResourceSpec';
export type MatrixJobRequest = {
    poolId?: string;
    policySnapshotIds: Array<string>;
    protocolId: string;
    gamesPerPair?: number;
    metric?: string;
    resources?: ResourceSpec;
};

