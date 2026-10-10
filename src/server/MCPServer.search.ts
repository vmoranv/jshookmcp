/**
 * Search and activation meta-tool handlers for progressive tool discovery.
 *
 * Provides:
 *  - search_tools: BM25 search across all tools
 *  - activate_tools: register specific tools by name
 *  - deactivate_tools: unregister specific activated tools
 *  - activate_domain: register all tools in a domain
 *  - call_tool: proxy to invoke any tool by name (bridges clients lacking tools/list_changed)
 *
 * This file is a thin facade that re-exports the public API and wires handlers
 * via registerSearchMetaTools. Implementation lives in sub-modules:
 *   MCPServer.search.helpers.ts
 *   MCPServer.search.validation.ts
 *   MCPServer.search.handlers.search.ts
 *   MCPServer.search.handlers.activate.ts
 *   MCPServer.search.handlers.domain.ts
 *   MCPServer.search.handlers.route.ts
 *   MCPServer.search.handlers.extensions.ts
 */
import type { Tool } from '@modelcontextprotocol/server';
import { logger } from '@utils/logger';
import { asErrorResponse } from '@server/domains/shared/response';
import type { MCPServerContext } from '@server/MCPServer.context';
import { getAllDomains } from '@server/registry/index';
import { buildZodShape } from '@server/MCPServer.schema';
import { z } from 'zod';
import type { ToolResponse } from '@server/types';

// ── re-exports (public API) ──

export { buildSearchSignature, getSearchEngine } from '@server/MCPServer.search.helpers';
export { buildDomainDescription } from '@server/MCPServer.search.helpers';

// ── handler imports ──

import {
  buildDomainDescription,
  getActivationBudgetSnapshot,
} from '@server/MCPServer.search.helpers';
import { handleSearchTools } from '@server/MCPServer.search.handlers.search';
import {
  handleActivateTools,
  handleDeactivateTools,
} from '@server/MCPServer.search.handlers.activate';
import { handleActivateDomain } from '@server/MCPServer.search.handlers.domain';
import { handleRouteTool, handleDescribeTool } from '@server/MCPServer.search.handlers.route';
import { handleCallTool } from '@server/MCPServer.search.handlers.call';
import { getRuntimeState } from '@server/runtime/ServerRuntimeState';
import { ensureAllDomainsLoaded } from '@server/registry/index';
import { attachToolRequestMeta } from '@server/runtime/tool-request-meta';
import {
  runWithToolRequestContext,
  type ToolRequestExtra,
} from '@server/runtime/ToolRequestContext';

// ── single-source meta-tool definitions ──

/** Handler signature shared by top-level registration and call_tool dispatch. */
export type MetaToolHandler = (
  ctx: MCPServerContext,
  args: Record<string, unknown>,
) => Promise<ToolResponse>;

/**
 * Descriptions are either static text or resolved lazily at registration time.
 * Module-level definitions must stay free of context-dependent values so that
 * META_TOOL_NAMES can be derived at import time.
 */
type MetaToolDescription = string | ((ctx: MCPServerContext) => string);

interface MetaToolDef {
  name: string;
  description: MetaToolDescription;
  inputSchema: Record<string, unknown>;
  handler: MetaToolHandler;
}

async function handleCoverageReport(
  ctx: MCPServerContext,
  _args: Record<string, unknown>,
): Promise<ToolResponse> {
  await ensureAllDomainsLoaded(ctx.eventBus);
  const runtimeState = getRuntimeState(ctx);
  const summary = runtimeState?.getCoverageSummary(ctx) ?? {
    called: {},
    calledCount: 0,
    uncataloguedCalls: [],
    uncataloguedCallCount: 0,
    totalKnownTools: 0,
    uncalled: [],
    uncalledCount: 0,
  };
  const budget = await getActivationBudgetSnapshot(ctx);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            ...summary,
            budget,
          },
          null,
          2,
        ),
      },
    ],
  };
}

