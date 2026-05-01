import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { ZodError, type z } from 'zod';
import { logger } from '@utils/logger';
import { ToolError, type ToolErrorCode } from '@errors/ToolError';
import type { ToolArgs } from '@server/types';
import { buildZodShape } from '@server/MCPServer.schema';
import type { MCPServerContext } from '@server/MCPServer.context';

function mapErrorCode(code: ToolErrorCode): number {
  switch (code) {
    case 'VALIDATION':
      return ErrorCode.InvalidParams; // -32602
    case 'NOT_FOUND':
      return -32002; // Custom ResourceNotFound, standard is -32601 but we use -32002 as requested
    case 'TIMEOUT':
      return ErrorCode.RequestTimeout; // -32001
    case 'CONNECTION':
      return ErrorCode.ConnectionClosed; // -32000
    case 'PREREQUISITE':
    case 'PERMISSION':
      return ErrorCode.InvalidRequest; // -32600
    case 'RUNTIME':
    default:
      return ErrorCode.InternalError; // -32603
  }
}

/**
 * Unified error handler for tool execution.
 * Standardizes errors into proper MCP JSON-RPC protocol errors (-326xx, -320xx)
 * rather than intercepting into custom `isError: true` soft responses.
 */
function handleToolError(toolName: string, error: unknown): never {
  if (error instanceof ZodError) {
    logger.error(`Tool validation failed: ${toolName}`, error);
    throw new McpError(
      ErrorCode.InvalidParams,
      `Validation Error in ${toolName}: ${error.message}`,
    );
  }

  if (error instanceof McpError) {
    throw error;
  }

  if (error instanceof ToolError) {
    logger.error(`Tool execution failed [${error.code}]: ${toolName} - ${error.message}`);
    const details = error.details ? `\nDetails: ${JSON.stringify(error.details)}` : '';
    throw new McpError(mapErrorCode(error.code), `[${error.code}] ${error.message}${details}`);
  }

  logger.error(`Tool execution failed: ${toolName}`, error);
  throw new McpError(
    ErrorCode.InternalError,
    `Execution Failed in ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

import type { BuiltTool } from '@server/registry/tool-builder';
import { MCP_COMPACT_SCHEMA } from '@src/constants';

type JsonSchemaObj = Record<string, unknown> & {
  properties?: Record<string, JsonSchemaObj>;
  items?: JsonSchemaObj;
  additionalProperties?: unknown;
};

function stripParamDescriptions(schema: JsonSchemaObj): JsonSchemaObj {
  const clone: JsonSchemaObj = { ...schema };
  if (clone.properties) {
    const props: Record<string, JsonSchemaObj> = {};
    for (const [key, val] of Object.entries(clone.properties)) {
      const { description: _d, ...rest } = val;
      props[key] = stripParamDescriptions(rest as JsonSchemaObj);
    }
    clone.properties = props;
  }
  if (clone.items && typeof clone.items === 'object') {
    const { description: _d, ...rest } = clone.items as JsonSchemaObj;
    clone.items = stripParamDescriptions(rest);
  }
  if (
    clone.additionalProperties &&
    typeof clone.additionalProperties === 'object' &&
    !Array.isArray(clone.additionalProperties)
  ) {
    clone.additionalProperties = stripParamDescriptions(
      clone.additionalProperties as JsonSchemaObj,
    );
  }
  return clone;
}

export function registerSingleTool(ctx: MCPServerContext, toolDef: Tool): RegisteredTool {
  const builtTool = toolDef as BuiltTool;
  if (builtTool.autocompleteHandlers) {
    ctx.toolAutocompleteHandlers.set(toolDef.name, builtTool.autocompleteHandlers);
  }

  const rawSchema =
    MCP_COMPACT_SCHEMA && toolDef.inputSchema
      ? stripParamDescriptions(toolDef.inputSchema as JsonSchemaObj)
      : toolDef.inputSchema;
  const shape =
    rawSchema && typeof rawSchema === 'object'
      ? buildZodShape(rawSchema as Record<string, unknown>)
      : {};
  const description = toolDef.description ?? toolDef.name;

  if (Object.keys(shape).length > 0) {
    const registeredTool = ctx.server.registerTool(
      toolDef.name,
      { description, inputSchema: shape as Record<string, z.ZodAny> },
      async (args: ToolArgs, extra?: any) => {
        try {
          const augmentedArgs = { ...args };
          if (extra?._meta) augmentedArgs._meta = extra._meta;
          // If taskStore is provided (SDK handles polling), we can use it internally if needed
          return await ctx.executeToolWithTracking(toolDef.name, augmentedArgs);
        } catch (error) {
          return handleToolError(toolDef.name, error);
        }
      },
    );

    if (builtTool.execution) {
      const sdkInternalMap = (ctx.server as any).registeredTools;
      if (sdkInternalMap && sdkInternalMap[toolDef.name]) {
        sdkInternalMap[toolDef.name].execution = builtTool.execution;
      }
    }

    return registeredTool;
  }

  const registeredTool = ctx.server.registerTool(
    toolDef.name,
    { description },
    async (_args: any, extra?: any) => {
      try {
        const augmentedArgs: ToolArgs = {};
        if (extra?._meta) augmentedArgs._meta = extra._meta;
        return await ctx.executeToolWithTracking(toolDef.name, augmentedArgs);
      } catch (error) {
        return handleToolError(toolDef.name, error);
      }
    },
  );

  if (builtTool.execution) {
    const sdkInternalMap = (ctx.server as any).registeredTools;
    if (sdkInternalMap && sdkInternalMap[toolDef.name]) {
      sdkInternalMap[toolDef.name].execution = builtTool.execution;
    }
  }

  return registeredTool;
}
