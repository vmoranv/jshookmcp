/**
 * MCP 2.0 (2026-07-28) — Legacy shim host capabilities.
 *
 * Spec ref: ts.sdk support-2026-07-28 §"Legacy shim for input_required".
 *
 * Plan delta (spec-delta.md §2.4): the legacy shim for `input_required`
 * (so a 2025-era client receives a usable flow on the 2026-07-28 server)
 * only fully functions on transports that can deliver server→client
 * requests mid-call. The runtime answer is narrower than the original
 * plan text suggested:
 *
 *   - **stdio (`serveStdio`)** — full shim. The shim sends real
 *     `sampling/createMessage` / `elicitation/create` requests over the
 *     in-process JSON-RPC channel and re-enters the handler with the
 *     response. Default-on. Knobs: `maxRounds: 8`, `roundTimeoutMs:
 *     600_000`, `legacyShim: true`.
 *   - **sessionful streaming HTTP** — full shim. The shim uses the open
 *     SSE / streamable HTTP response to deliver server→client requests
 *     and awaits the response on the same stream.
 *   - **`enableJsonResponse: true` legacy mode** — degraded. The shim
 *     can only emit a single terminal body, so any server→client request
 *     leg waits out the full `roundTimeoutMs` before failing per family.
 *   - **stateless legacy HTTP** — degraded. No persistent channel to
 *     deliver the request over, so the same per-family timeout applies.
 *
 * Practical consequence for this project: keep stdio as the primary
 * channel for human-in-the-loop flows (captcha + sampling), and route
 * any modern HTTP path through `createMcpHandler` (no shim needed on the
 * modern era — the client fulfils the embedded request directly).
 *
 * The constants here are the canonical source for the era-matrix test
 * that asserts "stdio + sessionful streaming HTTP are the only fully
 * functional shim hosts".
 */

/** Default shim knobs the SDK ships with. */
export const LEGACY_SHIM_DEFAULTS = Object.freeze({
  /** Handler re-entries per originating request before the shim fails. */
  maxRounds: 8,
  /** Per-leg timeout for the shim's embedded server→client requests. */
  roundTimeoutMs: 600_000,
  /** Whether the shim is on at all (set to `false` for pre-shim loud-fail). */
  legacyShim: true,
});

/** The transports on which the legacy shim is fully functional. */
export const LEGACY_SHIM_FULL_HOSTS = Object.freeze([
  'stdio',
  'sessionful_streaming_http',
] as const);

export type LegacyShimFullHost = (typeof LEGACY_SHIM_FULL_HOSTS)[number];

/** The transports on which the legacy shim is degraded to per-family timeout. */
export const LEGACY_SHIM_DEGRADED_HOSTS = Object.freeze([
  'stateless_legacy_http',
  'enable_json_response_legacy',
] as const);

export type LegacyShimDegradedHost = (typeof LEGACY_SHIM_DEGRADED_HOSTS)[number];

export type LegacyShimHost = LegacyShimFullHost | LegacyShimDegradedHost;

/** Predicate: is this host fully functional for the legacy shim? */
export function isLegacyShimFullHost(host: string): host is LegacyShimFullHost {
  return (LEGACY_SHIM_FULL_HOSTS as readonly string[]).includes(host);
}

/** Predicate: is this host degraded for the legacy shim? */
export function isLegacyShimDegradedHost(host: string): host is LegacyShimDegradedHost {
  return (LEGACY_SHIM_DEGRADED_HOSTS as readonly string[]).includes(host);
}
