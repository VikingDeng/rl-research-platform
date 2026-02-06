/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ArtifactFile = {
    id: string;
    name: string;
    path: string;
    size?: string;
    type: ArtifactFile.type;
    lastModified: string;
    createdAt?: string;
    objectKey?: string;
};
export namespace ArtifactFile {
    export enum type {
        FILE = 'file',
        FOLDER = 'folder',
    }
}

