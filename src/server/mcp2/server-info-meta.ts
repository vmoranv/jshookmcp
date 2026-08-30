/**
 * MCP 2.0 (2026-07-28) — `serverInfo` lives in `_meta`, not the body.
 *
 * Spec ref: spec PR #3002 (referenced in ts.sdk support-2026-07-28 §"Server
 * identity") + spec changelog. The final 2026-07-28 spec moved `serverInfo`
 * out of the `DiscoverResult` body and into the response `_meta` under the
 * key `io.modelcontextprotocol/serverInfo`. The v2 SDK re-exports the key
 * as `SERVER_INFO_META_KEY`.
 *
 * Behavioral consequence (spec-delta.md §2.3 / §4.10 / §4.12): any v2-alpha
 * residue that reads `discover.serverInfo` returns `undefined` silently on
 * 2026-07-28 connections. The correct accessor is
 * `discover._meta[SERVER_INFO_META_KEY]`.
 *
 * This module centralizes the meta key string so the project can:
 *  - reference it from a single source of truth (no string-typo risk),
 *  - write assertions in `tests/server/mcp2/spec-deltas.test.ts` that lock
 *    the value to the v2 SDK re-export and pin the runtime placement,
 *  - detect drift if the SDK ever changes the key (the test will fail).
 */

/** The spec-mandated `_meta` key under which `serverInfo` rides. */
export const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

/**
 * The structural shape of the identity payload the SDK stamps into
 * `_meta[SERVER_INFO_META_KEY]`. Mirrors `Implementation` from
 * `@modelcontextprotocol/server`; declared locally so this module has no
 * SDK type dependency (the test asserts the SDK export matches).
 */
export interface ServerInfoIdentity {
  name: string;
  version: string;
  title?: string;
}

/**
 * Read `serverInfo` from a `DiscoverResult`-shaped object the right way:
 * the `_meta` placement is the only correct path on 2026-07-28.
 *
 * Returns `undefined` when the response is missing the meta field — this
 * is the observable behavior a v2-alpha `result.serverInfo` read produces
 * today, and the test in `spec-deltas.test.ts` pins both the silent-undefined
 * body read AND the correct meta read.
 */
export function readServerInfoFromDiscover(discover: {
  serverInfo?: unknown;
  _meta?: Record<string, unknown>;
}): ServerInfoIdentity | undefined {
  const fromMeta = discover._meta?.[SERVER_INFO_META_KEY];
  if (fromMeta && typeof fromMeta === 'object') {
    return fromMeta as ServerInfoIdentity;
  }
  // Body-path is dead on 2026-07-28. Kept here only so a v2-alpha caller
  // doing `discover.serverInfo` reads `undefined` and not a stale value.
  if (discover.serverInfo && typeof discover.serverInfo === 'object') {
    return discover.serverInfo as ServerInfoIdentity;
  }
  return undefined;
}
