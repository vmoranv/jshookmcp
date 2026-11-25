/**
 * ExtensionManager.hooks — plugin tool-execution interception hooks.
 *
 * Contract (declared in the extension SDK): a plugin may register
 * `ToolExecuteBeforeHook` / `ToolExecuteAfterHook` callbacks via
 * `onToolExecuteBefore()` / `onToolExecuteAfter()`. Hooks run ONLY for tools
 * the owning plugin declared in its own manifest (least privilege); global
 * interception of unrelated tools is deliberately left to a future opt-in
 * config switch.
 *
 * Fail-open policy: a hook that throws is logged and treated as if it returned
 * `undefined` ("allow", no rewrite). Only an explicit `deny` / `redact` result
 * intercepts execution. Trade-off: strictness is sacrificed for tool
 * availability — a buggy plugin hook must never take down a working tool.
 *
 * Chaining semantics: within one plugin, hooks run in registration order and
 * the args/result rewritten by one hook become the input of the next. Because
 * tool names are unique per plugin, a given tool execution runs exactly one
 * plugin's hook chain (its owner).
 */
import { logger } from '@utils/logger';
import type {
  ExtensionToolHandler,
  PluginLifecycleContext,
  ToolExecuteAfterHook,
  ToolExecuteAfterResult,
  ToolExecuteBeforeHook,
  ToolExecuteBeforeResult,
  ToolResponse,
} from '@server/plugins/PluginContract';

export type BeforeHookChainOutcome =
  | { action: 'allow'; args: unknown }
  | { action: 'deny'; reason: string };

export type AfterHookChainOutcome =
  | { action: 'allow'; result: unknown }
  | { action: 'redact'; reason: string };

/** Defensive read: plugins built against an older SDK carry no hook arrays. */
export function normalizeHookList<T>(hooks: readonly T[] | undefined): readonly T[] {
  return Array.isArray(hooks) ? hooks : [];
}

/**
 * Run a plugin's before-hooks in registration order, chaining rewrites.
 * `allow` without (non-`undefined`) `args` keeps the current args untouched.
 */
export async function applyToolExecuteBeforeHooks(
  pluginId: string,
  hooks: readonly ToolExecuteBeforeHook[],
  toolName: string,
  initialArgs: unknown,
): Promise<BeforeHookChainOutcome> {
  let args = initialArgs;
  for (const hook of hooks) {
    let decision: ToolExecuteBeforeResult | void;
    try {
      decision = await hook(toolName, args);
    } catch (error) {
      // Fail-open: only explicit decisions intercept; a broken hook must not
      // block tool availability.
      logger.warn(
        `[extension:${pluginId}] toolExecuteBefore hook for "${toolName}" threw and was ` +
          'ignored (fail-open):',
        error,
      );
      continue;
    }
    if (!decision) continue;
    if (decision.action === 'deny') {
      return { action: 'deny', reason: decision.reason };
    }
    if (decision.args !== undefined) {
      args = decision.args; // chain: the next hook sees the rewritten args
    }
  }
  return { action: 'allow', args };
}

/**
 * Run a plugin's after-hooks in registration order, chaining rewrites.
 * `allow` without (non-`undefined`) `result` keeps the current result untouched.
 */
export async function applyToolExecuteAfterHooks(
  pluginId: string,
  hooks: readonly ToolExecuteAfterHook[],
  toolName: string,
  args: unknown,
  initialResult: unknown,
): Promise<AfterHookChainOutcome> {
  let result = initialResult;
  for (const hook of hooks) {
    let decision: ToolExecuteAfterResult | void;
    try {
      decision = await hook(toolName, args, result);
    } catch (error) {
      // Fail-open: only explicit decisions intercept; a broken hook must not
      // block tool availability.
      logger.warn(
        `[extension:${pluginId}] toolExecuteAfter hook for "${toolName}" threw and was ` +
          'ignored (fail-open):',
        error,
      );
      continue;
    }
    if (!decision) continue;
    if (decision.action === 'redact') {
      return { action: 'redact', reason: decision.reason };
    }
    if (decision.result !== undefined) {
      result = decision.result; // chain: the next hook sees the rewritten result
    }
  }
  return { action: 'allow', result };
}

/** Error response for a hook `deny`: tool never executed. */
function buildHookDenyResponse(toolName: string, pluginId: string, reason: string): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: false,
          tool: toolName,
          error: `Tool "${toolName}" was denied by plugin "${pluginId}" before execution: ${reason}`,
          deniedBy: pluginId,
          reason,
        }),
      },
    ],
    isError: true,
  };
}

/** Placeholder response for a hook `redact`: the original result is discarded. */
function buildHookRedactResponse(toolName: string, pluginId: string, reason: string): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          tool: toolName,
          redacted: true,
          redactedBy: pluginId,
          reason,
          message: `Result of tool "${toolName}" was redacted by plugin "${pluginId}": ${reason}`,
        }),
      },
    ],
  };
}

export interface ExtensionToolHookOptions {
  pluginId: string;
  toolName: string;
  beforeHooks: readonly ToolExecuteBeforeHook[];
  afterHooks: readonly ToolExecuteAfterHook[];
  /** The plugin's own tool handler (already bound to its lifecycle context). */
  handler: ExtensionToolHandler;
}

/** Rewritten hook values must keep the shape the downstream consumer expects. */
function isToolArgs(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolResponse(value: unknown): value is ToolResponse {
  return isToolArgs(value) && Array.isArray(value['content']);
}

/**
 * Wrap a plugin tool handler with the plugin's before/after hook chain.
 *
 * Fast path: a plugin with no hooks gets its original handler back unchanged
 * (zero behavior / performance impact for existing plugins).
 */
export function wrapExtensionToolHandler(options: ExtensionToolHookOptions): ExtensionToolHandler {
  const { pluginId, toolName, beforeHooks, afterHooks, handler } = options;
  if (beforeHooks.length === 0 && afterHooks.length === 0) {
    return handler;
  }

  return async (
    args: Record<string, unknown>,
    ctx: PluginLifecycleContext,
  ): Promise<ToolResponse> => {
    const before = await applyToolExecuteBeforeHooks(pluginId, beforeHooks, toolName, args);
    if (before.action === 'deny') {
      return buildHookDenyResponse(toolName, pluginId, before.reason);
    }
    // Fail-open: an `allow` hook may rewrite args to a non-object. Keeping the
    // original args is safer than handing the handler an unusable value.
    let effectiveArgs = args;
    if (isToolArgs(before.args)) {
      effectiveArgs = before.args;
    } else if (before.args !== args) {
      logger.warn(
        `[extension:${pluginId}] toolExecuteBefore hook for "${toolName}" rewrote args to a ` +
          'non-object value; keeping the original args',
      );
    }
    // The tool (and only the tool) sees the possibly-rewritten args.
    const result = await handler(effectiveArgs, ctx);
    const after = await applyToolExecuteAfterHooks(
      pluginId,
      afterHooks,
      toolName,
      effectiveArgs,
      result,
    );
    if (after.action === 'redact') {
      return buildHookRedactResponse(toolName, pluginId, after.reason);
    }
    // Fail-open: a malformed rewrite must not surface a broken MCP response.
    if (after.result === result) {
      return result;
    } else if (isToolResponse(after.result)) {
      return after.result;
    }
    logger.warn(
      `[extension:${pluginId}] toolExecuteAfter hook for "${toolName}" rewrote the result to an ` +
        'invalid tool response; keeping the original result',
    );
    return result;
  };
}
