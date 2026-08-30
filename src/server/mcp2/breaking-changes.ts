/**
 * MCP 2.0 (2026-07-28) — Breaking-change risk registry helpers.
 *
 * Spec ref: spec-delta.md §5 (the 6 breaking changes between 1.x and 2.0
 * the plan may have under-emphasized). Each entry pairs the spec/SDK
 * source of truth with the observable behavior our handlers and tests
 * rely on, so a regression (handler return type drift, leaked `_meta`
 * key, `inputResponses` collision, etc.) is caught by a unit test.
 *
 * The 6 breaking changes:
 *
 *   1. `resultType` on `Result`/named result types is GONE from public
 *      types. Wire layer still parses it; protocol layer consumes it
 *      before handlers see it. Handlers returning the wire shape
 *      directly will fail type checks.
 *
 *   2. Reserved envelope keys
 *      (`io.modelcontextprotocol/{protocolVersion,clientInfo,clientCapabilities,logLevel}`)
 *      are lifted out of `params._meta` before handlers run. Tool
 *      handlers must NOT inspect `_meta.io.modelcontextprotocol/...`
 *      directly on modern era — the SDK already lifted them.
 *
 *   3. Retry fields (`inputResponses`, `requestState`) lifted from
 *      top-level params. On requests only, they move to
 *      `ctx.mcpReq.inputResponses` / `ctx.mcpReq.requestState()`. 2025
 *      peers' custom-method requests that use `inputResponses` /
 *      `requestState` as ordinary top-level params will have them
 *      lifted out (still readable at `ctx.mcpReq.*`).
 *
 *   4. `CallToolResult.content` keeps the v1 default on legacy era only.
 *      On 2026-07-28 connections, `content` is required explicitly.
 *
 *   5. `MessageExtraInfo.classification` validated against instance era.
 *      Mismatch is rejected as `-32022 UnsupportedProtocolVersionError`.
 *
 *   6. Era-mismatched outbound spec method. `SdkError(
 *      MethodNotSupportedByProtocolVersion)` is thrown before reaching
 *      the transport when a server-side caller tries to send `tasks/*`
 *      from a 2026-era pinned connection, or `server/discover` toward a
 *      2025-era peer.
 *
 * The constants + predicates in this module are the canonical source
 * for the era-matrix + breaking-changes tests.
 */

/** The reserved envelope keys the SDK lifts out of `params._meta`. */
export const RESERVED_ENVELOPE_KEYS = Object.freeze([
  'io.modelcontextprotocol/protocolVersion',
  'io.modelcontextprotocol/clientInfo',
  'io.modelcontextprotocol/clientCapabilities',
  'io.modelcontextprotocol/logLevel',
] as const);

export type ReservedEnvelopeKey = (typeof RESERVED_ENVELOPE_KEYS)[number];

/** The retry fields the SDK lifts from top-level params to `ctx.mcpReq`. */
export const LIFTED_RETRY_FIELDS = Object.freeze(['inputResponses', 'requestState'] as const);

export type LiftedRetryField = (typeof LIFTED_RETRY_FIELDS)[number];

/** Predicate: is this `_meta` key reserved (lifted before handler runs)? */
export function isReservedEnvelopeKey(key: string): key is ReservedEnvelopeKey {
  return (RESERVED_ENVELOPE_KEYS as readonly string[]).includes(key);
}

/** Predicate: is this top-level params field a lifted retry field? */
export function isLiftedRetryField(field: string): field is LiftedRetryField {
  return (LIFTED_RETRY_FIELDS as readonly string[]).includes(field);
}

/**
 * Strip the reserved envelope keys from a `_meta` object the way the SDK
 * does on the modern era. Handlers observing `_meta` directly must see
 * the post-lift view (i.e. the reserved keys are absent).
 */
export function stripReservedEnvelopeKeys<T extends Record<string, unknown>>(meta: T): Partial<T> {
  const out: Record<string, unknown> = { ...meta };
  for (const key of RESERVED_ENVELOPE_KEYS) {
    delete out[key];
  }
  return out as Partial<T>;
}

/**
 * Predicate: does this wire `resultType` value pass the SDK's
 * legal-kind check? `'complete'` is consumed and stripped; `'input_required'`
 * is fulfilled by the client's auto-fulfilment driver; any other kind
 * rejects with `SdkError(UnsupportedResultType)`.
 */
export function isLegalResultType(kind: unknown): kind is 'complete' | 'input_required' {
  return kind === 'complete' || kind === 'input_required';
}

/**
 * Method names that are era-mismatched when sent over the wrong protocol
 * version. `SdkError(MethodNotSupportedByProtocolVersion)` is thrown
 * before reaching the transport in either direction.
 */
export const ERA_MISMATCHED_METHODS = Object.freeze({
  /** Sent on 2025-era outbound (toward a 2025 peer). */
  outboundFrom2025: ['server/discover', 'subscriptions/listen'] as const,
  /** Sent on 2026-era outbound (toward a 2026 peer) but not 2025. */
  outboundFrom2026: [
    'tasks/list',
    'tasks/result',
    'tasks/cancel',
    'tasks/get',
    'tasks/update',
  ] as const,
});

/** Era validation outcome for `MessageExtraInfo.classification` mismatches. */
export const ERA_MISMATCH_ERROR_CODE = -32022;
