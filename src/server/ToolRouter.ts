/**
 * ToolRouter — Thin orchestrator for tool routing.
 *
 * Delegates to 4 focused sub-modules:
 *   ToolRouter.intent    — intent classification and workflow detection
 *   ToolRouter.probe    — runtime state probing and tool accessors
 *   ToolRouter.policy   — routing policy, reranking, and sequence builders
 *   ToolRouter.renderer — command rendering and example-arg generation
 *
 * Only the orchestration logic and public types live here.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@utils/logger';
import { type ToolSearchEngine, type ToolSearchResult } from '@server/ToolSearch';
import { ensureWorkflowsLoaded } from '@server/extensions/ExtensionManager';
import {
  getActiveToolNames,
  getBaseTier,
  getVisibleDomainsForTier,
} from '@server/MCPServer.search.helpers';

// ── Types (re-exported from sub-modules for backward compatibility) ──

import type { WorkflowRule, RoutedWorkflowMatch } from '@server/ToolRouter.intent';
import type { RoutingState } from '@server/ToolRouter.probe';

// Sub-module re-exports (public API surface)

export type { WorkflowRule, RoutedWorkflowMatch };
export type { RoutingState };

// ── Request / Response types ──

import type { WorkflowRouteMetadata } from '@server/workflows/WorkflowContract';

export interface RouterRequest {
  /** Natural language description of the task */
  task: string;
  /** Optional context hints */
  context?: {
    /** Domain preference (e.g., 'browser', 'network') */
    preferredDomain?: string;
    /** Whether to auto-activate tools */
    autoActivate?: boolean;
    /** Maximum number of recommendations */
    maxRecommendations?: number;
  };
}

export interface RouterResponse {
  /** Recommended tools with activation status */
  recommendations: Array<{
    name: string;
    domain: string | null;
    description: string;
    inputSchema: Tool['inputSchema'];
    score: number;
    isActive: boolean;
    /** Activation command if not active */
    activationCommand?: string;
    /** Direct call_tool command template */
    callCommand?: string;
    /** Prerequisite checks — what must be satisfied before using this tool */
    prerequisites?: Array<{
      condition: string;
      satisfied: boolean;
      fix: string;
    }>;
  }>;
  /** Structured next actions */
  nextActions: Array<{
    step: number;
    action: 'activate' | 'call';
    toolName?: string;
    command: string;
    exampleArgs?: Record<string, unknown>;
    description: string;
  }>;
  /** Workflow hint */
  workflowHint?: string;
  /** Routed workflow preset matched for the task, if any */
  routeMatch?: {
    kind: WorkflowRouteMetadata['kind'];
    id: string;
    name: string;
    description: string;
    confidence: number;
    matchedPattern: string;
    requiredDomains: string[];
    steps: Array<{
      id: string;
      toolName: string;
      domain: string | null;
      description: string;
      prerequisites: string[];
      parallel?: boolean;
      isActive: boolean;
    }>;
  };
  /** Whether auto-activation was performed */
  autoActivated?: boolean;
  /** Canonical tool names auto-activated by the handler */
  activatedNames?: string[];
  /** Hint for clients that do not support tools/list_changed */
  callToolHint?: string;
}

// ── Sub-module imports ──

import {
  detectWorkflowIntent,
  matchWorkflowRoute,
  isBrowserOrNetworkTask,
  isMaintenanceTask,
} from '@server/ToolRouter.intent';

import {
  getAvailableToolNames,
  getRoutingState,
  isToolActive,
  getToolDomainFromContext,
  getToolInputSchema,
} from '@server/ToolRouter.probe';

import {
  getEffectivePrerequisites,
  buildWorkflowToolSequence,
  buildPresetRecommendations,
  buildWorkflowRouteRecommendation,
  buildRouteMatchMetadata,
  rerankResultsForContext,
} from '@server/ToolRouter.policy';

import { buildCallToolCommand, generateExampleArgs } from '@server/ToolRouter.renderer';

// ── Main Router Orchestrator ──

