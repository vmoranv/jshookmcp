import type { EventBus, ServerEventMap } from '@server/EventBus';
import type { LLMSamplingBridge } from '@server/LLMSamplingBridge';

/**
 * Stable, process-level runtime core injected into `ToolHandlerDeps` under the
 * reserved `__runtimeCore` key by `MCPServer.initDomainProxies()`.
 *
 * Domain bind closures read `eventBus` / `samplingBridge` from here instead of
 * from a module-level `globalContext`. Because the reference is assigned once
 * at construction and never reassigned, concurrent modern (`/mcp/v2`) requests
 * share the correct core without racing on "last ensure() wins" mutable state.
 *
 * The structural type keeps this leaf module independent of the full
 * `MCPServerContext` import graph (avoids re-creating registry cycles).
 */
export interface RuntimeCoreRef {
  readonly eventBus: EventBus<ServerEventMap>;
  readonly samplingBridge: LLMSamplingBridge;
}

const RUNTIME_CORE_KEY = '__runtimeCore' as const;

/** Recover the injected runtime core from a manifest's `deps` bag. */
export function getRuntimeCore(deps: Record<string, unknown>): RuntimeCoreRef | null {
  const core = deps[RUNTIME_CORE_KEY] as RuntimeCoreRef | undefined;
  if (core && typeof core.eventBus?.emit === 'function') {
    return core;
  }
  return null;
}
