/**
 * Search and activation meta-tool handlers for progressive tool discovery.
 *
 * Provides:
 *  - search_tools: BM25 search across all tools
 *  - activate_tools: register specific tools by name
 *  - deactivate_tools: unregister specific activated tools
 *  - activate_domain: register all tools in a domain
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
import type { MCPServerContext } from '@server/MCPServer.context';
import { ALL_DOMAINS } from '@server/registry/index';

/* ---------- re-exports (public API) ---------- */

export { buildSearchSignature, getSearchEngine } from '@server/MCPServer.search.helpers';
export { buildDomainDescription } from '@server/MCPServer.search.helpers';

/* ---------- handler imports ---------- */

import { buildDomainDescription } from '@server/MCPServer.search.helpers';
import { handleSearchTools } from '@server/MCPServer.search.handlers.search';
import { handleActivateTools, handleDeactivateTools } from '@server/MCPServer.search.handlers.activate';
import { handleActivateDomain } from '@server/MCPServer.search.handlers.domain';
import { handleRouteTool, handleDescribeTool } from '@server/MCPServer.search.handlers.route';

/* ---------- registration ---------- */

export function registerSearchMetaTools(ctx: MCPServerContext): void {
  ctx.server.registerTool(
    'search_tools',
    {
      description: buildDomainDescription(ctx),
      inputSchema: {
        query: z.string().describe('Search query: keywords, tool name, domain name, or description fragment'),
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
        task: z.string().describe('Natural language description of the task you want to accomplish'),
        context: z.object({
          preferredDomain: z.string().optional().describe('Domain preference (e.g., "browser", "network")'),
          autoActivate: z.boolean().optional().describe('Whether to auto-activate recommended tools (default: true)'),
          maxRecommendations: z.number().optional().describe('Maximum number of recommendations (default: 5)'),
        }).optional().describe('Optional context hints for routing'),
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
        'Activated tools appear in the tool list immediately.',
      inputSchema: {
        names: z.array(z.string()).describe('Array of tool names to activate (from search_tools results)'),
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
        `Domains: ${[...ALL_DOMAINS].join(', ')}. ` +
        `Use extensions_reload first to include external plugin/workflow domains.`,
      inputSchema: {
        domain: z.string().describe('Domain name to activate (e.g. "debugger", "network")'),
        ttlMinutes: z.number().optional().describe('Auto-deactivate after N minutes (default: 30, set 0 for no expiry)'),
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
}
