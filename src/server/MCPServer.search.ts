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
import { z } from 'zod';
import { logger } from '@utils/logger';
import { asErrorResponse } from '@server/domains/shared/response';
import type { MCPServerContext, MetaToolInfo } from '@server/MCPServer.context';
import { getAllDomains } from '@server/registry/index';

/* ---------- re-exports (public API) ---------- */

export { buildSearchSignature, getSearchEngine } from '@server/MCPServer.search.helpers';
export { buildDomainDescription } from '@server/MCPServer.search.helpers';

/* ---------- handler imports ---------- */

import { buildDomainDescription } from '@server/MCPServer.search.helpers';
import { handleSearchTools } from '@server/MCPServer.search.handlers.search';
import {
  handleActivateTools,
  handleDeactivateTools,
} from '@server/MCPServer.search.handlers.activate';
import { handleActivateDomain } from '@server/MCPServer.search.handlers.domain';
import { handleRouteTool, handleDescribeTool } from '@server/MCPServer.search.handlers.route';
import { handleCallTool } from '@server/MCPServer.search.handlers.call';

/* ---------- registration ---------- */

export function registerSearchMetaTools(ctx: MCPServerContext): void {
  ctx.server.registerTool(
    'search_tools',
    {
      description: buildDomainDescription(ctx),
      inputSchema: {
        query: z
          .string()
          .describe('Search query: keywords, tool name, domain name, or description fragment'),
        top_k: z.number().optional().describe('Max results to return (default: 10, max: 30)'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleSearchTools(ctx, args);
      } catch (error) {
        logger.error('search_tools failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'route_tool',
    {
      description:
        'One-stop tool router: accepts a natural language task description, returns recommended tools and next actions. ' +
        'Automatically detects workflow patterns, recommends activation order, and provides example arguments. ' +
        'Use this instead of search_tools when you want guided tool discovery with actionable next steps.',
      inputSchema: {
        task: z
          .string()
          .describe('Natural language description of the task you want to accomplish'),
        context: z
          .object({
            preferredDomain: z
              .string()
              .optional()
              .describe('Domain preference (e.g., "browser", "network")'),
            autoActivate: z
              .boolean()
              .optional()
              .describe('Whether to auto-activate recommended tools (default: true)'),
            maxRecommendations: z
              .number()
              .optional()
              .describe('Maximum number of recommendations (default: 5)'),
          })
          .optional()
          .describe('Optional context hints for routing'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleRouteTool(ctx, args);
      } catch (error) {
        logger.error('route_tool failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'describe_tool',
    {
      description:
        'Get detailed information about a specific tool, including its input schema. ' +
        'Use this to see the exact parameters a tool expects before calling it.',
      inputSchema: {
        name: z.string().describe('Tool name to describe'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleDescribeTool(ctx, args);
      } catch (error) {
        logger.error('describe_tool failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'activate_tools',
    {
      description:
        'Dynamically register specific tools by name, regardless of current base tier. ' +
        'Use after search_tools to enable exactly the tools you need. ' +
        'In search-tier sessions this is usually enough; you do not need boost_profile just to use a few exact tools. ' +
        'Activated tools appear in the tool list immediately. ' +
        'If tools do not appear after activation, use call_tool to invoke them directly.',
      inputSchema: {
        names: z
          .array(z.string())
          .describe('Array of tool names to activate (from search_tools results)'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleActivateTools(ctx, args);
      } catch (error) {
        logger.error('activate_tools failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'deactivate_tools',
    {
      description:
        'Remove previously activated tools to free context. ' +
        'Only affects tools added via activate_tools, not base profile tools.',
      inputSchema: {
        names: z.array(z.string()).describe('Array of tool names to deactivate'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleDeactivateTools(ctx, args);
      } catch (error) {
        logger.error('deactivate_tools failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'activate_domain',
    {
      description:
        `Activate all tools in a domain at once. ` +
        `Domains: ${[...getAllDomains()].join(', ')}. ` +
        `Use extensions_reload first to include external plugin/workflow domains.`,
      inputSchema: {
        domain: z.string().describe('Domain name to activate (e.g. "debugger", "network")'),
        ttlMinutes: z
          .number()
          .optional()
          .describe('Auto-deactivate after N minutes (default: 30, set 0 for no expiry)'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleActivateDomain(ctx, args);
      } catch (error) {
        logger.error('activate_domain failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.registerTool(
    'call_tool',
    {
      description:
        'Execute any tool by name with auto-activation. ' +
        'Use this when activate_tools/activate_domain registered a tool but it does not appear in your tool list ' +
        '(common for clients that do not support tools/list_changed notifications). ' +
        "Accepts the tool name and its arguments object; returns the tool's native response.",
      inputSchema: {
        name: z
          .string()
          .describe('The tool name to execute (from search_tools or describe_tool results)'),
        args: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Arguments object to pass to the tool'),
      } as unknown as Record<string, z.ZodAny>,
    },
    async (args: Record<string, unknown>) => {
      try {
        return await handleCallTool(ctx, args);
      } catch (error) {
        logger.error('call_tool failed', error);
        return asErrorResponse(error);
      }
    }
  );

  /* ---------- populate metaToolsByName for describe_tool lookups ---------- */

  const metaDefs: MetaToolInfo[] = [
    {
      name: 'search_tools',
      description:
        buildDomainDescription(ctx).split('\n')[0] || 'Search tools across all capability domains.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Search query: keywords, tool name, domain name, or description fragment',
          },
          top_k: { type: 'number', description: 'Max results to return (default: 10, max: 30)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'route_tool',
      description:
        'One-stop tool router: accepts a natural language task description, returns recommended tools and next actions.',
      inputSchema: {
        type: 'object' as const,
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
    },
    {
      name: 'describe_tool',
      description: 'Get detailed information about a specific tool, including its input schema.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Tool name to describe' },
        },
        required: ['name'],
      },
    },
    {
      name: 'activate_tools',
      description: 'Dynamically register specific tools by name, regardless of current base tier.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of tool names to activate (from search_tools results)',
          },
        },
        required: ['names'],
      },
    },
    {
      name: 'deactivate_tools',
      description: 'Remove previously activated tools to free context.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of tool names to deactivate',
          },
        },
        required: ['names'],
      },
    },
    {
      name: 'activate_domain',
      description: `Activate all tools in a domain at once. Domains: ${[...getAllDomains()].join(', ')}.`,
      inputSchema: {
        type: 'object' as const,
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
    },
    {
      name: 'call_tool',
      description:
        'Execute any tool by name with auto-activation. Bridges clients lacking tools/list_changed support.',
      inputSchema: {
        type: 'object' as const,
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
    },
  ];

  for (const def of metaDefs) {
    ctx.metaToolsByName.set(def.name, def);
  }
}
