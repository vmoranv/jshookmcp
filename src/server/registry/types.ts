/**
 * Registry types — re-exports from contracts.ts for backward compatibility.
 *
 * ToolDomain is now `string` (dynamically discovered, not a fixed union).
 * ToolHandlerMapDependencies is now ToolHandlerDeps (dynamic key-value map).
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Re-export canonical types from contracts
export type { ToolRegistration, ToolHandlerDeps, ToolProfileId, DomainManifest } from './contracts.js';

/** Domain name — now a plain string (no longer a fixed union). */
export type ToolDomain = string;

// Keep backward-compatible alias
export type ToolHandlerMapDependencies = Record<string, unknown>;

/**
 * Helper: create a name-based lookup from a Tool array.
 * Throws at module load time if a tool name is missing — acts as a build-time guard.
 */
export function toolLookup(tools: readonly Tool[]): (name: string) => Tool {
  const map = new Map(tools.map(t => [t.name, t]));
  return (name: string): Tool => {
    const tool = map.get(name);
    if (!tool) throw new Error(`[registry] Tool definition not found: "${name}"`);
    return tool;
  };
}
