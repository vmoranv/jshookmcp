/**
 * Domain proxy factory and domain resolution helpers.
 *
 * With the new DomainManifest contract, individual `ensure*Handlers`
 * functions are no longer needed here — each manifest carries its own
 * `ensure(ctx)`. This module now only provides:
 *  - `createDomainProxy`: generic lazy-init proxy (supports sync and async factories)
 *  - `resolveEnabledDomains`: derive enabled domain set from tools
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '@utils/logger';
import { getToolDomain } from '@server/ToolCatalog';
import type { Tool } from '@modelcontextprotocol/server';
import { ToolError } from '@errors/ToolError';
import type { MCPServerContext } from '@server/MCPServer.context';

/**
 * Tracks the chain of domain factories currently executing. AsyncLocalStorage
 * propagates across await points, so an async factory that re-enters a proxy
 * after suspending is still detected. Storing the whole chain (not a boolean)
 * keeps two cases distinct:
 *   - re-entering a domain already on the chain  -> real circular init, throw
 *   - reading an unrelated domain's proxy while  -> wait for its in-flight
 *     another factory runs                          init instead of throwing
 */
const activeFactoryContext = new AsyncLocalStorage<readonly string[]>();

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
  /**
   * True while the factory is executing — for async factories this stays true
   * while the factory is suspended on an await, unlike a plain depth counter
   * whose finally block resets it synchronously.
   */
  let initializing = false;

  function bindPropertyValue(targetInstance: T, prop: PropertyKey): unknown {
    const value = (targetInstance as Record<PropertyKey, unknown>)[prop];
    return typeof value === 'function' ? (value as Function).bind(targetInstance) : value;
  }

  function initialize(): T | Promise<T> {
    if (instance) return instance;

    const factoryChain = activeFactoryContext.getStore();
    if (initializing) {
      if (factoryChain?.includes(domain)) {
        // The factory itself (sync body, or async continuation after an await)
        // re-entered this domain's proxy before init finished — circular
        // dependency. Fail fast instead of dead-locking on a promise that can
        // only resolve once this access returns.
        throw new ToolError(
          'RUNTIME',
          `${label}: circular initialization detected for domain "${domain}"`,
          { details: errorDetails },
        );
      }
      // Concurrent access from OUTSIDE the factory, or from a different
      // domain's factory: wait for the in-flight init.
      return initPromise!;
    }
    if (initPromise) return initPromise;

    logger.info(`Lazy-initializing ${label} for domain "${domain}"`);
    initializing = true;
    let created: T | Promise<T>;
    try {
      const nextChain = [...(factoryChain ?? []), domain];
      created = activeFactoryContext.run(nextChain, () => factory());
    } catch (error) {
      initializing = false;
      throw error;
    }

    if (isPromiseLike(created)) {
      factoryKind = 'async';
      initPromise = Promise.resolve(created).then(
        (resolvedInstance) => {
          initializing = false;
          instance = resolvedInstance;
          return resolvedInstance;
        },
        (error: unknown) => {
          initializing = false;
          throw error;
        },
      );
      // The `get` trap returns an async accessor without awaiting it, so a
      // consumer may read a property and never attach a handler. The rejection
      // is intentionally cached; keep it "handled" to avoid aborting the
      // process with an unhandled rejection.
      void initPromise.catch(() => undefined);
      return initPromise;
    }

    initializing = false;
    factoryKind = 'sync';
    instance = created;
    initPromise = Promise.resolve(created);
    return created;
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
