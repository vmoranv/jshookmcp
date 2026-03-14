/**
 * Handlers for extensions_reload and extensions_list meta-tools.
 */
import { asTextResponse } from '@server/domains/shared/response';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';

export async function handleExtensionsReload(ctx: MCPServerContext): Promise<ToolResponse> {
  const result = await ctx.reloadExtensions();
  return asTextResponse(JSON.stringify(result, null, 2));
}

export async function handleExtensionsList(ctx: MCPServerContext): Promise<ToolResponse> {
  const result = ctx.listExtensions();
  return asTextResponse(JSON.stringify(result, null, 2));
}
