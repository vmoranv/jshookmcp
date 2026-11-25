import { McpServer } from '@modelcontextprotocol/server';
import type { McpRequestContext } from '@modelcontextprotocol/server';
import type { MCPServerContext } from '@server/MCPServer.context';
import { registerSingleTool as registerSingleToolImpl } from '@server/MCPServer.tools';
import { registerSearchMetaTools } from '@server/MCPServer.search';
import { registerServerResources } from '@server/MCPServer.resources';
import { registerServerPrompts } from '@server/MCPServer.prompts';
import { TaskStoreAdapter } from '@server/tasks/TaskStoreAdapter';

/**
 * Build the per-request SDK server used by the MCP 2.0 HTTP handler.
 *
 * The process-level MCPServer remains the owner of runtime state and domain
 * instances. This facade only swaps the SDK server object while forwarding
 * business methods and state reads to the shared core. Consequently the SDK
 * can safely close the request server without shutting down the application.
 */
export function createModernMcpServer(
  core: MCPServerContext,
  request: McpRequestContext,
): McpServer {
  const server = new McpServer(
    { name: core.config.mcp.name, version: core.config.mcp.version },
    {
      capabilities: {
        tools: { listChanged: true },
        // `logging` is intentionally NOT advertised here: the structured log
        // transport is attached to the legacy shell only, so the modern leg
        // would accept `logging/setLevel` and never emit notifications.
        completions: {},
        prompts: { listChanged: true },
        // Advertised only because the handler is installed right below;
        // without the adapter `tasks/list`/`tasks/cancel` are Method not found.
        tasks: { list: {}, cancel: {} },
      },
    },
  );
  new TaskStoreAdapter(core.taskManager).install(server.server);

  // Keep protocol bookkeeping local to this request. Domain instances and
  // execution managers remain shared, but activation/list metadata must not
  // leak between concurrent modern exchanges.
  const requestState = {
    activatedToolNames: new Set(core.activatedToolNames),
    activatedRegisteredTools: new Map(core.activatedRegisteredTools),
    domainTtlEntries: new Map(core.domainTtlEntries),
    metaToolsByName: new Map(core.metaToolsByName),
    toolAutocompleteHandlers: new Map(core.toolAutocompleteHandlers),
    enabledDomains: new Set(core.enabledDomains),
  };

  const facade = new Proxy(core, {
    get(target, property, receiver) {
      if (property === 'server') return server;
      if (property in requestState) {
        return requestState[property as keyof typeof requestState];
      }
      // Meta-tools can activate additional tools. Ensure those registrations
      // stay on this request server instead of mutating the legacy singleton.
      if (property === 'registerSingleTool') {
        return (toolDef: Parameters<typeof registerSingleToolImpl>[1]) =>
          registerSingleToolImpl(facade, toolDef, { isModern: true });
      }
      const value = Reflect.get(target, property, receiver);
      // Bind to the proxy, not the shared core: method bodies read per-request
      // state through `this` (activatedToolNames, enabledDomains, ...), and
      // binding to the core would let them operate on process-level state.
      return typeof value === 'function' ? value.bind(receiver) : value;
    },
    // Assignments/deletes to copied keys must land in the request-local state
    // instead of falling through to the shared core.
    set(target, property, value, receiver) {
      if (property in requestState) {
        (requestState as unknown as Record<PropertyKey, unknown>)[property] = value;
        return true;
      }
      return Reflect.set(target, property, value, receiver);
    },
    deleteProperty(target, property) {
      if (property in requestState) {
        return delete (requestState as unknown as Record<PropertyKey, unknown>)[property];
      }
      return Reflect.deleteProperty(target, property);
    },
  }) as MCPServerContext;

  // The era is intentionally consumed here so factories can evolve without
  // changing the registration contract. Modern and legacy tool surfaces are
  // currently identical; request-scoped metadata is attached by handlers.
  void request.era;

  for (const toolDef of core.selectedTools) {
    registerSingleToolImpl(facade, toolDef, { isModern: true });
  }
  registerSearchMetaTools(facade, { isModern: true });
  registerServerResources(facade);
  registerServerPrompts(facade);

  return server;
}
