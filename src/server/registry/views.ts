/**
 * Registry views — pure derived builders over the registry state, extracted
 * from `registry/index.ts`.
 *
 * The barrel's import graph reaches every domain manifest
 * (discovery.ts → generated-domains.ts), so cache-layer consumers
 * (`ToolCatalog`, `ToolHandlerMap`) import this leaf module instead — a
 * static dependency on the barrel re-creates the registry↔catalog cycle
 * family (the largest cluster in the cycle audit this module closed).
 */
import type { Tool } from '@modelcontextprotocol/server';
import { ToolError } from '@errors/ToolError';
import type { ToolHandlerDeps, ToolRegistration } from '@server/registry/contracts';
import type { ToolHandler } from '@server/types';
import { getLoadedManifests, getLoadedRegistrations } from '@server/registry/state';

export { getLoadedRegistrations };

// ── Cached views shared with ToolCatalog ──
//
// ToolCatalog keeps re-exporting these (its public surface is unchanged), but
// back-edge consumers (ToolRouter.policy, ToolRouter.probe, ExtensionManager,
// MCPServer.activation.ttl) import them here directly so the catalog's import
// graph no longer closes a cycle through the registry barrel.

import { onRegistryInvalidate } from '@server/registry/state';

let toolDomainByName: ReadonlyMap<string, string> | null = null;
let allToolsCache: Tool[] | null = null;

function getToolDomainByName(): ReadonlyMap<string, string> {
  if (!toolDomainByName) toolDomainByName = buildToolDomainMap();
  return toolDomainByName;
}

/** Domain of a tool name, or null if unknown. */
export function getToolDomain(toolName: string): string | null {
  return getToolDomainByName().get(toolName) ?? null;
}

// Proxy so that consumers can import allTools normally but values resolve lazily.
export const allTools: Tool[] = new Proxy([] as Tool[], {
  get(_t, p) {
    if (!allToolsCache) allToolsCache = buildAllTools();
    const real = allToolsCache as unknown as Record<string | symbol, unknown>;
    const v = real[p as string];
    return typeof v === 'function' ? (v as Function).bind(real) : v;
  },
});

onRegistryInvalidate(() => {
  toolDomainByName = null;
  allToolsCache = null;
});

/** O(1) lookup of a single ToolRegistration by tool name. */
export function getRegistrationByName(name: string): ToolRegistration | undefined {
  for (const r of getLoadedRegistrations()) {
    if (r.tool.name === name) return r;
  }
  return undefined;
}

/** Returns domain names of LOADED manifests only. */
export function getLoadedDomainNames(): ReadonlySet<string> {
  return new Set(getLoadedManifests().map((m) => m.domain));
}

export function buildToolGroups(): Record<string, Tool[]> {
  const groups: Record<string, Tool[]> = {};
  for (const r of getLoadedRegistrations()) {
    (groups[r.domain!] ??= []).push(r.tool);
  }
  return groups;
}

export function buildToolDomainMap(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const r of getLoadedRegistrations()) {
    if (!map.has(r.tool.name)) map.set(r.tool.name, r.domain!);
  }
  return map;
}

export function buildAllTools(): Tool[] {
  return getLoadedRegistrations().map((r) => r.tool);
}

export interface HandlerBindingFailure {
  readonly toolName: string;
  readonly domain: string;
  readonly error: unknown;
}

export interface BuildHandlerMapOptions {
  /**
   * When true, a failed `bind()` throws instead of returning a partial map.
   *
   * Defaults to `selectedToolNames !== undefined`: every production caller
   * (startup registration, activation, domain activation) passes an explicit
   * selection, and a selected tool whose dependency is missing is a wiring bug,
   * not an optional tool. Unfiltered introspection stays lenient so tests and
   * diagnostics can build a best-effort map from partial deps.
   */
  readonly strict?: boolean;
  /** Optional observer for lenient mode (or for collecting diagnostics before a throw). */
  readonly onBindingFailure?: (failure: HandlerBindingFailure) => void;
}

function describeBindingFailure(failure: HandlerBindingFailure): string {
  const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
  return `${failure.toolName} (${failure.domain}): ${message}`;
}

export function buildHandlerMapFromRegistry(
  deps: ToolHandlerDeps,
  selectedToolNames?: ReadonlySet<string>,
  options: BuildHandlerMapOptions = {},
): Record<string, ToolHandler> {
  const regs = selectedToolNames
    ? getLoadedRegistrations().filter((r) => selectedToolNames.has(r.tool.name))
    : [...getLoadedRegistrations()];
  const strict = options.strict ?? selectedToolNames !== undefined;
  const entries: [string, ToolHandler][] = [];
  const failures: HandlerBindingFailure[] = [];
  for (const r of regs) {
    try {
      const bind = r.bind;
      (bind as { validate?: (dependencies: ToolHandlerDeps) => void }).validate?.(deps);
      entries.push([r.tool.name, bind(deps) as ToolHandler]);
    } catch (error) {
      const failure: HandlerBindingFailure = {
        toolName: r.tool.name,
        domain: r.domain ?? 'unknown',
        error,
      };
      failures.push(failure);
      options.onBindingFailure?.(failure);
    }
  }

  if (strict && failures.length > 0) {
    const preview = failures.slice(0, 5).map(describeBindingFailure).join('; ');
    const suffix = failures.length > 5 ? `; +${failures.length - 5} more` : '';
    throw new ToolError(
      'PREREQUISITE',
      `[registry] ${failures.length} tool handler(s) failed to bind: ${preview}${suffix}`,
      {
        details: {
          failures: failures.map((failure) => ({
            toolName: failure.toolName,
            domain: failure.domain,
            message: failure.error instanceof Error ? failure.error.message : String(failure.error),
          })),
        },
      },
    );
  }

  return Object.fromEntries(entries);
}
