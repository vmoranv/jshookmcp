/**
 * MCP 2.0 (2026-07-28) — Cache defaults & resolution semantics.
 *
 * Spec ref: ts.sdk support-2026-07-28 §"Cache fields and cache hints" +
 * spec changelog Minor #5 (SEP-2549).
 *
 * Plan delta (spec-delta.md §4.6 / §4.8): the SDK ships with the most
 * conservative defaults (`ttlMs: 0`, `cacheScope: 'private'`), and
 * `server/discover` is a `CacheableResult` endpoint on the 2026-07-28
 * revision (in addition to the four list endpoints + `resources/read`).
 *
 * Field resolution order (most-specific author first):
 *
 *   1. fields the handler returned on the result itself (when valid),
 *   2. a `cacheHint` attached by the server layer (per-registration hint,
 *      then the per-operation `ServerOptions.cacheHints`, combined per
 *      field via {@linkcode attachCacheHintFallback}),
 *   3. the conservative defaults `{ ttlMs: 0, cacheScope: 'private' }`.
 *
 * 2025-era responses are unaffected: the 2025-era wire codec has no cache
 * code path, so the hint symbol-keyed property travels untouched.
 *
 * The constants in this module are authoritative for the codebase; if the
 * SDK ever changes the default shape, update these and the matching tests
 * in `tests/server/mcp2/spec-deltas.test.ts` simultaneously.
 */

/**
 * The conservative defaults the SDK applies when a handler emits a result
 * without its own `ttlMs` / `cacheScope` and no per-operation hint is
 * configured.
 *
 * `ttlMs: 0` is "do not cache" (per the SEP-2549 convention). `cacheScope:
 * 'private'` prevents shared (CDN / proxy) caches from holding a result
 * that may be principal-specific.
 */
export const CACHE_HINT_DEFAULTS = Object.freeze({
  ttlMs: 0,
  cacheScope: 'private',
});

/**
 * The full list of operations whose results are cacheable on the 2026-07-28
 * revision. The list is closed: no other operation's result ever receives
 * cache fields from the SDK.
 *
 * Order matters for the `ServerOptions.cacheHints` lookup table — the
 * `CacheableResultMethod` is a string-literal union of these six members.
 */
export const CACHEABLE_RESULT_METHODS = Object.freeze([
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'server/discover',
] as const);

export type CacheableResultMethod = (typeof CACHEABLE_RESULT_METHODS)[number];

/** The wire-level cache scope vocabulary. */
export type CacheScope = 'public' | 'private';

/**
 * A per-operation or per-resource cache hint. Either field may be absent
 * — the SDK fills the absent one with {@linkcode CACHE_HINT_DEFAULTS}.
 */
export interface CacheHint {
  /** Cache lifetime in milliseconds (non-negative safe integer). */
  ttlMs?: number;
  /** `'public'` permits shared caches; `'private'` is per-client only. */
  cacheScope?: CacheScope;
}

/** A lookup of per-operation hints (keyed by `CacheableResultMethod`). */
export type CacheHintsTable = Partial<Record<CacheableResultMethod, CacheHint>>;

/**
 * Merge handler-supplied fields with the resolution chain.
 *
 * Precedence (per field):
 *   1. handler-supplied value (when valid / defined)
 *   2. per-resource hint (registered on `registerResource(...)`)
 *   3. per-operation hint (`ServerOptions.cacheHints[method]`)
 *   4. SDK defaults (`ttlMs: 0`, `cacheScope: 'private'`)
 *
 * This is a pure function; no SDK internals are touched. Callers attach
 * the returned value to the result via the SDK's symbol-keyed property
 * (`RESULT_CACHE_HINT_FALLBACK`) when wiring the modern HTTP entry.
 */
export function resolveCacheHint(
  method: CacheableResultMethod,
  handlerFields: CacheHint | undefined,
  perResourceHint: CacheHint | undefined,
  perOperationHints: CacheHintsTable | undefined,
): Required<CacheHint> {
  const opHint = perOperationHints?.[method];
  return {
    ttlMs:
      handlerFields?.ttlMs ?? perResourceHint?.ttlMs ?? opHint?.ttlMs ?? CACHE_HINT_DEFAULTS.ttlMs,
    cacheScope:
      handlerFields?.cacheScope ??
      perResourceHint?.cacheScope ??
      opHint?.cacheScope ??
      CACHE_HINT_DEFAULTS.cacheScope,
  };
}

/** Predicate: is this method a cacheable result endpoint on 2026-07-28? */
export function isCacheableResultMethod(method: string): method is CacheableResultMethod {
  return (CACHEABLE_RESULT_METHODS as readonly string[]).includes(method);
}
