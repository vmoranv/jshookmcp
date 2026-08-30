/**
 * MCP 2.0 (2026-07-28) — `inputRequests` map carries three request kinds.
 *
 * Spec ref: spec §MRTR (https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)
 * + ts.sdk support-2026-07-28 §"Multi-round-trip requests".
 *
 * Plan delta (spec-delta.md §2.5): the embedded `inputRequests` map can
 * carry any of `ElicitRequest`, `CreateMessageRequest`, or
 * `ListRootsRequest` — all three are first-class. The discriminator is
 * the request's `method` field:
 *
 *   - `elicitation/create`  → elicit
 *   - `sampling/createMessage` → sampling
 *   - `roots/list`            → roots
 *
 * The response shape's `kind` is one of `'elicit' | 'sampling' | 'roots'
 * | 'missing'`. Earlier plan wording ("sampling 类 inputRequest") was
 * under-specified; this module pins the full three-way union.
 *
 * The runtime SDK types (`InputRequest`, `InputResponseView`) cover this
 * already; this module exists so the project has a local, type-safe
 * surface that the era-matrix tests and ElicitationBridge refactor can
 * rely on without re-deriving the discriminator each time.
 */

/** The three request methods allowed inside `inputRequests` entries. */
export const INPUT_REQUEST_METHODS = Object.freeze([
  'elicitation/create',
  'sampling/createMessage',
  'roots/list',
] as const);

export type InputRequestMethod = (typeof INPUT_REQUEST_METHODS)[number];

/** The four response-kind discriminators the SDK can return. */
export const INPUT_RESPONSE_KINDS = Object.freeze([
  'elicit',
  'sampling',
  'roots',
  'missing',
] as const);

export type InputResponseKind = (typeof INPUT_RESPONSE_KINDS)[number];

/**
 * Map an embedded request `method` string to its response `kind`.
 *
 * `null` is returned when the method is not one of the three
 * `inputRequests` methods — useful for asserting that a handler does
 * not leak a different request kind into the map.
 */
export function inputRequestMethodToResponseKind(method: string): InputResponseKind | null {
  switch (method) {
    case 'elicitation/create':
      return 'elicit';
    case 'sampling/createMessage':
      return 'sampling';
    case 'roots/list':
      return 'roots';
    default:
      return null;
  }
}

/** Predicate: is this method one of the three legal `inputRequests` methods? */
export function isInputRequestMethod(method: string): method is InputRequestMethod {
  return (INPUT_REQUEST_METHODS as readonly string[]).includes(method);
}

/** Predicate: is this `kind` one of the four legal response discriminators? */
export function isInputResponseKind(kind: string): kind is InputResponseKind {
  return (INPUT_RESPONSE_KINDS as readonly string[]).includes(kind);
}
