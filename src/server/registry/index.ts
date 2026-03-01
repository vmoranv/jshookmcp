/**
 * Central tool registry — single source of truth.
 *
 * Aggregates all domain manifests into a flat array of ToolRegistration objects.
 * ToolCatalog and ToolHandlerMap both derive their data from here,
 * eliminating the previous three-way synchronisation requirement.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDomain, ToolHandlerMapDependencies, ToolRegistration } from './types.js';
import type { ToolHandler } from '../types.js';

import { analysisRegistrations } from '../domains/analysis/manifest.js';
import { browserRegistrations } from '../domains/browser/manifest.js';
import { debuggerRegistrations } from '../domains/debugger/manifest.js';
import { networkRegistrations } from '../domains/network/manifest.js';
import { hooksRegistrations } from '../domains/hooks/manifest.js';
import { maintenanceRegistrations } from '../domains/maintenance/manifest.js';
import { processRegistrations } from '../domains/process/manifest.js';
import { workflowRegistrations } from '../domains/workflow/manifest.js';
import { wasmRegistrations } from '../domains/wasm/manifest.js';
import { streamingRegistrations } from '../domains/streaming/manifest.js';
import { encodingRegistrations } from '../domains/encoding/manifest.js';
import { antidebugRegistrations } from '../domains/antidebug/manifest.js';
import { graphqlRegistrations } from '../domains/graphql/manifest.js';
import { platformRegistrations } from '../domains/platform/manifest.js';
import { sourcemapRegistrations } from '../domains/sourcemap/manifest.js';
import { transformRegistrations } from '../domains/transform/manifest.js';

/**
 * All tool registrations across all domains.
 * Order: core → browser → debugger → network → hooks → maintenance →
 *        process → workflow → wasm → streaming → encoding → antidebug →
 *        graphql → platform → sourcemap → transform
 */
export const ALL_REGISTRATIONS: readonly ToolRegistration[] = [
  ...analysisRegistrations,
  ...browserRegistrations,
  ...debuggerRegistrations,
  ...networkRegistrations,
  ...hooksRegistrations,
  ...maintenanceRegistrations,
  ...processRegistrations,
  ...workflowRegistrations,
  ...wasmRegistrations,
  ...streamingRegistrations,
  ...encodingRegistrations,
  ...antidebugRegistrations,
  ...graphqlRegistrations,
  ...platformRegistrations,
  ...sourcemapRegistrations,
  ...transformRegistrations,
];

/** Tool definitions grouped by domain (replaces manual TOOL_GROUPS in ToolCatalog). */
export function buildToolGroups(): Record<ToolDomain, Tool[]> {
  const groups: Record<string, Tool[]> = {};
  for (const reg of ALL_REGISTRATIONS) {
    (groups[reg.domain] ??= []).push(reg.tool);
  }
  return groups as Record<ToolDomain, Tool[]>;
}

/** Map tool name → domain (replaces TOOL_DOMAIN_BY_NAME in ToolCatalog). */
export function buildToolDomainMap(): ReadonlyMap<string, ToolDomain> {
  const map = new Map<string, ToolDomain>();
  for (const reg of ALL_REGISTRATIONS) {
    if (!map.has(reg.tool.name)) {
      map.set(reg.tool.name, reg.domain);
    }
  }
  return map;
}

/** Flat list of all Tool definitions (replaces allTools in ToolCatalog). */
export function buildAllTools(): Tool[] {
  return ALL_REGISTRATIONS.map(r => r.tool);
}

/**
 * Build a handler map from the registry (replaces createToolHandlerMap).
 * If selectedToolNames is provided, only those tools are included.
 */
export function buildHandlerMapFromRegistry(
  deps: ToolHandlerMapDependencies,
  selectedToolNames?: ReadonlySet<string>,
): Record<string, ToolHandler> {
  const registrations = selectedToolNames
    ? ALL_REGISTRATIONS.filter(r => selectedToolNames.has(r.tool.name))
    : ALL_REGISTRATIONS;
  return Object.fromEntries(
    registrations.map(r => [r.tool.name, r.bind(deps) as ToolHandler]),
  );
}

/** Set of all tool names that have handler bindings. */
export const ALL_TOOL_NAMES: ReadonlySet<string> = new Set(
  ALL_REGISTRATIONS.map(r => r.tool.name),
);

/** Set of all known domain names (derived from registrations). */
export const ALL_DOMAINS: ReadonlySet<ToolDomain> = new Set(
  ALL_REGISTRATIONS.map(r => r.domain),
);
