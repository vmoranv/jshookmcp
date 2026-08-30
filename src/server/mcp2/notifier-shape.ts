/**
 * MCP 2.0 (2026-07-28) — `handler.notify.*` exact SDK shape.
 *
 * Spec ref: ts.sdk support-2026-07-28 §"subscriptions/listen" + spec
 * changelog Major #4 (`subscriptions/listen` replaces the 2025
 * `resources/subscribe` / `resources/unsubscribe` / HTTP GET endpoint).
 *
 * Plan delta (spec-delta.md §2.2): the exact SDK shape is
 *   `handler.notify.{toolsChanged, promptsChanged, resourcesChanged, resourceUpdated(uri)}`
 * published onto the handler's `ServerEventBus`. Stdio entries route the
 * `send*ListChanged()` instance methods automatically; only the HTTP
 * `createMcpHandler` entry needs the `.notify.*` sugar (because the
 * per-request factory has no shared instance to call methods on).
 *
 * This module codifies the shape so a regression in our wiring (a typo
 * like `toolsListChanged` or `notifyToolListChanged`) is caught by a unit
 * test, and so the modern HTTP entry can be wired through a single typed
 * proxy.
 *
 * The runtime SDK reference shape (verbatim, from
 * `@modelcontextprotocol/server` `createMcpHandler`):
 *
 *   interface ServerNotifier {
 *     toolsChanged(): void;
 *     promptsChanged(): void;
 *     resourcesChanged(): void;
 *     resourceUpdated(uri: string): void;
 *   }
 */

/** A typed publish-side facade over a `ServerEventBus`. */
export interface ServerNotifierShape {
  /** Publish `notifications/tools/list_changed`. */
  toolsChanged(): void;
  /** Publish `notifications/prompts/list_changed`. */
  promptsChanged(): void;
  /** Publish `notifications/resources/list_changed`. */
  resourcesChanged(): void;
  /** Publish `notifications/resources/updated` for `uri`. */
  resourceUpdated(uri: string): void;
}

/**
 * The four notification kinds the SDK knows about on the 2026-07-28 era.
 * Listed in the canonical SDK order so a test can assert exact ordering.
 */
export const SERVER_NOTIFIER_METHODS = Object.freeze([
  'toolsChanged',
  'promptsChanged',
  'resourcesChanged',
  'resourceUpdated',
] as const);

/**
 * Predicate: does this notifier implement the full SDK surface?
 *
 * Used by the modern HTTP entry to detect partial implementations (e.g.
 * a stub used in tests) and by the era-matrix tests to assert wiring.
 */
export function isServerNotifierShape(value: unknown): value is ServerNotifierShape {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ServerNotifierShape>;
  return (
    typeof candidate.toolsChanged === 'function' &&
    typeof candidate.promptsChanged === 'function' &&
    typeof candidate.resourcesChanged === 'function' &&
    typeof candidate.resourceUpdated === 'function'
  );
}
