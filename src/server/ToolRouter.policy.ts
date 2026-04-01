/**
 * ToolRouter.policy - Route policy, reranking, prerequisite logic,
 * and workflow tool-sequence builders.
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolSearchResult } from '@server/ToolSearch';
import type { WorkflowRule, RoutedWorkflowMatch } from '@server/ToolRouter.intent';
import type { RoutingState } from '@server/ToolRouter.probe';
import type { RouterResponse } from '@server/ToolRouter';
import { getToolDomain } from '@server/ToolCatalog';
import { getAllManifests } from '@server/registry/index';
import { isBrowserOrNetworkTask, isMaintenanceTask } from '@server/ToolRouter.intent';
import { isToolActive, getToolDomainFromContext } from '@server/ToolRouter.probe';

// ── Prerequisite Types ──

export interface PrerequisiteEntry {
  condition: string;
  check: (state: RoutingState) => boolean;
  fix: string;
}

// ── Planned Tool (used by preset sequences) ──

interface PlannedTool {
  name: string;
  description: string;
}

// ── Prerequisite Check Builders ──

/**
 * Build a real runtime check function from the prerequisite condition string.
 * Returns true when the prerequisite IS satisfied, false when it is not.
 */
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

let _cachedPrerequisites: Record<string, PrerequisiteEntry[]> | null = null;

/**
 * Aggregate prerequisite declarations from domain manifests.
 * Cached lazily — manifests are immutable at runtime.
 */
export function getEffectivePrerequisites(): Record<string, PrerequisiteEntry[]> {
  if (_cachedPrerequisites) return _cachedPrerequisites;
  const merged: Record<string, PrerequisiteEntry[]> = {};
  for (const m of getAllManifests()) {
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
  _cachedPrerequisites = merged;
  return _cachedPrerequisites;
}

// ── Workflow Tool Sequence Builders ──

export function buildWorkflowToolSequence(
  workflow: WorkflowRule,
  state: RoutingState,
  availableToolNames: Set<string>,
): string[] {
  const sequence: string[] = [];
  const pushIfAvailable = (toolName: string) => {
    if (availableToolNames.has(toolName) && !sequence.includes(toolName)) {
      sequence.push(toolName);
    }
  };

  if ((workflow.domain === 'browser' || workflow.domain === 'network') && !state.hasActivePage) {
    pushIfAvailable('browser_launch');
    pushIfAvailable('browser_attach');
  }

  if (workflow.domain === 'network') {
    if (state.hasActivePage && !state.networkEnabled) {
      pushIfAvailable('network_enable');
    }
    if (state.hasActivePage && state.networkEnabled && state.capturedRequestCount > 0) {
      pushIfAvailable('network_get_requests');
    }
  }

  for (const toolName of workflow.tools) {
    pushIfAvailable(toolName);
  }

  if (workflow.domain === 'network' && state.hasActivePage && state.networkEnabled) {
    pushIfAvailable('network_get_requests');
  }

  return sequence;
}

export function buildPresetToolSequence(
  match: RoutedWorkflowMatch,
  state: RoutingState,
  availableToolNames: Set<string>,
): PlannedTool[] {
  const sequence: PlannedTool[] = [];
  const seen = new Set<string>();
  const requiresBrowserSession =
    match.workflow.route.requiredDomains.includes('browser') ||
    match.workflow.route.requiredDomains.includes('network');

  const pushIfAvailable = (toolName: string, description: string) => {
    if (!availableToolNames.has(toolName) || seen.has(toolName)) {
      return;
    }
    seen.add(toolName);
    sequence.push({ name: toolName, description });
  };

  if (!state.hasActivePage && requiresBrowserSession) {
    pushIfAvailable('browser_launch', 'Launch a browser session before executing the preset');
    pushIfAvailable(
      'browser_attach',
      'Attach preset tooling to the active browser session before capture begins',
    );
  }

  for (const step of match.workflow.route.steps) {
    pushIfAvailable(step.toolName, step.description);
  }

  return sequence;
}

export function buildPresetRecommendations(
  match: RoutedWorkflowMatch,
  state: RoutingState,
  ctx: MCPServerContext,
  availableToolNames: Set<string>,
): ToolSearchResult[] {
  return buildPresetToolSequence(match, state, availableToolNames).map((plannedTool, index) => ({
    name: plannedTool.name,
    domain: getToolDomainFromContext(plannedTool.name, ctx),
    shortDescription: plannedTool.description,
    score: match.workflow.route.priority + match.confidence - index * 0.01,
    isActive: isToolActive(plannedTool.name, ctx),
  }));
}

export function buildWorkflowRouteRecommendation(
  match: RoutedWorkflowMatch,
  ctx: MCPServerContext,
): ToolSearchResult {
  return {
    name: 'run_extension_workflow',
    domain: getToolDomainFromContext('run_extension_workflow', ctx),
    shortDescription: `Execute routed workflow ${match.workflow.name} (${match.workflow.id}) via run_extension_workflow`,
    score: match.workflow.route.priority + match.confidence,
    isActive: isToolActive('run_extension_workflow', ctx),
  };
}

export function buildRouteMatchMetadata(
  match: RoutedWorkflowMatch,
  ctx: MCPServerContext,
): NonNullable<RouterResponse['routeMatch']> {
  return {
    kind: match.workflow.route.kind,
    id: match.workflow.id,
    name: match.workflow.name,
    description: match.workflow.description,
    confidence: match.confidence,
    matchedPattern: match.matchedPattern,
    requiredDomains: [...match.workflow.route.requiredDomains],
    steps: match.workflow.route.steps.map((step) => ({
      id: step.id,
      toolName: step.toolName,
      domain:
        getToolDomain(step.toolName) ?? ctx.extensionToolsByName.get(step.toolName)?.domain ?? null,
      description: step.description,
      prerequisites: [...step.prerequisites],
      parallel: step.parallel,
      isActive: isToolActive(step.toolName, ctx),
    })),
  };
}

// ── Reranking ──

export function rerankResultsForContext(
  results: ToolSearchResult[],
  task: string,
  workflow: WorkflowRule | null,
  state: RoutingState,
): ToolSearchResult[] {
  const browserOrNetworkTask = isBrowserOrNetworkTask(task, workflow);
  const maintenanceTask = isMaintenanceTask(task);

  const reranked = results.map((result) => {
    let score = result.score;

    if (browserOrNetworkTask && !maintenanceTask && result.domain === 'maintenance') {
      score *= 0.1;
    }

    if (browserOrNetworkTask) {
      if (!state.hasActivePage && result.name === 'browser_launch') {
        score *= 1.4;
      }
      if (!state.hasActivePage && result.name === 'browser_attach') {
        score *= 1.2;
      }
      if (state.hasActivePage && !state.networkEnabled && result.name === 'network_enable') {
        score *= 1.35;
      }
      if (
        state.hasActivePage &&
        state.networkEnabled &&
        state.capturedRequestCount > 0 &&
        result.name === 'network_get_requests'
      ) {
        score *= 1.5;
      }
    }

    return {
      ...result,
      score,
    };
  });

  reranked.sort((a, b) => b.score - a.score);
  return reranked;
}
