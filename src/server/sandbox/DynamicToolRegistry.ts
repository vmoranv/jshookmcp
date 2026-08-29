/**
 * DynamicToolRegistry — Allows sandbox scripts to register custom tools at runtime.
 *
 * Dynamic tools get a `sandbox_` prefix to prevent collisions with built-in tools.
 * They are session-scoped and appear in the search index for discoverability.
 *
 * Every registration is mirrored to the MCP server via registerSingleTool();
 * unregistration and clearAll() must remove that server-side registration too,
 * otherwise the tool stays listed in tools/list while its handler is gone.
 * Mutations are serialized through a promise-chain mutex so concurrent sandbox
 * sessions cannot interleave map and MCP-server state.
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { RegisteredTool, Tool } from '@modelcontextprotocol/server';
import { logger } from '@utils/logger';
import { deactivateToolCore } from '@server/tool-lifecycle';

export interface DynamicToolEntry {
  name: string;
  prefixedName: string;
  description: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  /** MCP server registration handle — required to unregister from the server. */
  registeredTool?: RegisteredTool;
}

const DYNAMIC_PREFIX = 'sandbox_';

export class DynamicToolRegistry {
  private readonly ctx: MCPServerContext;
  private readonly tools = new Map<string, DynamicToolEntry>();
  /**
   * Promise-chain mutex: register/unregister/clearAll run one at a time so a
   * concurrent clearAll can never race a half-finished registration.
   */
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(ctx: MCPServerContext) {
    this.ctx = ctx;
  }

  private withMutex<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Register a tool created by sandbox code.
   * Name is automatically prefixed with `sandbox_`.
   */
  registerDynamicTool(
    name: string,
    description: string,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): Promise<string> {
    return this.withMutex(() => {
      const prefixedName = `${DYNAMIC_PREFIX}${name}`;

      // Register with MCP server's tool system first, then record the entry so
      // unregister can remove the server-side registration.
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
      const registeredTool = this.ctx.registerSingleTool(toolDef);

      const entry: DynamicToolEntry = {
        name,
        prefixedName,
        description,
        handler,
        registeredTool,
      };
      this.tools.set(prefixedName, entry);

      return prefixedName;
    });
  }

  /**
   * Unregister a dynamic tool by its prefixed name — both the local map entry
   * and the MCP server registration.
   */
  unregisterDynamicTool(prefixedName: string): Promise<boolean> {
    return this.withMutex(() => {
      const entry = this.tools.get(prefixedName);
      if (!entry) return false;
      this.unregisterEntry(entry);
      return true;
    });
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
   * Clear all dynamic tools (session end or server shutdown), unregistering
   * each one from the MCP server as well.
   */
  clearAll(): Promise<void> {
    return this.withMutex(() => {
      // Iterate a snapshot so unregisterEntry's map mutations do not skip entries.
      for (const entry of Array.from(this.tools.values())) {
        this.unregisterEntry(entry);
      }
    });
  }

  private unregisterEntry(entry: DynamicToolEntry): void {
    if (entry.registeredTool) {
      try {
        entry.registeredTool.remove();
      } catch (error) {
        logger.warn(
          `Failed to remove dynamic tool "${entry.prefixedName}" from MCP server:`,
          error,
        );
      }
    }
    // Clear any routing/activation state that may reference the tool.
    if (this.ctx.router && this.ctx.activatedToolNames && this.ctx.activatedRegisteredTools) {
      deactivateToolCore(entry.prefixedName, {
        activatedToolNames: this.ctx.activatedToolNames,
        activatedRegisteredTools: this.ctx.activatedRegisteredTools,
        router: this.ctx.router,
        extensionToolsByName: this.ctx.extensionToolsByName,
      });
    }
    this.tools.delete(entry.prefixedName);
  }
}
