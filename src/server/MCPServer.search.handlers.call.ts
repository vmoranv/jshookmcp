/**
 * Handler for the call_tool proxy meta-tool.
 *
 * Bridges the gap for MCP clients that do not support `tools/list_changed`
 * notifications. After activate_tools / activate_domain registers a tool
 * server-side, such clients still cannot see it in their cached tool list.
 * call_tool lets them invoke any catalogued tool by name + args, with
 * automatic on-demand activation when the tool is not yet registered.
 *
 * Meta-tools themselves (search_tools, activate_tools, coverage_report, ...)
 * are top-level tools that live in neither the router nor the search catalog;
 * call_tool dispatches them directly to their registered handlers.
 */
import { logger } from '@utils/logger';
import { asTextResponse, asErrorResponse } from '@server/domains/shared/response';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { normalizeToolName } from '@server/MCPServer.search.validation';
import { getRuntimeState } from '@server/runtime/ServerRuntimeState';
import { getToolInputSchema } from '@server/ToolRouter.probe';
import { loadSearchCatalog } from '@server/registry/SearchCatalog';
import { validateToolArgsAgainstSchema } from '@server/MCPServer.search.validation.runtime';

/** Structural mirror of the meta-tool handler type exported by MCPServer.search. */
type MetaToolDispatchHandler = (
  ctx: MCPServerContext,
  args: Record<string, unknown>,
) => Promise<ToolResponse>;

interface CallToolMetadata {
  wasAutoActivated?: boolean;
  activatedTools?: string[];
}

function buildCallToolMetadata(
  wasAutoActivated: boolean,
  activatedTools: string[],
): CallToolMetadata {
  return {
    wasAutoActivated,
    activatedTools,
  };
}

function attachCallToolMetadata(response: ToolResponse, metadata: CallToolMetadata): ToolResponse {
  if (!response?.content || !Array.isArray(response.content)) {
    return response;
  }
  return {
    ...response,
    content: response.content.map((item) => {
      if (item.type !== 'text' || !('text' in item) || typeof item.text !== 'string') {
        return item;
      }

      try {
        const parsed = JSON.parse(item.text) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return item;
        }

        return {
          ...item,
          text: JSON.stringify(
            {
              ...(parsed as Record<string, unknown>),
              ...metadata,
            },
            null,
            2,
          ),
        };
      } catch {
        return item;
      }
    }),
  };
}

/**
 * Dispatch a meta-tool through its registered handler, mirroring the top-level
 * registration wrapper in registerSearchMetaTools (record the call; wrap
 * handler throws in asErrorResponse so failures match direct invocation).
 */
async function dispatchMetaTool(
  ctx: MCPServerContext,
  name: string,
  toolArgs: Record<string, unknown>,
  callMetadata: CallToolMetadata,
  getMetaToolHandler: (handlerName: string) => MetaToolDispatchHandler | undefined,
): Promise<ToolResponse> {
  if (name === 'call_tool') {
    // Self-reference would recurse infinitely — call_tool must be invoked
    // directly as a top-level tool instead. Rejected before gating: the
    // top-level registration wrapper already evaluated call_tool's rules,
    // and a self-reference must never dispatch (or double-gate).
    return asTextResponse(
      JSON.stringify({
        success: false,
        error:
          'Tool "call_tool" cannot be invoked through call_tool itself. Call it directly as a top-level tool.',
        ...callMetadata,
      }),
    );
  }

  // Gate the dispatched meta tool under its own name before dispatch — the
  // call_tool proxy path must not bypass the toolExecution rules or the
  // doom-loop breaker (dynamic import keeps the graph acyclic; see
  // registerSearchMetaTools for the ToolCallContextGuard cycle).
  const { runToolExecutionGate } = await import('@server/ToolCallContextGuard');
  const gateResponse = runToolExecutionGate(ctx, name, toolArgs);
  if (gateResponse) {
    return attachCallToolMetadata(gateResponse, callMetadata);
  }

  const handler = getMetaToolHandler(name);
  if (!handler) {
    // Defensive only: META_TOOL_NAMES and the handler registry share one source.
    return asTextResponse(
      JSON.stringify({
        success: false,
        error: `Tool "${name}" is a meta tool but no handler is registered for it.`,
        ...callMetadata,
      }),
    );
  }

  try {
    const response = await handler(ctx, toolArgs);
    // Mirror the top-level wrapper so coverage_report sees call_tool-routed
    // meta calls too.
    getRuntimeState(ctx)?.recordToolCall(name, toolArgs);
    return attachCallToolMetadata(response, callMetadata);
  } catch (error) {
    // Match the direct-call failure path instead of call_tool's own JSON error.
    logger.error(`call_tool: meta tool "${name}" failed`, error);
    return asErrorResponse(error);
  }
}

