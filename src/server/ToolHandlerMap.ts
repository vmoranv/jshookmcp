/**
 * Tool handler map — derived from the central registry.
 * Re-exports the registry-based builder for backward compatibility.
 */
import type { ToolHandler } from '@server/types';
import {
  buildHandlerMapFromRegistry,
  getLoadedRegistrations,
  type BuildHandlerMapOptions,
} from '@server/registry/views';
import type { ToolHandlerDeps } from '@server/registry/contracts';

// Backward-compatible alias
export type ToolHandlerMapDependencies = ToolHandlerDeps;

/**
 * Set of all tool names that have handler bindings (derived from registry).
 *
 * Derived from the `registry/views` leaf rather than the `registry/index`
 * barrel: the barrel reaches every domain manifest via discovery →
 * generated-domains, which re-creates the registry↔catalog cycle family this
 * split exists to avoid. `getLoadedRegistrations` throws before `initRegistry`
 * just like the barrel accessor did.
 */
export function getHandledToolNames(): ReadonlySet<string> {
  return new Set(getLoadedRegistrations().map((registration) => registration.tool.name));
}

/**
 * Create a handler map from registry registrations.
 * If selectedToolNames is provided, only those tools get handler entries.
 */
export function createToolHandlerMap(
  deps: ToolHandlerDeps,
  selectedToolNames?: ReadonlySet<string>,
  options?: BuildHandlerMapOptions,
): Record<string, ToolHandler> {
  return buildHandlerMapFromRegistry(deps, selectedToolNames, options);
}
