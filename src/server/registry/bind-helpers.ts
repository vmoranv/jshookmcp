/**
 * Typed helpers for binding tool handlers to the dynamic dependency container.
 *
 * Usage in manifest:
 *   bind: bindByDepKey<MyHandlers>(DEP_KEY, (h, a) => h.handleFoo(a))
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolArgs } from '@server/types';
import type { ToolHandlerDeps, ToolProfileId, ToolRegistration } from '@server/registry/contracts';

type HandlerFunctionName<THandler> = {
  [K in keyof THandler]-?: THandler[K] extends (...args: any[]) => unknown ? K : never;
}[keyof THandler] &
  string;

type DirectHandlerMethodName<THandler> = {
  [K in keyof THandler]-?: THandler[K] extends (...args: infer TArgs) => unknown
    ? TArgs extends [] | [ToolArgs]
      ? K
      : never
    : never;
}[keyof THandler] &
  string;

type HandlerMethodArgs<
  THandler,
  TMethod extends HandlerFunctionName<THandler>,
> = THandler[TMethod] extends (...args: infer TArgs) => unknown ? TArgs : never;

type WrapResultOption = {
  readonly profiles?: readonly ToolProfileId[];
  readonly wrapResult?: (result: unknown) => unknown | Promise<unknown>;
};

type DirectMethodRegistrationSpec<THandler, TToolName extends string> = {
  [K in DirectHandlerMethodName<THandler>]: {
    readonly tool: TToolName;
    readonly method: K;
    readonly profiles?: readonly ToolProfileId[];
  };
}[DirectHandlerMethodName<THandler>];

type MappedMethodRegistrationSpec<THandler, TToolName extends string> = {
  [K in HandlerFunctionName<THandler>]: {
    readonly tool: TToolName;
    readonly method: K;
    readonly profiles?: readonly ToolProfileId[];
    readonly mapArgs: (args: ToolArgs) => HandlerMethodArgs<THandler, K>;
  };
}[HandlerFunctionName<THandler>];

type MethodRegistrationSpec<THandler, TToolName extends string> =
  | DirectMethodRegistrationSpec<THandler, TToolName>
  | MappedMethodRegistrationSpec<THandler, TToolName>;

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
  invoke: (handler: THandler, args: ToolArgs) => Promise<unknown>,
): (deps: ToolHandlerDeps) => (args: ToolArgs) => Promise<unknown> {
  return (deps) => (args) => invoke(getDep<THandler>(deps, depKey), args);
}

export function bindMethodByDepKey<THandler, TMethod extends DirectHandlerMethodName<THandler>>(
  depKey: string,
  method: TMethod,
  options?: WrapResultOption,
): (deps: ToolHandlerDeps) => (args: ToolArgs) => Promise<unknown>;
export function bindMethodByDepKey<THandler, TMethod extends HandlerFunctionName<THandler>>(
  depKey: string,
  method: TMethod,
  options: WrapResultOption & {
    readonly mapArgs: (args: ToolArgs) => HandlerMethodArgs<THandler, TMethod>;
  },
): (deps: ToolHandlerDeps) => (args: ToolArgs) => Promise<unknown>;
export function bindMethodByDepKey<THandler, TMethod extends HandlerFunctionName<THandler>>(
  depKey: string,
  method: TMethod,
  options?: WrapResultOption & {
    readonly mapArgs?: (args: ToolArgs) => HandlerMethodArgs<THandler, TMethod>;
  },
): (deps: ToolHandlerDeps) => (args: ToolArgs) => Promise<unknown> {
  return bindByDepKey<THandler>(depKey, async (handler, args) => {
    const invoke = handler[method] as unknown as (...callArgs: unknown[]) => unknown;
    const callArgs = options?.mapArgs ? options.mapArgs(args) : [args];
    const result = await invoke.apply(handler, callArgs);
    return options?.wrapResult ? options.wrapResult(result) : result;
  });
}

export function defineMethodRegistrations<THandler, TToolName extends string>(options: {
  readonly domain: string;
  readonly depKey: string;
  readonly lookup: (name: TToolName) => Tool;
  readonly entries: readonly MethodRegistrationSpec<THandler, TToolName>[];
  readonly wrapResult?: (result: unknown) => unknown | Promise<unknown>;
}): ToolRegistration[] {
  const { domain, depKey, lookup, entries, wrapResult } = options;
  return entries.map((entry) => ({
    tool: lookup(entry.tool),
    domain,
    ...(entry.profiles ? { profiles: entry.profiles } : {}),
    bind:
      'mapArgs' in entry
        ? bindMethodByDepKey<THandler, typeof entry.method>(depKey, entry.method, {
            wrapResult,
            mapArgs: entry.mapArgs,
          })
        : bindMethodByDepKey<THandler, typeof entry.method>(depKey, entry.method, {
            wrapResult,
          }),
  }));
}