/**
 * Accept three argument formats, plus a flat spread:
 * 1. { args: { ... } }        — schema-defined name
 * 2. { parameters: "{...}" }  — JSON-serialized string (some MCP clients)
 * 3. { arguments: "{...}" }   — MCP clients that stringify the wrapper
 * 4. { url: ..., method: ... } — spread flat (params are top-level keys)
 *
 * The arguments wrapper is never silently dropped: the client sent it
 * explicitly, so an unusable value is reported instead of invoking the tool
 * with empty arguments.
 */
/** A plain object argument wrapper, or null when the value is not one. */
function asArgsObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The `parameters` wrapper accepts an object or a JSON string, never an error. */
function parseParametersWrapper(value: unknown): Record<string, unknown> {
  const asObject = asArgsObject(value);
  if (asObject) return asObject;
  if (typeof value !== 'string' || value.trim().length === 0) return {};
  try {
    const parsed = asArgsObject(JSON.parse(value));
    return parsed ?? {};
  } catch {
    /* malformed parameters JSON — treated as no arguments */
    return {};
  }
}

/**
 * The `arguments` wrapper is never silently dropped: the client sent it
 * explicitly, so an unusable value is reported instead of calling the tool
 * with empty arguments.
 */
function parseArgumentsWrapper(value: unknown): {
  toolArgs: Record<string, unknown>;
  wrapperError: string | null;
} {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      return { toolArgs: {}, wrapperError: 'arguments must be a non-empty JSON string' };
    }
    try {
      const parsed = asArgsObject(JSON.parse(value));
      return parsed
        ? { toolArgs: parsed, wrapperError: null }
        : { toolArgs: {}, wrapperError: 'arguments must decode to a JSON object' };
    } catch {
      return { toolArgs: {}, wrapperError: 'arguments must be valid JSON' };
    }
  }
  const asObject = asArgsObject(value);
  return asObject
    ? { toolArgs: asObject, wrapperError: null }
    : { toolArgs: {}, wrapperError: 'arguments must be a JSON object or a JSON string' };
}

function resolveCallToolArgs(args: Record<string, unknown>): {
  toolArgs: Record<string, unknown>;
  wrapperError: string | null;
} {
  let toolArgs: Record<string, unknown> = {};
  let wrapperError: string | null = null;

  const argsObject = asArgsObject(args.args);
  if (argsObject) {
    toolArgs = argsObject;
  } else if (args.parameters !== undefined) {
    toolArgs = parseParametersWrapper(args.parameters);
  } else if (args.arguments !== undefined) {
    ({ toolArgs, wrapperError } = parseArgumentsWrapper(args.arguments));
  }

  // Format 4 only applies when none of the three wrappers was provided.
  if (
    Object.keys(toolArgs).length === 0 &&
    !('args' in args) &&
    !('parameters' in args) &&
    !('arguments' in args)
  ) {
    for (const [k, v] of Object.entries(args)) {
      if (k !== 'name') {
        toolArgs[k] = v;
      }
    }
  }

  return { toolArgs, wrapperError };
}

/** Levenshtein distance with two rolling rows (no full matrix allocation). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length]!;
}

/** A candidate must be at least this similar (1 - normalized edit distance). */
const MIN_SUGGESTION_SIMILARITY = 0.6;

/** Length ratios beyond this cannot be a typo of each other — prune before the DP. */
const MAX_SUGGESTION_LENGTH_DELTA = 0.4;

/** Longest name we will score; beyond this the query is not a plausible typo. */
const MAX_SUGGESTION_NAME_LENGTH = 64;

/**
 * Near-miss candidates for a tool name that is absent from the catalog.
 *
 * A hallucinated or misspelled name is the most recoverable failure on this
 * path — the caller usually meant a real tool one edit away — so the error
 * should name candidates rather than only pointing at search_tools. The metric
 * is normalized edit distance, not token overlap: token overlap happily
 * "matches" two unrelated names that share a generic word (`test_tool` vs
 * `crypto_test_harness`), and a wrong "Did you mean" is its own misleading
 * error. Reading the catalog map the caller already holds means no
 * search-engine construction, because this runs on the error path.
 */