const META_TOOL_DEFINITIONS: MetaToolDef[] = [
  {
    name: 'search_tools',
    description: (ctx) => buildDomainDescription(ctx),
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Before calling, distill your intent into 2-5 key concepts: what action, on what target, in which ' +
            'domain. ' +
            'Pass only those distilled keywords — not the original user request.',
        },
        top_k: { type: 'number', description: 'Max results to return (default: 10, max: 30)' },
        auto_activate: {
          type: 'boolean',
          description:
            'Auto-activate found tools so they are immediately callable. Set false to only search without activating (default: true)',
          default: true,
        },
      },
      required: ['query'],
    },
    handler: handleSearchTools,
  },
  {
    name: 'route_tool',
    description:
      'One-stop tool router: accepts a natural language task description, returns recommended tools and next ' +
      'actions. ' +
      'Automatically detects workflow patterns, recommends activation order, and provides example arguments. ' +
      'Use this instead of search_tools when you want guided tool discovery with actionable next steps.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Natural language description of the task you want to accomplish',
        },
        context: {
          type: 'object',
          description: 'Optional context hints for routing',
          properties: {
            preferredDomain: {
              type: 'string',
              description: 'Domain preference (e.g., "browser", "network")',
            },
            autoActivate: {
              type: 'boolean',
              description: 'Whether to auto-activate recommended tools (default: false)',
            },
            maxRecommendations: {
              type: 'number',
              description: 'Maximum number of recommendations (default: 5)',
            },
          },
        },
      },
      required: ['task'],
    },
    handler: handleRouteTool,
  },
  {
    name: 'describe_tool',
    description:
      'Get detailed information about a specific tool, including its input schema. ' +
      'Use this to see the exact parameters a tool expects before calling it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name to describe' },
      },
      required: ['name'],
    },
    handler: handleDescribeTool,
  },
  {
    name: 'activate_tools',
    description:
      'Dynamically register specific tools by name, regardless of current base tier. ' +
      'Use after search_tools to enable exactly the tools you need. ' +
      'In search-tier sessions this is usually enough; use activate_domain when you need every tool in a ' +
      'domain. ' +
      'Activated tools appear in the tool list immediately. ' +
      'If tools do not appear after activation, use call_tool to invoke them directly.',
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          anyOf: [
            { type: 'array', items: { type: 'string' } },
            {
              type: 'string',
              description:
                'JSON stringified array for MCP clients that serialize arrays as strings',
            },
          ],
          description:
            'Array of tool names to activate (from search_tools results). Also accepts a JSON stringified array for clients that serialize arrays as strings.',
        },
        precheck: {
          type: 'boolean',
          description:
            'Dry-run mode: report wouldActivate / wouldEvict (LRU candidates that must be deactivated to make budget room) ' +
            'and the projected afterEvict budget, without activating or deactivating anything.',
        },
      },
      required: ['names'],
    },
    handler: handleActivateTools,
  },
  {
    name: 'deactivate_tools',
    description:
      'Remove previously activated tools to free context. ' +
      'Only affects dynamically activated tools (added via activate_tools, activate_domain, or extension ' +
      'activation), not base profile tools.',
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          anyOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'string', description: 'JSON stringified array' },
          ],
          description: 'Array of tool names to deactivate',
        },
      },
      required: ['names'],
    },
    handler: handleDeactivateTools,
  },
  {
    name: 'activate_domain',
    description: () =>
      `Register every tool in a single domain at once. ` +
      `Use this when a task needs a whole capability area; prefer search_tools or activate_tools when you ` +
      `only need a few specific tools, because activating a domain costs far more context. ` +
      `Domains: ${[...getAllDomains()].join(', ')}. ` +
      `Activated tools appear in the tool list immediately; if your client does not refresh its tool list, ` +
      `invoke them with call_tool. ` +
      `Activation draws on the session context budget: when the budget is full, least-recently-used tools are ` +
      `evicted to make room, and the response reports what was activated and what was evicted. ` +
      `Pass precheck: true to preview wouldActivate / wouldEvict without changing anything. ` +
      `Activated tools auto-deactivate after ttlMinutes (default 30; pass 0 for no expiry). ` +
      `Use reload_extensions first to include external plugin/workflow domains.`,
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Domain name to activate (e.g. "debugger", "network")',
        },
        ttlMinutes: {
          type: 'number',
          description: 'Auto-deactivate after N minutes (default: 30, set 0 for no expiry)',
        },
        precheck: {
          type: 'boolean',
          description:
            'Dry-run mode: report wouldActivate / wouldEvict (LRU candidates that must be deactivated to make budget room) ' +
            'and the projected afterEvict budget, without activating or deactivating anything.',
        },
      },
      required: ['domain'],
    },
    handler: handleActivateDomain,
  },
  {
    name: 'call_tool',
    description:
      'Execute an already-active tool by name. ' +
      'Use this when activate_tools/activate_domain registered a tool but your client did not refresh its tool ' +
      'list. ' +
      'Does not auto-activate inactive tools.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The tool name to execute (from search_tools or describe_tool results)',
        },
        args: {
          type: 'object',
          description: 'Arguments object to pass to the tool',
          additionalProperties: true,
        },
        parameters: {
          type: 'string',
          description:
            'Alternative: JSON-serialized arguments string. ' +
            'Some MCP clients serialize the nested arguments as a single stringified-JSON field.',
        },
        arguments: {
          type: 'string',
          description:
            'Another alternative: MCP clients that stringify the entire arguments wrapper. ' +
            'Carries the same nested {name, args/parameters} payload as a JSON string.',
        },
      },
      required: ['name'],
    },
    handler: handleCallTool,
  },
  {
    name: 'coverage_report',
    description:
      'Report which tools have been called in the current runtime and which known tools remain uncalled. ' +
      'Loads all domains first so the uncalled list reflects the full tool catalog, not just currently active tools.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleCoverageReport,
  },
];

