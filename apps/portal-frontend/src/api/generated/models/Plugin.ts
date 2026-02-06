/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PluginType } from './PluginType';
export type Plugin = {
    id: string;
    name: string;
    version: string;
    type: PluginType;
    description?: string;
    author?: string;
    installed?: boolean;
    archived?: boolean;
};

