/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ExecutorSettings } from './ExecutorSettings';
import type { RetentionPolicy } from './RetentionPolicy';
import type { StorageUsage } from './StorageUsage';
export type SettingsResponse = {
    apiToken: string;
    executor: ExecutorSettings;
    storage: StorageUsage;
    retention: RetentionPolicy;
};

