/**
 * Tool handler map — derived from the central registry.
 * Re-exports the registry-based builder for backward compatibility.
 */
import type { ToolHandler } from './types.js';
import { buildHandlerMapFromRegistry, ALL_TOOL_NAMES } from './registry/index.js';
import type { ToolHandlerDeps } from './registry/contracts.js';

// Backward-compatible alias
export type ToolHandlerMapDependencies = ToolHandlerDeps;

/** Set of all tool names that have handler bindings (derived from registry). */
export const HANDLED_TOOL_NAMES: ReadonlySet<string> = ALL_TOOL_NAMES;

/**
 * Create a handler map from registry registrations.
 * If selectedToolNames is provided, only those tools get handler entries.
 */
export function createToolHandlerMap(
  deps: ToolHandlerDeps,
  selectedToolNames?: ReadonlySet<string>,
): Record<string, ToolHandler> {
  return buildHandlerMapFromRegistry(deps, selectedToolNames);
}
