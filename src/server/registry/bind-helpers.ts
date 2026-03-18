/**
 * Typed helpers for binding tool handlers to the dynamic dependency container.
 *
 * Usage in manifest:
 *   bind: bindByDepKey<MyHandlers>(DEP_KEY, (h, a) => h.handleFoo(a))
 */
import type { ToolArgs } from '@server/types';
import type { ToolHandlerDeps } from '@server/registry/contracts';

/**
 * Retrieve a dependency by key with a runtime guard.
 * The caller specifies the expected type via the generic parameter.
 */
export function getDep<T>(deps: ToolHandlerDeps, key: string): T {
  const value = deps[key];
  if (!value) {
    throw new Error(`[registry] Missing dependency: "${key}". Is the domain enabled?`);
  }
  return value as T;
}

/**
 * Create a `bind` function that extracts the handler from `deps[depKey]`
 * and delegates to `invoke(handler, args)`.
 *
 * This preserves full type safety within each manifest while the global
 * deps container stays dynamically keyed.
 */
export function bindByDepKey<THandler>(
  depKey: string,
  invoke: (handler: THandler, args: ToolArgs) => Promise<unknown>
): (deps: ToolHandlerDeps) => (args: ToolArgs) => Promise<unknown> {
  return (deps) => (args) => invoke(getDep<THandler>(deps, depKey), args);
}
