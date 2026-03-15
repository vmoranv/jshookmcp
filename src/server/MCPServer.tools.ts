import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { logger } from '@utils/logger';
import { asErrorResponse, toolErrorToResponse } from '@server/domains/shared/response';
import { ToolError } from '@errors/ToolError';
import type { ToolArgs } from '@server/types';
import { buildZodShape } from '@server/MCPServer.schema';
import type { MCPServerContext } from '@server/MCPServer.context';

/**
 * Unified error handler for tool execution.
 * Converts ToolError subclasses (including PrerequisiteError) into
 * structured responses; falls back to generic error for unknown errors.
 */
function handleToolError(toolName: string, error: unknown) {
  if (error instanceof ToolError) {
    return toolErrorToResponse(error);
  }
  logger.error(`Tool execution failed: ${toolName}`, error);
  return asErrorResponse(error);
}

export function registerSingleTool(ctx: MCPServerContext, toolDef: Tool): RegisteredTool {
  const shape = buildZodShape(toolDef.inputSchema as Record<string, unknown>);
  const description = toolDef.description ?? toolDef.name;

  if (Object.keys(shape).length > 0) {
    return ctx.server.registerTool(
      toolDef.name,
      { description, inputSchema: shape as Record<string, z.ZodAny> },
      async (args: ToolArgs) => {
        try {
          return await ctx.executeToolWithTracking(toolDef.name, args);
        } catch (error) {
          return handleToolError(toolDef.name, error);
        }
      }
    );
  }

  return ctx.server.registerTool(toolDef.name, { description }, async () => {
    try {
      return await ctx.executeToolWithTracking(toolDef.name, {});
    } catch (error) {
      return handleToolError(toolDef.name, error);
    }
  });
}
