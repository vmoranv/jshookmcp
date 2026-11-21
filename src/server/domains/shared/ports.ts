/**
 * Narrow domain ports.
 *
 * Domains should depend on the handful of capabilities they actually use, not
 * the full MCPServerContext. These factories adapt the context once at the
 * manifest boundary; handler constructors can then accept a small interface.
 */
import type { CodeCollector } from '@modules/collector/CodeCollector';
import type { MCPServerContext } from '@server/MCPServer.context';

export interface BrowserResponseBody {
  body: string;
  base64Encoded: boolean;
}

/** Collector + optional response-body lookup used by encoding/transform tools. */
export interface BrowserAccessPort {
  readonly collector: CodeCollector;
  getResponseBody(requestId: string): Promise<BrowserResponseBody | null>;
}

/** Extension lifecycle surface used by maintenance tools. */
export type ExtensionManagementPort = Pick<
  MCPServerContext,
  'listExtensions' | 'reloadExtensions' | 'extensionToolsByName'
>;

/** Sandbox host surface: tool discovery + tracked execution only. */
export type SandboxDomainPort = Pick<MCPServerContext, 'selectedTools' | 'executeToolWithTracking'>;

export function createBrowserAccessPort(ctx: MCPServerContext): BrowserAccessPort {
  if (!ctx.collector) {
    throw new Error('Browser collector is not available for this profile');
  }
  return {
    collector: ctx.collector,
    getResponseBody: async (requestId) =>
      (await ctx.consoleMonitor?.getResponseBody(requestId)) ?? null,
  };
}
