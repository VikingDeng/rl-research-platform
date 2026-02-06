/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MatrixArtifacts } from './MatrixArtifacts';
import type { MatrixCell } from './MatrixCell';
import type { MatrixMeta } from './MatrixMeta';
import type { RankingEntry } from './RankingEntry';
export type MatrixResult = {
    id: string;
    protocolId?: string;
    poolId?: string;
    createdAt?: string;
    cells: Array<MatrixCell>;
    labels?: Array<string>;
    matrix?: Array<Array<number>>;
    meta?: MatrixMeta;
    ranking?: Array<RankingEntry>;
    artifacts?: MatrixArtifacts;
    summary?: Record<string, any>;
    exportUrl?: string;
};

