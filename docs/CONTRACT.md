# API Contract Change Process

This repository treats `docs/openapi_v1.yaml` as the **single source of truth** for the portal API. Backend and frontend work must align to this contract for M0/M1/M2 milestones.

## Principles
- **OpenAPI first**: any change to API shape, path, or behavior starts with `docs/openapi_v1.yaml`.
- **Generated client is read-only**: `apps/portal-frontend/src/api/generated/` is derived from the OpenAPI file.
- **No silent drift**: backend implementation and frontend call layer must stay in sync with the contract.

## Naming conventions
- JSON fields use `camelCase` as defined in `docs/openapi_v1.yaml`.
- Path params remain stable (e.g., `/projects/{project_id}`) but payload field names follow the OpenAPI schema.

## Change workflow
1. **Propose** the change (issue/PR) and update `docs/openapi_v1.yaml`.
2. **Validate** the OpenAPI file (see commands below).
3. **Regenerate** frontend client/types.
4. **Update** backend handlers and tests to match the new contract.
5. **Update** frontend call layer (adapters/services) if needed. Do not change page logic unless explicitly required.
6. **Review** for breaking changes and add migration notes if needed.

## Breaking change policy
- Prefer backward-compatible additions (new optional fields, new endpoints).
- If breaking changes are unavoidable, bump API version and provide migration steps.

## Commands
- OpenAPI validation (example):
  - `npx @redocly/cli lint docs/openapi_v1.yaml`
- Frontend client/types generation (example):
  - `npx openapi-typescript docs/openapi_v1.yaml -o apps/portal-frontend/src/api/generated/types.ts`
  - `npx openapi-typescript-codegen --input docs/openapi_v1.yaml --output apps/portal-frontend/src/api/generated --client fetch`

## Notes
- `docs/API_SPEC_RL_PLATFORM.md` is historical context. The authoritative contract is `docs/openapi_v1.yaml`.
- If a UI expects a different shape, add a call-layer adapter instead of changing page components.
