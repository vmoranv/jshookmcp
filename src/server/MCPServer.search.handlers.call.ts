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
  const toolArgs =
    args.args && typeof args.args === 'object' && !Array.isArray(args.args)
      ? (args.args as Record<string, unknown>)
      : {};

  let callMetadata = defaultMetadata;

  // SECURITY: Do NOT auto-activate tools. Require explicit activation first.
  // Auto-activation bypassed schema validation and the tool registration safety gate.
  if (!ctx.router.has(name)) {
    return asTextResponse(
      JSON.stringify({
        success: false,
        error: `Tool "${name}" is not currently active. Use activate_tools or activate_domain first, then call it directly.`,
        ...callMetadata,
      }),
    );
  }

  // Dispatch to the actual tool handler via executeToolWithTracking
  try {
    const response = await ctx.executeToolWithTracking(name, toolArgs);

    // Record feedback for vector weight tuning (Phase 8)
    try {
      const engine = getSearchEngine(ctx);
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
