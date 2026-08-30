/**
 * MCP 2.0 (2026-07-28) — spec-delta helpers barrel.
 *
 * This module re-exports the small, focused helpers that the modern
 * (`/mcp/v2`) entry, the ElicitationBridge refactor, and the era-matrix
 * tests all share. Each submodule is the canonical source for one
 * delta from `research/spec-delta.md`.
 *
 *  - `cache-defaults.ts`     — SDK cache defaults + cacheable methods
 *  - `server-info-meta.ts`   — `serverInfo` in `_meta` (spec PR #3002)
 *  - `notifier-shape.ts`     — `handler.notify.*` exact SDK shape
 *  - `input-requests.ts`     — `inputRequests` map: 3 methods / 4 kinds
 *  - `legacy-shim.ts`        — legacy shim host capabilities
 *  - `tasks-mcp-name.ts`     — SEP-2243 `Mcp-Name` for tasks endpoints
 *  - `error-codes.ts`        — error code renumbering scope
 *  - `breaking-changes.ts`   — 6 breaking-change risk registry
 */

export * from './cache-defaults';
export * from './server-info-meta';
export * from './notifier-shape';
export * from './input-requests';
export * from './legacy-shim';
export * from './tasks-mcp-name';
export * from './error-codes';
export * from './breaking-changes';
