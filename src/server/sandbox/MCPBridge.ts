/**
 * MCPBridge — Allows sandboxed scripts to invoke host MCP tools.
 *
 * The bridge wraps `executeToolWithTracking` and is injected as the
 * `mcp` global inside QuickJS.  It validates tool names against the
 * registered tool set before dispatching, preventing arbitrary
 * function calls from the sandbox.
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';

export class MCPBridge {
  private readonly ctx: MCPServerContext;
  private allowlist: Set<string> | null = null;

  constructor(ctx: MCPServerContext) {
    this.ctx = ctx;
  }

  /**
   * Restrict callable tools to a specific set.
   * Pass `null` to allow all registered tools (default).
   */
  setAllowlist(toolNames: string[] | null): void {
    this.allowlist = toolNames ? new Set(toolNames) : null;
  }

  /**
   * Call a registered MCP tool by name.
   *
   * @throws Error if tool does not exist or is not in the allowlist.
   */
  async call(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    // Validate against allowlist
    if (this.allowlist && !this.allowlist.has(toolName)) {
      throw new Error(`Tool "${toolName}" is not in the sandbox allowlist`);
    }

    // Validate tool exists in the registered set
    const available = this.listAvailableTools();
    if (!available.includes(toolName)) {
      throw new Error(`Tool "${toolName}" is not a registered MCP tool`);
    }

    const response: ToolResponse = await this.ctx.executeToolWithTracking(toolName, args);

    // Extract content from the MCP response wrapper
    if (response.content && Array.isArray(response.content)) {
      const textParts: string[] = [];
      for (const item of response.content) {
        if (item.type === 'text') {
          textParts.push(item.text);
        }
      }
      const combined = textParts.join('\n');

      // Try to parse as JSON for structured results
      try {
        return JSON.parse(combined);
      } catch {
        return combined;
      }
    }

    return response;
  }

  /**
   * Return the names of all tools callable from the sandbox.
   */
  listAvailableTools(): string[] {
    const allTools = this.ctx.selectedTools.map((t) => t.name);
    if (this.allowlist) {
      return allTools.filter((n) => this.allowlist!.has(n));
    }
    return allTools;
  }
}
