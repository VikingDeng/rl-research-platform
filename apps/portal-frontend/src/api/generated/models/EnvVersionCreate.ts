/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EnvMapSet } from './EnvMapSet';
export type EnvVersionCreate = {
    version: string;
    apiMode: string;
    /**
     * Python entrypoint in module:function format.
     */
    entrypoint: string;
    /**
     * Python package specifier to install (e.g. smac==1.0.0).
     */
    package?: string;
    active?: boolean;
    frozen?: boolean;
    defaultImageDigest?: string;
    mapSets?: Array<EnvMapSet>;
    scenarioSchema?: Record<string, any>;
};