function suggestSimilarToolNames(name: string, candidates: Iterable<string>, limit = 3): string[] {
  const target = name.toLowerCase();
  if (target.length === 0 || target.length > MAX_SUGGESTION_NAME_LENGTH) return [];

  const scored: Array<{ name: string; similarity: number }> = [];
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const other = candidate.toLowerCase();
    const longest = Math.max(target.length, other.length);
    if (Math.abs(target.length - other.length) > longest * MAX_SUGGESTION_LENGTH_DELTA) continue;

    const similarity = 1 - editDistance(target, other) / longest;
    if (similarity < MIN_SUGGESTION_SIMILARITY) continue;
    scored.push({ name: candidate, similarity });
  }

  return scored
    .toSorted((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => entry.name);
}

/** Why auto-activation did (or did not) put the tool within reach. */
type AutoActivateOutcome =
  | { status: 'ok' }
  /** The name is absent from the search catalog — no such tool exists. */
  | { status: 'unknown-tool'; suggestions: string[] }
  /** The tool exists but activation did not land, and was not a budget skip. */
  | { status: 'not-activated' }
  /** Activation threw — the registry was unavailable or the handler failed. */
  | { status: 'activation-failed'; reason: string }
  /** The tool exists but the activation budget silently skipped it. */
  | { status: 'budget-exceeded'; hint: string };

/**
 * Turn an auto-activation outcome into an error the caller can act on.
 *
 * These used to collapse into a single message ("is not currently active")
 * that conflated three different situations — a name that does not exist, a
 * tool that exists but was not activated, and an activation failure — and
 * pointed the caller at activate_tools for a tool that can never activate.
 * Naming the actual situation is what makes the failure recoverable.
 */
function formatAutoActivationError(
  name: string,
  outcome: Exclude<AutoActivateOutcome, { status: 'ok' }>,
): string {
  switch (outcome.status) {
    case 'budget-exceeded':
      return `Tool "${name}" could not be auto-activated: ${outcome.hint}`;
    case 'unknown-tool': {
      const suggestion =
        outcome.suggestions.length > 0
          ? `Did you mean ${outcome.suggestions.map((candidate) => `"${candidate}"`).join(', ')}? `
          : '';
      return (
        `Tool "${name}" does not exist in this server. ` +
        suggestion +
        `Use search_tools({ query: "<action> <target>" }) to find the correct name.`
      );
    }
    case 'not-activated':
      return (
        `Tool "${name}" exists but is not active. ` +
        `Use activate_tools({ names: ["${name}"] }) or activate_domain({ domain: "<domain>" }), ` +
        `then call it directly.`
      );
    case 'activation-failed':
      return (
        `Tool "${name}" could not be activated: ${outcome.reason}. ` +
        `Retry once the server has finished initialising.`
      );
  }
}

/**
 * Activate a known-but-unregistered tool so clients that cannot see
 * tools/list_changed (and search-tier sessions) can still call it. The
 * outcome distinguishes "no such tool", "exists but did not activate" and
 * "activation threw", so the caller can report the real reason.
 */
