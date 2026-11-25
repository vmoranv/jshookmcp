/**
 * Effective prerequisite resolution over loaded manifests.
 *
 * Split out of `ToolRouter.policy.ts` so `WorkflowPreflight` can consume it
 * without dragging in the router policy graph — the policy module's import
 * chain (probe → registry views → generated-domains → every domain manifest
 * → workflow engine → preflight) closed the largest cycle family in the
 * registry↔workflow audit; this leaf breaks that return edge.
 */
import type { RoutingState } from '@server/ToolRouter.probe';
import { getLoadedManifests, onRegistryInvalidate } from '@server/registry/state';

export interface PrerequisiteEntry {
  condition: string;
  check: (state: RoutingState) => boolean;
  fix: string;
}

function buildPrerequisiteCheck(condition: string): (state: RoutingState) => boolean {
  if (condition.includes('Browser must be launched')) {
    return (state) => state.hasActivePage;
  }

  if (condition.includes('Network monitoring must be enabled')) {
    return (state) => state.networkEnabled;
  }

  if (condition.includes('Debugger must be enabled')) {
    return (state) => state.hasActivePage;
  }

  if (condition.includes('Debugger must be attached')) {
    return (state) => state.hasActivePage;
  }

  if (condition.includes('Page must be navigated')) {
    return (state) => state.hasActivePage;
  }

  if (condition.includes('WebSocket monitoring')) {
    return (state) => state.hasActivePage;
  }

  // Unknown condition — cannot be checked at runtime, assume not satisfied
  return () => false;
}

// ── Prerequisite Cache ──

let cachedPrerequisites: Record<string, PrerequisiteEntry[]> | null = null;

// Manifests are append-only at runtime: `ensureDomainLoaded` adds lazily loaded
// domains (and notifies invalidation) after this cache may already be built.
// Without subscribing, prerequisites from a domain activated mid-session would
// never appear in routes.
onRegistryInvalidate(() => {
  cachedPrerequisites = null;
});

/**
 * Aggregate prerequisite declarations from domain manifests.
 * Cached lazily and reset whenever the registry reports an invalidation.
 */
export function getEffectivePrerequisites(): Record<string, PrerequisiteEntry[]> {
  if (cachedPrerequisites) return cachedPrerequisites;
  const merged: Record<string, PrerequisiteEntry[]> = {};
  for (const m of getLoadedManifests()) {
    if (m.prerequisites) {
      for (const [toolName, entries] of Object.entries(m.prerequisites)) {
        merged[toolName] = entries.map((e) => ({
          condition: e.condition,
          check: buildPrerequisiteCheck(e.condition),
          fix: e.fix,
        }));
      }
    }
  }
  cachedPrerequisites = merged;
  return cachedPrerequisites;
}
