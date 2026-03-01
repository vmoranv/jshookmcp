/**
 * Tool handler map — now derived from the central registry.
 *
 * The previous 416-line TOOL_HANDLER_BINDINGS array has been replaced by
 * per-domain manifest files. This module re-exports the registry-based
 * builder for backward compatibility.
 */
import type { ToolHandler } from './types.js';
import { buildHandlerMapFromRegistry, ALL_TOOL_NAMES } from './registry/index.js';

// Re-export ToolHandlerMapDependencies from canonical location.
export type { ToolHandlerMapDependencies } from './registry/types.js';
import type { ToolHandlerMapDependencies } from './registry/types.js';

/** Set of all tool names that have handler bindings (derived from registry). */
export const HANDLED_TOOL_NAMES: ReadonlySet<string> = ALL_TOOL_NAMES;

/**
 * Create a handler map from registry registrations.
 * If selectedToolNames is provided, only those tools get handler entries.
 */
export function createToolHandlerMap(
  deps: ToolHandlerMapDependencies,
  selectedToolNames?: ReadonlySet<string>,
): Record<string, ToolHandler> {
  return buildHandlerMapFromRegistry(deps, selectedToolNames);
}
