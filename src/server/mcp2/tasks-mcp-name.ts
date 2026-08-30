/**
 * MCP 2.0 (2026-07-28) — SEP-2243 `Mcp-Name` for tasks endpoints.
 *
 * Spec ref: ts.sdk support-2026-07-28 §"Mcp-Param-*" (per-method note) +
 * SEP-2243 (the standard-header scheme) + SEP-2663 (Tasks extension's
 * Streamable HTTP binding).
 *
 * Plan delta (spec-delta.md §4.7): the `Mcp-Name` header is required for
 * any method that mirrors `params.name` / `params.uri`, AND additionally
 * for `tasks/get` / `tasks/update` / `tasks/cancel` — those mirror
 * `params.taskId` per the Tasks extension's Streamable HTTP binding.
 *
 * This module enumerates the exact set of methods that require
 * `Mcp-Name` and provides a small helper that the modern HTTP entry
 * uses to validate the header presence on inbound requests. Polling
 * (the default mode) and `notifications/tasks` push (an optimization
 * that requires a `subscriptions/listen` opt-in with a `tasks` filter)
 * are also captured here for documentation and test pinning.
 */

/** The four methods that mirror a `params.taskId` on the wire. */
export const TASKS_TASKID_MIRROR_METHODS = Object.freeze([
  'tasks/get',
  'tasks/update',
  'tasks/cancel',
  'tasks/result',
] as const);

export type TasksTaskIdMirrorMethod = (typeof TASKS_TASKID_MIRROR_METHODS)[number];

/** Standard methods (SEP-2243) that also mirror via `params.name` / `params.uri`. */
export const STANDARD_NAMED_MIRROR_METHODS = Object.freeze([
  'tools/call', // params.name
  'resources/read', // params.uri
  'prompts/get', // params.name
] as const);

/** All methods that REQUIRE the `Mcp-Name` header on Streamable HTTP. */
export const MCP_NAME_REQUIRED_METHODS = Object.freeze([
  ...STANDARD_NAMED_MIRROR_METHODS,
  ...TASKS_TASKID_MIRROR_METHODS,
] as const);

export type McpNameRequiredMethod = (typeof MCP_NAME_REQUIRED_METHODS)[number];

/** The method the server uses to push `tasks` status updates. */
export const TASKS_PUSH_NOTIFICATION_METHOD = 'notifications/tasks';

/** The subscription filter kind that opts into `notifications/tasks` push. */
export const TASKS_PUSH_SUBSCRIPTION_FILTER = 'tasks';

/**
 * Predicate: does this method require the `Mcp-Name` header on Streamable
 * HTTP? The 2026-07-28 spec mandates presence for any method that
 * mirrors a `name` / `uri` / `taskId` parameter into the standard
 * header set.
 */
export function requiresMcpNameHeader(method: string): method is McpNameRequiredMethod {
  return (MCP_NAME_REQUIRED_METHODS as readonly string[]).includes(method);
}

/**
 * Extract the mirrored header value from a request's `params`.
 *
 * For most methods the mirrored value is `params.name` or `params.uri`;
 * for the tasks endpoints it is `params.taskId`. The return value is
 * what the client must send in the `Mcp-Name` header.
 */
export function mirrorParamToMcpName(method: string, params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const p = params as Record<string, unknown>;
  if (requiresMcpNameHeader(method)) {
    if ((TASKS_TASKID_MIRROR_METHODS as readonly string[]).includes(method)) {
      return typeof p.taskId === 'string' ? p.taskId : undefined;
    }
    if (typeof p.name === 'string') return p.name;
    if (typeof p.uri === 'string') return p.uri;
  }
  return undefined;
}
