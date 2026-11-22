/**
 * ToolRouter.policy - Route policy, reranking, prerequisite logic,
 * and workflow tool-sequence builders.
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolSearchResult } from '@server/ToolSearch';
import type { WorkflowRule, RoutedWorkflowMatch } from '@server/ToolRouter.intent';
import type { RoutingState } from '@server/ToolRouter.probe';
import type { RouterResponse } from '@server/ToolRouter';
import {
  RERANK_MAINTENANCE_PENALTY,
  RERANK_STATELESS_INTERACTIVE_PENALTY,
  RERANK_STATELESS_CORE_PENALTY,
  RERANK_STATELESS_COMPUTE_BOOST,
  RERANK_STATELESS_SPECIFIC_TOOL_BOOST,
  RERANK_BROWSER_LAUNCH_BOOST,
  RERANK_BROWSER_ATTACH_BOOST,
  RERANK_NETWORK_MONITOR_BOOST,
  RERANK_NETWORK_GET_REQUESTS_BOOST,
} from '@src/constants';
import { getToolDomain } from '@server/registry/views';
import {
  isBrowserOrNetworkTask,
  isMaintenanceTask,
  isStatelessComputeTask,
} from '@server/ToolRouter.intent';
import { isToolActive, getToolDomainFromContext } from '@server/ToolRouter.probe';

// ── Prerequisite Types ──

// ── Planned Tool (used by preset sequences) ──

interface PlannedTool {
  name: string;
  description: string;
}

function buildStatelessComputeSequence(
  task: string,
  availableToolNames: Set<string>,
): PlannedTool[] {
  if (!isStatelessComputeTask(task)) {
    return [];
  }

  const candidates: PlannedTool[] = [];
  const pushIfAvailable = (name: string, description: string) => {
    if (availableToolNames.has(name) && !candidates.some((item) => item.name === name)) {
      candidates.push({ name, description });
    }
  };

  pushIfAvailable(
    'binary_detect_format',
    'Detect the payload encoding or container before decoding',
  );
  pushIfAvailable(
    'binary_decode',
    'Decode the payload into deterministic offline bytes or structured output',
  );
  pushIfAvailable(
    'proto_auto_detect',
    'Infer a likely protocol layout from repeated payload samples',
  );
  pushIfAvailable('proto_infer_fields', 'Derive stable field boundaries and candidate semantics');
  pushIfAvailable(
    'proto_infer_state_machine',
    'Infer request/response state transitions from repeated samples',
  );
  pushIfAvailable(
    'crypto_test_harness',
    'Validate extracted signing or crypto logic with deterministic test vectors',
  );
  pushIfAvailable(
    'crypto_compare',
    'Compare competing crypto implementations against the same vectors',
  );
  pushIfAvailable(
    'network_get_requests',
    'Collect request or response samples only if payload bytes still need to be extracted',
  );

  return candidates;
}

// ── Prerequisite Check Builders ──

/**
 * Build a real runtime check function from the prerequisite condition string.
 * Returns true when the prerequisite IS satisfied, false when it is not.
 */
// ── Prerequisites moved to ToolRouter.prerequisites.ts (leaf module) so
// WorkflowPreflight can consume them without the router policy graph —
// the policy import chain closed the largest registry↔workflow cycle family.

export { getEffectivePrerequisites } from '@server/ToolRouter.prerequisites';

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
      pushIfAvailable('network_monitor');
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

export function buildStatelessComputeRecommendations(
  task: string,
  ctx: MCPServerContext,
  availableToolNames: Set<string>,
): ToolSearchResult[] {
  return buildStatelessComputeSequence(task, availableToolNames).map((plannedTool, index) => ({
    name: plannedTool.name,
    domain: getToolDomainFromContext(plannedTool.name, ctx),
    shortDescription: plannedTool.description,
    score: 90 - index * 0.01,
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
    shortDescription:
      `Execute routed workflow ${match.workflow.name} (${match.workflow.id}) via ` +
      `run_extension_workflow`,
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

const STATELESS_INTERACTIVE_DOMAINS: ReadonlySet<string> = new Set([
  'browser',
  'network',
  'debugger',
  'instrumentation',
  'maintenance',
]);

const STATELESS_CORE_DOMAINS: ReadonlySet<string> = new Set(['core', 'streaming', 'workflow']);

const STATELESS_COMPUTE_DOMAINS: ReadonlySet<string> = new Set([
  'encoding',
  'transform',
  'protocol-analysis',
  'sourcemap',
  'core',
]);

const STATELESS_SPECIFIC_TOOLS: ReadonlySet<string> = new Set([
  'binary_detect_format',
  'binary_decode',
  'crypto_test_harness',
  'ast_transform_apply',
  'proto_auto_detect',
  'proto_infer_fields',
  'proto_infer_state_machine',
  'proto_fingerprint',
]);

/**
 * Multiplier for the "offline compute" query class. Applied in the same order
 * as the historical if-chain (interactive penalty → core penalty → compute
 * boost) so ranking stays byte-for-byte stable.
 */
function statelessDomainMultiplier(domain: string | null): number {
  if (domain === null) return 1;
  let multiplier = 1;
  if (STATELESS_INTERACTIVE_DOMAINS.has(domain)) {
    multiplier *= RERANK_STATELESS_INTERACTIVE_PENALTY;
  }
  if (STATELESS_CORE_DOMAINS.has(domain)) {
    multiplier *= RERANK_STATELESS_CORE_PENALTY;
  }
  if (STATELESS_COMPUTE_DOMAINS.has(domain)) {
    multiplier *= RERANK_STATELESS_COMPUTE_BOOST;
  }
  return multiplier;
}

/**
 * State-aware boosts for browser/network tasks. Kept as one function so the
 * table stays readable and the four conditions remain mutually explicit.
 */
function browserNetworkMultiplier(toolName: string, state: RoutingState): number {
  if (!state.hasActivePage && toolName === 'browser_launch') {
    return RERANK_BROWSER_LAUNCH_BOOST;
  }
  if (!state.hasActivePage && toolName === 'browser_attach') {
    return RERANK_BROWSER_ATTACH_BOOST;
  }
  if (state.hasActivePage && !state.networkEnabled && toolName === 'network_monitor') {
    return RERANK_NETWORK_MONITOR_BOOST;
  }
  if (
    state.hasActivePage &&
    state.networkEnabled &&
    state.capturedRequestCount > 0 &&
    toolName === 'network_get_requests'
  ) {
    return RERANK_NETWORK_GET_REQUESTS_BOOST;
  }
  return 1;
}

export function rerankResultsForContext(
  results: ToolSearchResult[],
  task: string,
  workflow: WorkflowRule | null,
  state: RoutingState,
): ToolSearchResult[] {
  const browserOrNetworkTask = isBrowserOrNetworkTask(task, workflow);
  const maintenanceTask = isMaintenanceTask(task);
  const statelessComputeTask = isStatelessComputeTask(task);

  const reranked = results.map((result) => {
    let score = result.score;

    if (browserOrNetworkTask && !maintenanceTask && result.domain === 'maintenance') {
      score *= RERANK_MAINTENANCE_PENALTY;
    }

    if (statelessComputeTask) {
      score *= statelessDomainMultiplier(result.domain);
      if (STATELESS_SPECIFIC_TOOLS.has(result.name)) {
        score *= RERANK_STATELESS_SPECIFIC_TOOL_BOOST;
      }
    }

    if (browserOrNetworkTask) {
      score *= browserNetworkMultiplier(result.name, state);
    }

    return {
      ...result,
      score,
    };
  });

  reranked.sort((a, b) => b.score - a.score);
  return reranked;
}
