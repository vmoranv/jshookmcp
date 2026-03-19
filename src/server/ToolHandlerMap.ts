/**
 * Tool handler map — derived from the central registry.
 * Re-exports the registry-based builder for backward compatibility.
 */
import type { ToolHandler } from '@server/types';
import { buildHandlerMapFromRegistry, getAllToolNames } from '@server/registry/index';
import type { ToolHandlerDeps } from '@server/registry/contracts';

// Backward-compatible alias
export type ToolHandlerMapDependencies = ToolHandlerDeps;

/** Set of all tool names that have handler bindings (derived from registry). */
export function getHandledToolNames(): ReadonlySet<string> {
  return getAllToolNames();
}

/**
 * Create a handler map from registry registrations.
 * If selectedToolNames is provided, only those tools get handler entries.
 */
export function createToolHandlerMap(
  deps: ToolHandlerDeps,
  selectedToolNames?: ReadonlySet<string>
): Record<string, ToolHandler> {
  return buildHandlerMapFromRegistry(deps, selectedToolNames);
}
