/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EnvRef } from './EnvRef';
import type { OpponentPoolRef } from './OpponentPoolRef';
export type EvalProtocolVersionCreate = {
    version?: string;
    name?: string;
    env?: EnvRef;
    evalSeeds?: Array<number>;
    episodesPerMatch?: number;
    timeoutSec?: number;
    metrics?: Array<string>;
    opponentPoolRef?: OpponentPoolRef;
};