export async function routeToolRequest(
  request: RouterRequest,
  ctx: import('@server/MCPServer.context').MCPServerContext,
  searchEngine: ToolSearchEngine,
): Promise<RouterResponse> {
  const { task, context = {} } = request;
  const maxRecommendations = context.maxRecommendations || 5;

  logger.info('[ToolRouter] Routing request', { task, context });

  await ensureWorkflowsLoaded(ctx);
  const workflow = detectWorkflowIntent(task);
  const activeNames = getActiveToolNames(ctx);
  const visibleDomains = getVisibleDomainsForTier(ctx);
  const routingState = await getRoutingState(ctx);
  const availableToolNames = getAvailableToolNames(ctx);
  const routeMatch = matchWorkflowRoute(task, ctx);
  let presetPlannedToolNames: Set<string> | null = null;

  const searchResults = await searchEngine.search(
    task,
    maxRecommendations * 2,
    activeNames,
    visibleDomains,
    getBaseTier(ctx),
  );

  let finalResults: ToolSearchResult[] = [];
  if (routeMatch?.workflow.route.kind === 'preset') {
    const presetTools = buildPresetRecommendations(
      routeMatch,
      routingState,
      ctx,
      availableToolNames,
    );
    presetPlannedToolNames = new Set(presetTools.map((tool) => tool.name));
    const presetNames = new Set(presetTools.map((tool) => tool.name));
    const otherResults = searchResults.filter((result) => !presetNames.has(result.name));
    finalResults = [...presetTools, ...otherResults];
  } else if (routeMatch?.workflow.route.kind === 'workflow') {
    const workflowResult = buildWorkflowRouteRecommendation(routeMatch, ctx);
    const otherResults = searchResults.filter((result) => result.name !== workflowResult.name);
    finalResults = [workflowResult, ...otherResults];
  } else if (workflow) {
    const workflowSequence = buildWorkflowToolSequence(workflow, routingState, availableToolNames);
    const workflowTools = workflowSequence.map((name, index) => ({
      name,
      domain: getToolDomainFromContext(name, ctx),
      shortDescription:
        searchResults.find((r) => r.name === name)?.shortDescription ??
        ctx.extensionToolsByName.get(name)?.tool.description ??
        '',
      score: workflow.priority - index * 0.01,
      isActive: isToolActive(name, ctx),
    }));

    const workflowNames = new Set(workflowSequence);
    const otherResults = searchResults.filter((result) => !workflowNames.has(result.name));
    finalResults = [...workflowTools, ...otherResults];
  } else {
    finalResults = [...searchResults];
  }

  const dedupedResults: ToolSearchResult[] = [];
  const seenNames = new Set<string>();
  for (const result of finalResults) {
    if (seenNames.has(result.name)) {
      continue;
    }
    seenNames.add(result.name);
    dedupedResults.push(result);
  }

  finalResults = rerankResultsForContext(dedupedResults, task, workflow, routingState);

  if (context.preferredDomain && finalResults.length > 0) {
    const domainBoostFactor = 1.15;
    finalResults = finalResults.map((result) => ({
      ...result,
      score:
        result.domain === context.preferredDomain ? result.score * domainBoostFactor : result.score,
    }));
    finalResults.sort((a, b) => b.score - a.score);
  }

  const recommendationLimit = Math.max(maxRecommendations, presetPlannedToolNames?.size ?? 0);
  finalResults = finalResults.slice(0, recommendationLimit);
  const routeMatchMetadata = routeMatch ? buildRouteMatchMetadata(routeMatch, ctx) : undefined;

  const recommendations = finalResults.map((result) => {
    const schema = getToolInputSchema(result.name, ctx);
    const toolIsActive = isToolActive(result.name, ctx);

    const recommendation: RouterResponse['recommendations'][0] = {
      name: result.name,
      domain: result.domain,
      description: result.shortDescription,
      inputSchema: schema || { type: 'object' },
      score: result.score,
      isActive: toolIsActive,
      callCommand: buildCallToolCommand(result.name, schema || { type: 'object' }),
    };

    if (!toolIsActive) {
      recommendation.activationCommand = `activate_tools with names: ["${result.name}"]`;
    }

    const prereqs = getEffectivePrerequisites()[result.name];
    if (prereqs && prereqs.length > 0) {
      recommendation.prerequisites = prereqs.map((p) => ({
        condition: p.condition,
        satisfied: p.check(routingState),
        fix: p.fix,
      }));
    }

    return recommendation;
  });

  const nextActions: RouterResponse['nextActions'] = [];
  const presetRecommendations = presetPlannedToolNames
    ? recommendations.filter((recommendation) => presetPlannedToolNames.has(recommendation.name))
    : [];
  const inactiveTools = (
    presetRecommendations.length > 0 ? presetRecommendations : recommendations
  ).filter((recommendation) => !recommendation.isActive);

  const activationCandidates = (() => {
    if (
      presetRecommendations.length > 0 ||
      !isBrowserOrNetworkTask(task, workflow) ||
      isMaintenanceTask(task)
    ) {
      return inactiveTools;
    }
    const nonMaintenanceTools = inactiveTools.filter((tool) => tool.domain !== 'maintenance');
    return nonMaintenanceTools.length > 0 ? nonMaintenanceTools : inactiveTools;
  })();

  if (routeMatchMetadata?.kind === 'preset' && presetRecommendations.length > 0) {
    let stepNumber = 1;
    if (activationCandidates.length > 0) {
      nextActions.push({
        step: stepNumber++,
        action: 'activate',
        toolName: activationCandidates.length === 1 ? activationCandidates[0]!.name : undefined,
        command: `activate_tools with names: [${activationCandidates.map((tool) => `"${tool.name}"`).join(', ')}]`,
        description: `Activate ${activationCandidates.length} preset tool${activationCandidates.length === 1 ? '' : 's'} for ${routeMatchMetadata!.name}`,
      });
    }

    const bootstrapRecommendations = recommendations.filter(
      (recommendation) =>
        recommendation.name === 'browser_launch' || recommendation.name === 'browser_attach',
    );
    for (const bootstrap of bootstrapRecommendations) {
      nextActions.push({
        step: stepNumber++,
        action: 'call',
        toolName: bootstrap.name,
        command: bootstrap.name,
        exampleArgs: generateExampleArgs(bootstrap.inputSchema),
        description: bootstrap.description,
      });
    }

    for (const step of routeMatchMetadata!.steps) {
      const recommendation = presetRecommendations.find((item) => item.name === step.toolName);
      nextActions.push({
        step: stepNumber++,
        action: 'call',
        toolName: step.toolName,
        command: step.toolName,
        exampleArgs: generateExampleArgs(
          recommendation?.inputSchema ??
            getToolInputSchema(step.toolName, ctx) ?? { type: 'object' },
        ),
        description: `${step.id}: ${step.description}`,
      });
    }
  } else if (routeMatchMetadata?.kind === 'workflow') {
    const workflowRecommendation = recommendations.find(
      (recommendation) => recommendation.name === 'run_extension_workflow',
    )!;

    let stepNumber = 1;
    if (!workflowRecommendation.isActive) {
      nextActions.push({
        step: stepNumber++,
        action: 'activate',
        toolName: workflowRecommendation.name,
        command: `activate_tools with names: ["${workflowRecommendation.name}"]`,
        description: `Activate workflow runner for ${routeMatchMetadata.name}`,
      });
    }

    nextActions.push({
      step: stepNumber,
      action: 'call',
      toolName: 'run_extension_workflow',
      command: 'run_extension_workflow',
      exampleArgs: {
        ...generateExampleArgs(workflowRecommendation.inputSchema!),
        workflowId: routeMatchMetadata.id,
      },
      description: `Execute routed workflow ${routeMatchMetadata.name}`,
    });
  } else if (recommendations.length > 0 && recommendations[0]?.isActive) {
    nextActions.push({
      step: 1,
      action: 'call',
      toolName: recommendations[0].name,
      command: recommendations[0].name,
      exampleArgs: generateExampleArgs(recommendations[0].inputSchema),
      description: `Call ${recommendations[0].name}. Use describe_tool("${recommendations[0].name}") only if you need the full schema.`,
    });
  } else if (activationCandidates.length > 0) {
    const topInactive = activationCandidates[0]!;
    nextActions.push({
      step: 1,
      action: 'activate',
      toolName: activationCandidates.length === 1 ? topInactive.name : undefined,
      command: `activate_tools with names: [${activationCandidates.map((tool) => `"${tool.name}"`).join(', ')}]`,
      description: `Activate ${activationCandidates.length} recommended tool${activationCandidates.length === 1 ? '' : 's'}`,
    });
    nextActions.push({
      step: 2,
      action: 'call',
      toolName: topInactive.name,
      command: topInactive.name,
      exampleArgs: generateExampleArgs(topInactive.inputSchema),
      description: `Call ${topInactive.name}. Use describe_tool("${topInactive.name}") only if you need the full schema.`,
    });
  }

  return {
    recommendations,
    nextActions,
    workflowHint: routeMatchMetadata
      ? `${routeMatchMetadata.kind === 'preset' ? 'Preset' : 'Workflow'} ${routeMatchMetadata.name}: ${routeMatchMetadata.description}`
      : workflow?.hint,
    routeMatch: routeMatchMetadata,
    autoActivated: false,
  };
}

// ── Re-exported sub-module utilities (backward compatibility) ──

export {
  buildCallToolCommand,
  describeTool,
  generateExampleArgs,
} from '@server/ToolRouter.renderer';
