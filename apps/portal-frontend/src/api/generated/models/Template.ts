/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TemplateType } from './TemplateType';
export type Template = {
    id: string;
    projectId: string;
    name: string;
    description?: string;
    type: TemplateType;
    defaultConfig: Record<string, any>;
    archived?: boolean;
};

