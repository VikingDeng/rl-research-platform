/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EnvMapSet } from './EnvMapSet';
export type EnvVersionUpdate = {
    apiMode?: string;
    entrypoint?: string;
    package?: string;
    active?: boolean;
    frozen?: boolean;
    defaultImageDigest?: string;
    mapSets?: Array<EnvMapSet>;
    scenarioSchema?: Record<string, any>;
};

