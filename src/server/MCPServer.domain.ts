/**
 * Domain proxy factory and domain resolution helpers.
 *
 * With the new DomainManifest contract, individual `ensure*Handlers`
 * functions are no longer needed here — each manifest carries its own
 * `ensure(ctx)`. This module now only provides:
 *  - `createDomainProxy`: generic lazy-init proxy
 *  - `resolveEnabledDomains`: derive enabled domain set from tools
 */
import { logger } from '@utils/logger';
import { getToolDomain } from '@server/ToolCatalog';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolError } from '@errors/ToolError';
import type { MCPServerContext } from '@server/MCPServer.context';

export function resolveEnabledDomains(tools: Tool[]): Set<string> {
  const domains = new Set<string>();
  for (const tool of tools) {
    const domain = getToolDomain(tool.name);
    if (domain) {
      domains.add(domain);
    }
  }
  return domains;
}

export function createDomainProxy<T extends object>(
  ctx: MCPServerContext,
  domain: string,
  label: string,
  factory: () => T
): T {
  let instance: T | undefined;
  let initializing = false;
  return new Proxy({} as T, {
    get: (_target, prop) => {
      if (!ctx.enabledDomains.has(domain)) {
        return () => {
          throw new ToolError(
            'PREREQUISITE',
            `${label} is unavailable: domain "${domain}" not enabled by current tool profile`,
            { details: { domain, label } }
          );
        };
      }

      if (!instance) {
        if (initializing) {
          throw new ToolError('RUNTIME', `${label}: circular initialization detected for domain "${domain}"`, { details: { domain, label } });
        }
        initializing = true;
        try {
          logger.info(`Lazy-initializing ${label} for domain "${domain}"`);
          instance = factory();
        } finally {
          initializing = false;
        }
      }

      const value = (instance as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? (value as Function).bind(instance) : value;
    },
  });
}
