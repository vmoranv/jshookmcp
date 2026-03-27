/**
 * Domain proxy factory and domain resolution helpers.
 *
 * With the new DomainManifest contract, individual `ensure*Handlers`
 * functions are no longer needed here — each manifest carries its own
 * `ensure(ctx)`. This module now only provides:
 *  - `createDomainProxy`: generic lazy-init proxy (supports sync and async factories)
 *  - `resolveEnabledDomains`: derive enabled domain set from tools
 */
import { logger } from '@utils/logger';
import { getToolDomain } from '@server/ToolCatalog';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolError } from '@errors/ToolError';
import type { MCPServerContext } from '@server/MCPServer.context';

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

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

/**
 * Creates a lazy-init domain proxy that supports both sync and async factories.
 *
 * Key design:
 * - Sync factories: property access stays synchronous after first read.
 * - Async factories: property access remains awaitable until the instance resolves.
 * - Concurrent access during init is safe — the shared promise prevents duplication.
 * - Circular init detection works by tracking factory-call depth.
 */
export function createDomainProxy<T extends object>(
  ctx: MCPServerContext,
  domain: string,
  label: string,
  factory: () => T | Promise<T>,
): T {
  type PropertyKey = string | symbol;

  const errorDetails = { domain, label };
  let initPromise: Promise<T> | undefined;
  let instance: T | undefined;
  let factoryKind: 'unknown' | 'sync' | 'async' = 'unknown';
  let factoryDepth = 0; // Tracks nested factory calls for circular init detection

  function bindPropertyValue(targetInstance: T, prop: PropertyKey): unknown {
    const value = (targetInstance as Record<PropertyKey, unknown>)[prop];
    return typeof value === 'function' ? (value as Function).bind(targetInstance) : value;
  }

  function initialize(): T | Promise<T> {
    if (instance) return instance;
    if (initPromise) return initPromise;

    // Circular init guard: if the factory itself tries to access this proxy
    // before it returns an instance or promise, fail fast.
    if (factoryDepth > 0) {
      throw new ToolError(
        'RUNTIME',
        `${label}: circular initialization detected for domain "${domain}"`,
        { details: errorDetails },
      );
    }

    logger.info(`Lazy-initializing ${label} for domain "${domain}"`);
    factoryDepth++;
    try {
      const created = factory();
      if (isPromiseLike(created)) {
        factoryKind = 'async';
        initPromise = Promise.resolve(created).then((resolvedInstance) => {
          instance = resolvedInstance;
          return resolvedInstance;
        });
        return initPromise;
      }

      factoryKind = 'sync';
      instance = created;
      initPromise = Promise.resolve(created);
      return created;
    } finally {
      factoryDepth--;
    }
  }

  async function getOrCreateInstance(): Promise<T> {
    const created = initialize();
    return isPromiseLike(created) ? await created : created;
  }

  function createAsyncPropertyAccessor(prop: PropertyKey): unknown {
    const resolveProperty = () =>
      getOrCreateInstance().then((resolvedInstance) => bindPropertyValue(resolvedInstance, prop));

    const accessor = (...args: unknown[]) =>
      getOrCreateInstance().then((resolvedInstance) => {
        const value = (resolvedInstance as Record<PropertyKey, unknown>)[prop];
        if (typeof value === 'function') {
          return (value as Function).call(resolvedInstance, ...args);
        }
        return value;
      });

    return new Proxy(accessor, {
      get: (target, asyncProp, receiver) => {
        if (asyncProp === 'then') {
          return (...args: Parameters<Promise<unknown>['then']>) => resolveProperty().then(...args);
        }

        if (asyncProp === 'catch') {
          return (...args: Parameters<Promise<unknown>['catch']>) =>
            resolveProperty().catch(...args);
        }

        if (asyncProp === 'finally') {
          return (...args: Parameters<Promise<unknown>['finally']>) =>
            resolveProperty().finally(...args);
        }

        return Reflect.get(target, asyncProp, receiver);
      },
    });
  }

  return new Proxy({} as T, {
    get: (_target, prop) => {
      if (!ctx.enabledDomains.has(domain)) {
        return () => {
          throw new ToolError(
            'PREREQUISITE',
            `${label} is unavailable: domain "${domain}" not enabled by current tool profile`,
            { details: errorDetails },
          );
        };
      }

      if (prop === 'then' || prop === 'catch' || prop === Symbol.toStringTag) {
        return undefined;
      }

      if (instance && factoryKind === 'sync') {
        return bindPropertyValue(instance, prop);
      }

      const created = initialize();
      if (isPromiseLike(created)) {
        return createAsyncPropertyAccessor(prop);
      }

      return bindPropertyValue(created, prop);
    },
  });
}
