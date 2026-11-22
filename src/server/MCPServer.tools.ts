import { ProtocolError, fromJsonSchema } from '@modelcontextprotocol/server';
import type { McpServer, RegisteredTool, Tool } from '@modelcontextprotocol/server';
import { ZodError, z } from 'zod';
import { logger } from '@utils/logger';
import { ToolError } from '@errors/ToolError';
import type { ToolArgs, ToolResponse } from '@server/types';
import { buildZodShape } from '@server/MCPServer.schema';
import type { MCPServerContext } from '@server/MCPServer.context';
import { attachToolRequestMeta } from '@server/runtime/tool-request-meta';
import {
  runWithToolRequestContext,
  type ToolRequestExtra,
} from '@server/runtime/ToolRequestContext';
import { asToolResponse } from '@server/domains/shared/response';
import { R } from '@server/domains/shared/ResponseBuilder';

/**
 * Convert a thrown handler error into a tool result.
 *
 * MCP separates two failure planes (Tools spec, "Error Handling"):
 *  - Protocol errors — unknown method, malformed request — stay JSON-RPC errors.
 *  - Tool execution errors — including invalid arguments — are returned as a
 *    result with `isError: true`, so the model can see the failure and
 *    self-correct. 2025-11-25 (SEP-1303) made the invalid-argument case
 *    explicit.
 *
 * Only `ProtocolError` is protocol-level here. Everything else is a failed
 * call and must not be dressed up as a protocol fault.
 */
function toToolErrorResponse(toolName: string, error: unknown): ToolResponse {
  if (error instanceof ProtocolError) {
    throw error;
  }

  if (error instanceof ZodError) {
    logger.error(`Tool validation failed: ${toolName}`, error);
    // Attach the code to a plain Error: `R.fail` only reads `.code`, and this
    // keeps the mapper independent of the ToolError constructor signature.
    const validationError = Object.assign(
      new Error(`Validation Error in ${toolName}: ${error.message}`),
      { code: 'VALIDATION' as const },
    );
    return R.fail(validationError).json();
  }

  if (error instanceof ToolError) {
    logger.error(`Tool execution failed [${error.code}]: ${toolName} - ${error.message}`);
    const builder = R.fail(error);
    if (error.details) builder.set('details', error.details);
    return builder.json();
  }

  logger.error(`Tool execution failed: ${toolName}`, error);
  const message = error instanceof Error ? error.message : String(error);
  const runtimeError = Object.assign(new Error(`Execution Failed in ${toolName}: ${message}`), {
    code: 'RUNTIME' as const,
  });
  return R.fail(runtimeError).json();
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

/** Minimal surface of the SDK's inner `Server` that the cache installer reaches into. */
interface SdkServerInternals {
  _requestHandlers?: Map<string, (request: unknown, extra?: unknown) => unknown>;
  setRequestHandler(schema: unknown, handler: (request: unknown, extra?: unknown) => unknown): void;
}

/** Servers that already have a cached tools/list handler installed. */
const installedCachedListHandlers = new WeakSet<object>();

/**
 * Install a memoized tools/list handler that reuses the serialized tool list
 * until the tool set mutates.
 *
 * The MCP SDK's built-in tools/list handler re-serializes every registered
 * tool's Zod schema into JSON Schema on each call — ~370KB across 711 tools,
 * ~55ms CPU per list. The serialized result only changes when a tool is
 * registered / updated / removed, so caching it collapses repeat lists to a
 * single serialization.
 *
 * Invalidation signal: the SDK calls `sendToolListChanged()` on every
 * register/update/remove/enable/disable, so wrapping it captures every mutation
 * in one place without touching individual registration call sites.
 *
 * Idempotent per server; a no-op when the SDK handler is not yet registered
 * (it is installed lazily on first `registerTool`, so `registerSingleTool` calls
 * this after registration).
 */
export function installCachedToolListHandler(server: McpServer): void {
  if (installedCachedListHandlers.has(server)) return;

  const inner = (server as unknown as { server: SdkServerInternals }).server;
  const original = inner?.['_requestHandlers']?.get('tools/list');
  if (typeof original !== 'function') return; // SDK internals changed — keep default.

  installedCachedListHandlers.add(server);

  let version = 0;
  let cached: { tools: unknown[] } | null = null;
  let cachedVersion = -1;

  const originalSend = server.sendToolListChanged.bind(server);
  server.sendToolListChanged = () => {
    version += 1;
    originalSend();
  };

  inner.setRequestHandler('tools/list', async (request, ctx) => {
    if (cached === null || version !== cachedVersion) {
      // ctx is forwarded opaquely to the SDK's own tools/list handler — both
      // sides share the v2 ServerContext shape, so no property access here.
      cached = (await original(request, ctx)) as { tools: unknown[] };
      cachedVersion = version;
    }
    return cached;
  });
}

export function registerSingleTool(
  ctx: MCPServerContext,
  toolDef: Tool,
  options?: { isModern?: boolean },
): RegisteredTool {
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
  const registrationMetadata = {
    ...(toolDef.annotations ? { annotations: toolDef.annotations } : {}),
    ...(builtTool.outputSchema
      ? { outputSchema: fromJsonSchema(builtTool.outputSchema as any) }
      : {}),
  };

  if (Object.keys(shape).length > 0) {
    const registeredTool = ctx.server.registerTool(
      toolDef.name,
      {
        description,
        inputSchema: shape as unknown as Record<string, z.ZodType>,
        ...registrationMetadata,
      },
      // Param is named `extra` (not v2's `ctx`) on purpose: the surrounding
      // scope already binds `ctx` to the MCPServerContext. ToolRequestExtra is
      // a structural subset of the v2 ServerContext, so the shape is correct.
      async (args: ToolArgs, extra?: ToolRequestExtra) => {
        return runWithToolRequestContext(
          extra,
          async () => {
            try {
              const augmentedArgs = attachToolRequestMeta(args, extra);
              // If taskStore is provided (SDK handles polling), we can use it internally if needed
              return asToolResponse(await ctx.executeToolWithTracking(toolDef.name, augmentedArgs));
            } catch (error) {
              return toToolErrorResponse(toolDef.name, error);
            }
          },
          options,
        );
      },
    );

    if (builtTool.execution) {
      const sdkInternalMap = (ctx.server as any).registeredTools;
      if (sdkInternalMap && sdkInternalMap[toolDef.name]) {
        sdkInternalMap[toolDef.name].execution = builtTool.execution;
      }
    }

    installCachedToolListHandler(ctx.server);

    return registeredTool;
  }

  const registeredTool = ctx.server.registerTool(
    toolDef.name,
    { description, ...registrationMetadata },
    async (_args: unknown, extra?: ToolRequestExtra) => {
      return runWithToolRequestContext(
        extra,
        async () => {
          try {
            const augmentedArgs = attachToolRequestMeta({}, extra);
            return asToolResponse(await ctx.executeToolWithTracking(toolDef.name, augmentedArgs));
          } catch (error) {
            return toToolErrorResponse(toolDef.name, error);
          }
        },
        options,
      );
    },
  );

  if (builtTool.execution) {
    const sdkInternalMap = (ctx.server as any).registeredTools;
    if (sdkInternalMap && sdkInternalMap[toolDef.name]) {
      sdkInternalMap[toolDef.name].execution = builtTool.execution;
    }
  }

  installCachedToolListHandler(ctx.server);

  return registeredTool;
}