/**
 * Canonical meta-tool names, derived from META_TOOL_DEFINITIONS (single source
 * of truth for the 8-name list). Shared by activate_tools (meta-tools are
 * always registered, never part of the domain catalog), call_tool (meta-tool
 * dispatch) and ToolCallContextGuard (repeat-guard excludes).
 */
export const META_TOOL_NAMES: ReadonlySet<string> = new Set(
  META_TOOL_DEFINITIONS.map((def) => def.name),
);

/** Resolve a meta-tool handler by name (single source: META_TOOL_DEFINITIONS). */
export function getMetaToolHandler(name: string): MetaToolHandler | undefined {
  return META_TOOL_DEFINITIONS.find((def) => def.name === name)?.handler;
}

/** A meta-tool definition whose lazy description has been resolved to text. */
interface ResolvedMetaToolDef extends Omit<MetaToolDef, 'description'> {
  description: string;
}

/** Resolve lazy descriptions against a concrete context. */
function buildMetaToolDefinitions(ctx: MCPServerContext): ResolvedMetaToolDef[] {
  return META_TOOL_DEFINITIONS.map((def) => ({
    ...def,
    description: typeof def.description === 'function' ? def.description(ctx) : def.description,
  }));
}

// ── registration ──

export function registerSearchMetaTools(ctx: MCPServerContext): void {
  const defs = buildMetaToolDefinitions(ctx);

  for (const def of defs) {
    const shape = buildZodShape(def.inputSchema);

    ctx.server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: shape as unknown as Record<string, z.ZodType>,
      },
      async (args: Record<string, unknown>, extra?: ToolRequestExtra) => {
        return runWithToolRequestContext(extra, async () => {
          try {
            const augmentedArgs = attachToolRequestMeta(args, extra);
            // Tool-execution gate (ordered rules + doom-loop) — the same
            // shared entry the domain-tool path reaches via
            // executeToolWithTracking, keyed on the meta tool's own name.
            // Dynamic import keeps the module graph acyclic:
            // ToolCallContextGuard imports META_TOOL_NAMES from this module
            // (same pattern as handleCallTool's META_TOOL_NAMES import).
            const { runToolExecutionGate } = await import('@server/ToolCallContextGuard');
            // call_tool is a proxy: its dispatched target is gated separately
            // (dispatch gate for meta tools, executeToolWithTracking for
            // domain tools). call_tool's own key must stay out of the
            // doom-loop tracker — the tracker keeps one lastKey slot per
            // session, so recording it between the dispatched target's
            // records would reset the inner streak on every call.
            const gateResponse = runToolExecutionGate(ctx, def.name, augmentedArgs, {
              recordDoomLoop: def.name !== 'call_tool',
            });
            if (gateResponse) return gateResponse;
            const response = await def.handler(ctx, augmentedArgs);
            getRuntimeState(ctx)?.recordToolCall(def.name, augmentedArgs);
            return response;
          } catch (error) {
            logger.error(`${def.name} failed`, error);
            return asErrorResponse(error);
          }
        });
      },
    );

    // Populate metaToolsByName for describe_tool lookups (single source)
    ctx.metaToolsByName.set(def.name, {
      name: def.name,
      description: def.description.split('\n')[0] || def.description,
      inputSchema: def.inputSchema as Tool['inputSchema'],
    });
  }
}