async function autoActivateCallTool(
  ctx: MCPServerContext,
  name: string,
  searchCatalog: Awaited<ReturnType<typeof loadSearchCatalog>>,
  callMetadata: ReturnType<typeof buildCallToolMetadata>,
): Promise<AutoActivateOutcome> {
  try {
    const catalogEntry = searchCatalog.entryByName.get(name);
    if (!catalogEntry) {
      return {
        status: 'unknown-tool',
        suggestions: suggestSimilarToolNames(name, searchCatalog.entryByName.keys()),
      };
    }
    const { activateToolNames } = await import('@server/MCPServer.search.handlers.activate');
    const domain = catalogEntry.domain;
    if (domain && !ctx.enabledDomains.has(domain)) {
      const { handleActivateDomain } = await import('@server/MCPServer.search.handlers.domain');
      try {
        await handleActivateDomain(ctx, {
          domain,
          ttlMinutes: (await import('@src/constants')).ACTIVATION_TTL_MINUTES,
        });
      } catch {
        /* fall through to individual activation */
      }
    }
    if (!ctx.router.has(name)) {
      const activation = await activateToolNames(ctx, [name]);
      // The summary is the ONLY truth: activateToolNames silently SKIPS tools
      // over the activation budget, so "we asked" ≠ "it activated". Trusting
      // the request used to report activatedTools=[name] and then fail the
      // dispatch with a misleading "Unknown tool".
      const landed = activation.activated.includes(name) || activation.alreadyActive.includes(name);
      if (!landed) {
        callMetadata.wasAutoActivated = false;
        callMetadata.activatedTools = [];
        if (activation.budgetExceeded.includes(name)) {
          const { formatActivationBudgetHint } =
            await import('@server/MCPServer.search.handlers.activate');
          return { status: 'budget-exceeded', hint: formatActivationBudgetHint(activation) };
        }
        return { status: 'not-activated' };
      }
      callMetadata.wasAutoActivated = true;
      callMetadata.activatedTools = activation.activated.includes(name) ? [name] : [];
    } else {
      // Domain activation above brought the tool online without individual
      // activation — the tool IS active now.
      callMetadata.wasAutoActivated = true;
      callMetadata.activatedTools = [name];
    }
    return { status: 'ok' };
  } catch (error) {
    // Activation itself failed (registry not initialised, import failure, or a
    // throwing activation handler). Distinct from "no such tool": the caller
    // should retry, not go looking for a different name.
    return {
      status: 'activation-failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function handleCallTool(
  ctx: MCPServerContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const searchCatalog = await loadSearchCatalog();
  const rawName = typeof args.name === 'string' ? args.name : '';
  const defaultMetadata = buildCallToolMetadata(false, []);

  if (!rawName) {
    return asTextResponse(
      JSON.stringify({
        success: false,
        error: 'name must be a non-empty string',
        ...defaultMetadata,
      }),
    );
  }

  const name = normalizeToolName(rawName);
  const { toolArgs, wrapperError } = resolveCallToolArgs(args);

  if (wrapperError && Object.keys(toolArgs).length === 0) {
    return asTextResponse(
      JSON.stringify({
        success: false,
        error: wrapperError,
        ...defaultMetadata,
      }),
    );
  }

  const callMetadata = defaultMetadata;

  // Meta-tools live in neither the router nor the search catalog — dispatch
  // them straight to their registered handlers before auto-activation logic.
  // Dynamic import keeps the graph acyclic: search.ts registers handleCallTool
  // (implemented here), so a static import of META_TOOL_NAMES would cycle.
  const { META_TOOL_NAMES, getMetaToolHandler } = await import('@server/MCPServer.search');
  if (META_TOOL_NAMES.has(name)) {
    return dispatchMetaTool(ctx, name, toolArgs, callMetadata, getMetaToolHandler);
  }

  // Auto-activate the tool if it's known but not yet registered.
  // This bridges the gap for MCP clients that cannot see tools/list_changed
  // and for search-tier sessions where the tool was discovered via search_tools
  // but not yet activated (e.g., when search returned 0 results and domain
  // fallback activation was triggered).
  if (!ctx.router.has(name)) {
    const autoActivation = await autoActivateCallTool(ctx, name, searchCatalog, callMetadata);

    if (autoActivation.status !== 'ok') {
      // Report the actual reason. These used to collapse into a single message
      // that told the caller to activate a tool that may not exist — see
      // formatAutoActivationError for the situations now distinguished.
      return asTextResponse(
        JSON.stringify({
          success: false,
          error: formatAutoActivationError(name, autoActivation),
          // Machine-readable near-misses for a name that is not in the catalog,
          // so an agent can retry without a second round trip.
          ...(autoActivation.status === 'unknown-tool' && autoActivation.suggestions.length > 0
            ? { suggestions: autoActivation.suggestions }
            : {}),
          ...callMetadata,
        }),
      );
    }
  }

  // Dispatch to the actual tool handler via executeToolWithTracking
  try {
    const validatedArgs = validateToolArgsAgainstSchema(
      name,
      getToolInputSchema(name, ctx),
      toolArgs,
    );
    const response = await ctx.executeToolWithTracking(name, validatedArgs);

    // Search-engine feedback (vector weight + recency) and quality
    // association are recorded inside executeToolWithTracking — the same
    // pipeline the direct-call path takes — so the call_tool proxy no longer
    // records them manually (that would double-count the learning signal).
    // Snapshot-source registration moved into getSearchEngine.

    return attachCallToolMetadata(response, callMetadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`call_tool: execution of "${name}" failed`, error);
    return asTextResponse(
      JSON.stringify({
        success: false,
        error: `Tool "${name}" failed: ${message}`,
        ...callMetadata,
      }),
    );
  }
}
