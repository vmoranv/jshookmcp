/**
 * MCP 2.0 (2026-07-28) — spec-delta helpers barrel.
 *
 * STATUS: WIRED. The spec-pinned constants + predicates are consumed at
 * runtime from `src/`:
 *  - `MCPServer.tools.ts` maps NOT_FOUND via `ERROR_CODE_RESOURCE_NOT_FOUND`.
 *  - `MCPServer.transport.ts` runs `contract.assertMcp2Contract()` once when
 *    the modern `/mcp/v2` handler is built, comparing the pins against the
 *    installed SDK and self-checking every predicate.
 * The era-matrix tests (`tests/server/mcp2/`) remain the value pins; the
 * runtime guard turns a silent SDK renumber into a startup warning.
 *
 *  - `cache-defaults.ts`     — SDK cache defaults + cacheable methods
 *  - `server-info-meta.ts`   — `serverInfo` in `_meta` (spec PR #3002)
 *  - `notifier-shape.ts`     — `handler.notify.*` exact SDK shape
 *  - `input-requests.ts`     — `inputRequests` map: 3 methods / 4 kinds
 *  - `legacy-shim.ts`        — legacy shim host capabilities
 *  - `tasks-mcp-name.ts`     — SEP-2243 `Mcp-Name` for tasks endpoints
 *  - `error-codes.ts`        — error code renumbering scope
 *  - `breaking-changes.ts`   — 6 breaking-change risk registry
 *  - `contract.ts`           — runtime spec/SDK drift guard (modern entry)
 */

export * from './cache-defaults';
export * from './server-info-meta';
export * from './notifier-shape';
export * from './input-requests';
export * from './legacy-shim';
export * from './tasks-mcp-name';
export * from './error-codes';
export * from './breaking-changes';
export * from './contract';
