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
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@utils/logger';
import { asErrorResponse } from '@server/domains/shared/response';
import type { MCPServerContext } from '@server/MCPServer.context';
import { getAllDomains } from '@server/registry/index';
import { buildZodShape } from '@server/MCPServer.schema';
import type { z } from 'zod';
import type { ToolResponse } from '@server/types';

// ── re-exports (public API) ──

export { buildSearchSignature, getSearchEngine } from '@server/MCPServer.search.helpers';
export { buildDomainDescription } from '@server/MCPServer.search.helpers';

// ── handler imports ──

import { buildDomainDescription } from '@server/MCPServer.search.helpers';
import { handleSearchTools } from '@server/MCPServer.search.handlers.search';
import {
  handleActivateTools,
  handleDeactivateTools,
} from '@server/MCPServer.search.handlers.activate';
import { handleActivateDomain } from '@server/MCPServer.search.handlers.domain';
import { handleRouteTool, handleDescribeTool } from '@server/MCPServer.search.handlers.route';
import { handleCallTool } from '@server/MCPServer.search.handlers.call';

// ── single-source meta-tool definitions ──

interface MetaToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (ctx: MCPServerContext, args: Record<string, unknown>) => Promise<ToolResponse>;
}

function buildMetaToolDefinitions(ctx: MCPServerContext): MetaToolDef[] {
  return [
    {
      name: 'search_tools',
      description: buildDomainDescription(ctx),
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query: keywords, tool name, domain name, or description fragment',
          },
          top_k: { type: 'number', description: 'Max results to return (default: 10, max: 30)' },
        },
        required: ['query'],
      },
      handler: handleSearchTools,
    },
    {
      name: 'route_tool',
      description:
        'One-stop tool router: accepts a natural language task description, returns recommended tools and next actions. ' +
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
                description: 'Whether to auto-activate recommended tools (default: true)',
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
        'In search-tier sessions this is usually enough; you do not need boost_profile just to use a few exact tools. ' +
        'Activated tools appear in the tool list immediately. ' +
        'If tools do not appear after activation, use call_tool to invoke them directly.',
      inputSchema: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of tool names to activate (from search_tools results)',
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
        'Only affects tools added via activate_tools, not base profile tools.',
      inputSchema: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of tool names to deactivate',
          },
        },
        required: ['names'],
      },
      handler: handleDeactivateTools,
    },
    {
      name: 'activate_domain',
      description:
        `Activate all tools in a domain at once. ` +
        `Domains: ${[...getAllDomains()].join(', ')}. ` +
        `Use extensions_reload first to include external plugin/workflow domains.`,
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
        },
        required: ['domain'],
      },
      handler: handleActivateDomain,
    },
    {
      name: 'call_tool',
      description:
        'Execute any tool by name with auto-activation. ' +
        'Use this when activate_tools/activate_domain registered a tool but it does not appear in your tool list ' +
        '(common for clients that do not support tools/list_changed notifications). ' +
        "Accepts the tool name and its arguments object; returns the tool's native response.",
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
        },
        required: ['name'],
      },
      handler: handleCallTool,
    },
  ];
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
        inputSchema: shape as Record<string, z.ZodAny>,
      },
      async (args: Record<string, unknown>) => {
        try {
          return await def.handler(ctx, args);
        } catch (error) {
          logger.error(`${def.name} failed`, error);
          return asErrorResponse(error);
        }
      }
    );

    // Populate metaToolsByName for describe_tool lookups (single source)
    ctx.metaToolsByName.set(def.name, {
      name: def.name,
      description: def.description.split('\n')[0] || def.description,
      inputSchema: def.inputSchema as Tool['inputSchema'],
    });
  }
}
