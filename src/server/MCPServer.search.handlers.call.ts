/**
 * Handler for the call_tool proxy meta-tool.
 *
 * Bridges the gap for MCP clients that do not support `tools/list_changed`
 * notifications. After activate_tools / activate_domain registers a tool
 * server-side, such clients still cannot see it in their cached tool list.
 * call_tool lets them invoke any catalogued tool by name + args, with
 * automatic on-demand activation when the tool is not yet registered.
 */
import { logger } from '@utils/logger';
import { asTextResponse } from '@server/domains/shared/response';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { normalizeToolName } from '@server/MCPServer.search.validation';
import { getSearchEngine } from '@server/MCPServer.search.helpers';
import { getToolInputSchema } from '@server/ToolRouter.probe';
import { validateToolArgsAgainstSchema } from '@server/MCPServer.search.validation.runtime';

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

export async function handleCallTool(
  ctx: MCPServerContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
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
  // Accept three argument formats:
  // 1. { args: { ... } }                — schema-defined name
  // 2. { parameters: "{...}" }          — JSON-serialized string (some MCP clients)
  // 3. { arguments: "{...}" }           — MCP clients that stringify the wrapper
  // 4. { url: ..., method: ... }        — spread flat (params are top-level keys, no wrapper)
  let toolArgs: Record<string, unknown> = {};
  const rawArgs =
    args.args ?? args.parameters ?? (typeof args.arguments === 'string' ? args.arguments : null);
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    toolArgs = rawArgs as Record<string, unknown>;
  } else if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawArgs);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        toolArgs = parsed as Record<string, unknown>;
      }
    } catch {
      /* malformed JSON — fall through to Format 4 */
    }
  }

  // Format 4 (spread flat): only when neither args, parameters, nor arguments was
  // provided, and no wrapper was successfully parsed — collect remaining keys as tool arguments.
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

  const callMetadata = defaultMetadata;

  // Auto-activate the tool if it's known but not yet registered.
  // This bridges the gap for MCP clients that cannot see tools/list_changed
  // and for search-tier sessions where the tool was discovered via search_tools
  // but not yet activated (e.g., when search returned 0 results and domain
  // fallback activation was triggered).
  if (!ctx.router.has(name)) {
    const { ensureAllDomainsLoaded } = await import('@server/registry/index');
    await ensureAllDomainsLoaded();

    // Check if the tool exists in the catalog
    const { getToolByName } = await import('@server/MCPServer.search.helpers');
    const toolMap = await getToolByName(ctx);
    const toolDef = toolMap.get(name);

    if (toolDef) {
      // Auto-activate the tool and its domain
      const { activateToolNames } = await import('@server/MCPServer.search.handlers.activate');
      const { getToolDomain } = await import('@server/ToolCatalog');
      const domain = getToolDomain(name);
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
        await activateToolNames(ctx, [name]);
      }
      callMetadata.wasAutoActivated = true;
      callMetadata.activatedTools = [name];
    } else {
      return asTextResponse(
        JSON.stringify({
          success: false,
          error:
            `Tool "${name}" is not currently active and was not found in the tool catalog. ` +
            `Use search_tools to discover available tools, then call_tool to invoke them.`,
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

    // Record feedback for vector weight tuning (Phase 8)
    try {
      const engine = await getSearchEngine(ctx);
      engine.recordToolCallFeedback(name, '');
    } catch {
      /* non-critical — ignore feedback errors */
    }

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
