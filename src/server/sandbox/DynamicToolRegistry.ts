/**
 * DynamicToolRegistry — Allows sandbox scripts to register custom tools at runtime.
 *
 * Dynamic tools get a `sandbox_` prefix to prevent collisions with built-in tools.
 * They are session-scoped and appear in the search index for discoverability.
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface DynamicToolEntry {
  name: string;
  prefixedName: string;
  description: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const DYNAMIC_PREFIX = 'sandbox_';

export class DynamicToolRegistry {
  private readonly ctx: MCPServerContext;
  private readonly tools = new Map<string, DynamicToolEntry>();

  constructor(ctx: MCPServerContext) {
    this.ctx = ctx;
  }

  /**
   * Register a tool created by sandbox code.
   * Name is automatically prefixed with `sandbox_`.
   */
  registerDynamicTool(
    name: string,
    description: string,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ): string {
    const prefixedName = `${DYNAMIC_PREFIX}${name}`;

    const entry: DynamicToolEntry = {
      name,
      prefixedName,
      description,
      handler,
    };

    this.tools.set(prefixedName, entry);

    // Register with MCP server's tool system
    const toolDef: Tool = {
      name: prefixedName,
      description: `[Sandbox] ${description}`,
      inputSchema: {
        type: 'object',
        properties: {
          args: {
            type: 'object',
            description: 'Arguments to pass to the dynamic tool.',
          },
        },
        required: [],
      },
    };
    this.ctx.registerSingleTool(toolDef);

    return prefixedName;
  }

  /**
   * Unregister a dynamic tool by its prefixed name.
   */
  unregisterDynamicTool(prefixedName: string): boolean {
    return this.tools.delete(prefixedName);
  }

  /**
   * List all registered dynamic tools.
   */
  listDynamicTools(): DynamicToolEntry[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a dynamic tool's handler by prefixed name.
   */
  getHandler(prefixedName: string): DynamicToolEntry | undefined {
    return this.tools.get(prefixedName);
  }

  /**
   * Clear all dynamic tools (session end or server shutdown).
   */
  clearAll(): void {
    this.tools.clear();
  }
}
