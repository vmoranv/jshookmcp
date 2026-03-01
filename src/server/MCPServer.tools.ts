import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { asErrorResponse, asTextResponse } from './domains/shared/response.js';
import { PrerequisiteError } from '../errors/PrerequisiteError.js';
import type { ToolArgs } from './types.js';
import type { ToolProfile } from './ToolCatalog.js';
import { buildZodShape } from './MCPServer.schema.js';
import type { MCPServerContext } from './MCPServer.context.js';

export function registerSingleTool(ctx: MCPServerContext, toolDef: Tool): RegisteredTool {
  const shape = buildZodShape(toolDef.inputSchema as Record<string, unknown>);
  const description = toolDef.description ?? toolDef.name;

  if (Object.keys(shape).length > 0) {
    return ctx.server.tool(
      toolDef.name,
      description,
      shape as Record<string, z.ZodAny>,
      async (args: ToolArgs) => {
        try {
          return await ctx.executeToolWithTracking(toolDef.name, args);
        } catch (error) {
          if (error instanceof PrerequisiteError) {
            return asTextResponse(JSON.stringify({ success: false, message: error.message }, null, 2));
          }
          logger.error(`Tool execution failed: ${toolDef.name}`, error);
          return asErrorResponse(error);
        }
      }
    );
  }

  return ctx.server.tool(toolDef.name, description, async () => {
    try {
      return await ctx.executeToolWithTracking(toolDef.name, {});
    } catch (error) {
      if (error instanceof PrerequisiteError) {
        return asTextResponse(JSON.stringify({ success: false, message: error.message }, null, 2));
      }
      logger.error(`Tool execution failed: ${toolDef.name}`, error);
      return asErrorResponse(error);
    }
  });
}

export function registerMetaTools(ctx: MCPServerContext): void {
  ctx.server.tool(
    'boost_profile',
    'Progressively upgrade the active tool tier. Three tiers: min → workflow → full. ' +
      'min: browser + maintenance (~61 tools). ' +
      'workflow: + core analysis, debugger, network, streaming, encoding, graphql, workflows (~164 tools). ' +
      'full: + hooks, process, wasm, antidebug, platform, sourcemap, transform (~229 tools). ' +
      'Auto-expires after TTL (default per-tier: workflow=60min, full=30min). Call unboost_profile to downgrade.',
    {
      target: z.string().optional().describe('Target tier: "workflow" or "full" (default: next tier up)'),
      ttlMinutes: z
        .number()
        .optional()
        .describe('Auto-downgrade after N minutes (default: per-tier, set 0 to disable)'),
    } as unknown as Record<string, z.ZodAny>,
    async (args: Record<string, unknown>) => {
      try {
        const target = (args.target as ToolProfile | undefined) ?? undefined;
        const ttlMinutes = args.ttlMinutes as number | undefined;
        const result = await ctx.boostProfile(target, ttlMinutes);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        logger.error('boost_profile failed', error);
        return asErrorResponse(error);
      }
    }
  );

  ctx.server.tool(
    'unboost_profile',
    'Downgrade to the previous tool tier (full → workflow → min). ' +
      'Removes tools added by the last boost. Set target to drop directly to a specific tier.',
    {
      target: z
        .string()
        .optional()
        .describe('Drop directly to this tier ("min" or "workflow"). Default: previous tier.'),
    } as unknown as Record<string, z.ZodAny>,
    async (args: Record<string, unknown>) => {
      try {
        const target = (args.target as ToolProfile | undefined) ?? undefined;
        const result = await ctx.unboostProfile(target);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        logger.error('unboost_profile failed', error);
        return asErrorResponse(error);
      }
    }
  );
}
