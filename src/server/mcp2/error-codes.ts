/**
 * MCP 2.0 (2026-07-28) — Error code renumbering scope.
 *
 * Spec ref: ts.sdk migration guide ("no v1.x impact — these codes never
 * existed in v1") + spec-delta.md §2.1.
 *
 * The v1→v2 codemod does NOT change error codes: it only rewrites import
 * paths (`ErrorCode` → `ProtocolErrorCode` is the only error-related
 * touch). The renumbering of `-32001` → `-32020`, `-32003` → `-32021`,
 * `-32004` → `-32022` is a v2-alpha → v2.0 INTERNAL transition, not a
 * v1 codemod concern.
 *
 * The new codes (canonical from `@modelcontextprotocol/server`):
 *
 *   - `-32020` (renumbered from v2-alpha `-32001`) — server-side
 *     capability mismatch (post-dispatch `MissingRequiredClientCapability`).
 *   - `-32021` (renumbered from v2-alpha `-32003`) — same as above,
 *     emitted when the embedded request's required capability was not
 *     declared on the request envelope. Surfaces as HTTP `400`.
 *   - `-32022` (renumbered from v2-alpha `-32004`) — `UnsupportedProtocolVersion`.
 *
 * The HTTP-status mapping for the new codes (2026-07-28 spec MUST):
 *
 *   - `-32021` produced AFTER dispatch (input_required gate)  → HTTP 400
 *   - `-32022`                                                  → HTTP 400
 *   - `-32602` (Invalid Params)                                 → HTTP 400
 *   - All other JSON-RPC errors                                 → HTTP 200
 *     (delivered in-band as `ProtocolError`)
 *
 * The constants here pin the codes + HTTP mapping; the era-matrix test
 * asserts both the numeric values and the HTTP status mapping.
 */

/** New `MissingRequiredClientCapability` (post-dispatch) — HTTP 400. */
export const ERROR_CODE_MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;

/** New `UnsupportedProtocolVersion` — HTTP 400. */
export const ERROR_CODE_UNSUPPORTED_PROTOCOL_VERSION = -32022;

/** Legacy `MissingRequiredClientCapability` (alpha-era renumber). */
export const ERROR_CODE_MISSING_CAPABILITY_V2_ALPHA = -32003;

/** Legacy `UnsupportedProtocolVersion` (alpha-era renumber). */
export const ERROR_CODE_UNSUPPORTED_PROTOCOL_VERSION_V2_ALPHA = -32004;

/** `ResourceNotFound` (kept importable for backwards-compat reads). */
export const ERROR_CODE_RESOURCE_NOT_FOUND = -32002;

/** `UrlElicitationRequired` (legacy 2025-era; not emitted on 2026-07-28). */
export const ERROR_CODE_URL_ELICITATION_REQUIRED = -32042;

/**
 * Map a 2026-07-28 protocol error code to the HTTP status the spec
 * mandates when surfacing the error over Streamable HTTP.
 *
 * Codes not listed here surface in-band on HTTP 200 as a `ProtocolError`
 * (the body is the JSON-RPC error response, the status is 200).
 */
export function httpStatusForErrorCode(code: number): 200 | 400 {
  switch (code) {
    case ERROR_CODE_MISSING_REQUIRED_CLIENT_CAPABILITY:
    case ERROR_CODE_UNSUPPORTED_PROTOCOL_VERSION:
    case -32602: // InvalidParamsError
    case ERROR_CODE_RESOURCE_NOT_FOUND:
      return 400;
    default:
      return 200;
  }
}
