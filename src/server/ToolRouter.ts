/**
 * Tool Router - One-stop routing layer for tool discovery, activation, and execution.
 *
 * Compresses the multi-step "search -> activate -> call" protocol into 1-2 tool calls.
 * Implements workflow-first heuristics and safety guardrails.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@utils/logger';
import { allTools, getToolDomain } from '@server/ToolCatalog';
import type { MCPServerContext } from '@server/MCPServer.context';
import { getActiveToolNames } from '@server/MCPServer.search.helpers';
import { normalizeToolName } from '@server/MCPServer.search.validation';
import { type ToolSearchEngine } from '@server/ToolSearch';
import type { ToolSearchResult } from '@server/ToolSearch';
import { ensureWorkflowsLoaded } from '@server/extensions/ExtensionManager';
import { getAllManifests } from '@server/registry/index';
import type { WorkflowRouteMetadata } from '@server/workflows/WorkflowContract';

// Lazily-built tool name index for O(1) lookups
let _allToolsByName: Map<string, Tool> | null = null;
function getAllToolsByName(): Map<string, Tool> {
  if (!_allToolsByName) _allToolsByName = new Map(allTools.map((t) => [t.name, t]));
  return _allToolsByName;
}

// ── Types ──

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

// ── Workflow Detection Rules ──

interface WorkflowRule {
  patterns: RegExp[];
  domain: string;
  priority: number;
  tools: string[];
  hint: string;
}

interface RoutingState {
  hasActivePage: boolean;
  networkEnabled: boolean;
  capturedRequestCount: number;
}

interface PlannedTool {
  name: string;
  description: string;
}

interface RoutedWorkflowMatch {
  workflow: {
    id: string;
    name: string;
    description: string;
    route: WorkflowRouteMetadata;
  };
  confidence: number;
  matchedPattern: string;
}

/**
 * Aggregate workflow rules declared by domain manifests.
 * All routing metadata is now declared in each domain's manifest.ts,
 * following the open-closed principle (no hardcoded rules here).
 *
 * Cached lazily — manifests are immutable at runtime.
 */
let _cachedWorkflowRules: WorkflowRule[] | null = null;
function getEffectiveWorkflowRules(): WorkflowRule[] {
  if (_cachedWorkflowRules) return _cachedWorkflowRules;
  const rules: WorkflowRule[] = [];
  for (const m of getAllManifests()) {
    if (m.workflowRule) {
      rules.push({
        patterns: [...m.workflowRule.patterns],
        domain: m.domain,
        priority: m.workflowRule.priority,
        tools: [...m.workflowRule.tools],
        hint: m.workflowRule.hint,
      });
    }
  }
  _cachedWorkflowRules = [...rules].toSorted(
    (a: WorkflowRule, b: WorkflowRule) => b.priority - a.priority,
  );
  return _cachedWorkflowRules;
}

const BROWSER_OR_NETWORK_TASK_PATTERN =
  /(browser|page|navigate|click|type|screenshot|scrape|network|request|response|api|traffic|hook|capture|intercept|monitor|浏览器|页面|导航|点击|输入|截图|爬取|网络|请求|响应|接口|流量|抓包|拦截|监控)/i;
const MAINTENANCE_TASK_PATTERN =
  /(token budget|cache|artifact|extension|plugin|reload|doctor|cleanup|memory|profile|tool list|令牌预算|缓存|工件|扩展|插件|重载|环境诊断|清理|内存|配置)/i;

// ── Prerequisite Map ──

interface PrerequisiteEntry {
  condition: string;
  check: (state: RoutingState) => boolean;
  fix: string;
}

/**
 * Aggregate prerequisite declarations from domain manifests.
 * Cached lazily — manifests are immutable at runtime.
 */
let _cachedPrerequisites: Record<string, PrerequisiteEntry[]> | null = null;
function getEffectivePrerequisites(): Record<string, PrerequisiteEntry[]> {
  if (_cachedPrerequisites) return _cachedPrerequisites;
  const merged: Record<string, PrerequisiteEntry[]> = {};
  for (const m of getAllManifests()) {
    if (m.prerequisites) {
      for (const [toolName, entries] of Object.entries(m.prerequisites)) {
        merged[toolName] = entries.map((e) => ({
          condition: e.condition,
          check: () => false,
          fix: e.fix,
        }));
      }
    }
  }
  _cachedPrerequisites = merged;
  return _cachedPrerequisites;
}

// ── Helper Functions ──

function detectWorkflowIntent(query: string): WorkflowRule | null {
  const matches: WorkflowRule[] = [];
  for (const rule of getEffectiveWorkflowRules()) {
    for (const pattern of rule.patterns) {
      if (pattern.test(query)) {
        matches.push(rule);
        break;
      }
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.priority - a.priority);
  return matches[0]!;
}

function matchWorkflowRoute(query: string, ctx: MCPServerContext): RoutedWorkflowMatch | null {
  let bestMatch: RoutedWorkflowMatch | null = null;

  for (const [workflowId, runtimeRecord] of ctx.extensionWorkflowRuntimeById.entries()) {
    const route = runtimeRecord.route ?? runtimeRecord.workflow.route;
    if (!route) {
      continue;
    }

    const descriptor = ctx.extensionWorkflowsById.get(workflowId);
    const name = descriptor?.displayName ?? runtimeRecord.workflow.displayName;
    const description =
      descriptor?.description ?? runtimeRecord.workflow.description ?? 'Workflow route';

    for (const pattern of route.triggerPatterns) {
      if (!pattern.test(query)) {
        continue;
      }

      const confidence = route.priority / 100;
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = {
          workflow: {
            id: workflowId,
            name,
            description,
            route,
          },
          confidence,
          matchedPattern: pattern.source,
        };
      }
      break;
    }
  }

  return bestMatch;
}

function getToolInputSchema(
  toolName: string,
  ctx: MCPServerContext,
): Tool['inputSchema'] | undefined {
  const canonicalName = normalizeToolName(toolName);

  const builtInTool = getAllToolsByName().get(canonicalName);
  if (builtInTool) {
    return builtInTool.inputSchema;
  }

  const extTool = ctx.extensionToolsByName.get(canonicalName);
  if (extTool) {
    return extTool.tool.inputSchema;
  }

  const metaTool = ctx.metaToolsByName.get(canonicalName);
  if (metaTool) {
    return metaTool.inputSchema;
  }

  return undefined;
}

function getToolDescription(toolName: string, ctx: MCPServerContext): string {
  const canonicalName = normalizeToolName(toolName);

  const builtInTool = getAllToolsByName().get(canonicalName);
  if (builtInTool?.description) {
    return builtInTool.description.split('\n')[0] || 'No description available';
  }

  const extTool = ctx.extensionToolsByName.get(canonicalName);
  if (extTool?.tool?.description) {
    return extTool.tool.description.split('\n')[0] || 'No description available';
  }

  const metaTool = ctx.metaToolsByName.get(canonicalName);
  if (metaTool?.description) {
    return metaTool.description.split('\n')[0] || 'No description available';
  }

  return 'No description available';
}

function isActive(toolName: string, ctx: MCPServerContext): boolean {
  const canonicalName = normalizeToolName(toolName);
  const activeTools = new Set([
    ...ctx.selectedTools.map((tool) => tool.name),
    ...ctx.activatedToolNames,
  ]);
  return activeTools.has(canonicalName);
}

function getAvailableToolNames(ctx: MCPServerContext): Set<string> {
  return new Set([...allTools.map((tool) => tool.name), ...ctx.extensionToolsByName.keys()]);
}

async function probeActivePage(ctx: MCPServerContext): Promise<boolean> {
  if (!ctx.pageController || typeof ctx.pageController.getPage !== 'function') return false;
  try {
    return Boolean(await ctx.pageController.getPage());
  } catch {
    return false;
  }
}

function probeNetworkEnabled(ctx: MCPServerContext): boolean {
  if (!ctx.consoleMonitor) return false;
  try {
    if (typeof ctx.consoleMonitor.getNetworkStatus === 'function') {
      return Boolean(ctx.consoleMonitor.getNetworkStatus().enabled);
    }
    if (typeof ctx.consoleMonitor.isNetworkEnabled === 'function') {
      return Boolean(ctx.consoleMonitor.isNetworkEnabled());
    }
  } catch {
    /* probe failure → not enabled */
  }
  return false;
}

function probeCapturedRequests(ctx: MCPServerContext): number {
  if (!ctx.consoleMonitor || typeof ctx.consoleMonitor.getNetworkRequests !== 'function') return 0;
  try {
    const requests = ctx.consoleMonitor.getNetworkRequests({ limit: 1 });
    return Array.isArray(requests) ? requests.length : 0;
  } catch {
    try {
      const requests = ctx.consoleMonitor.getNetworkRequests();
      return Array.isArray(requests) ? requests.length : 0;
    } catch {
      return 0;
    }
  }
}

async function getRoutingState(ctx: MCPServerContext): Promise<RoutingState> {
  return {
    hasActivePage: await probeActivePage(ctx),
    networkEnabled: probeNetworkEnabled(ctx),
    capturedRequestCount: probeCapturedRequests(ctx),
  };
}

function buildWorkflowToolSequence(
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

function buildPresetToolSequence(
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

function buildPresetRecommendations(
  match: RoutedWorkflowMatch,
  state: RoutingState,
  ctx: MCPServerContext,
  availableToolNames: Set<string>,
): ToolSearchResult[] {
  return buildPresetToolSequence(match, state, availableToolNames).map((plannedTool, index) => ({
    name: plannedTool.name,
    domain:
      getToolDomain(plannedTool.name) ??
      ctx.extensionToolsByName.get(plannedTool.name)?.domain ??
      null,
    shortDescription: plannedTool.description,
    score: match.workflow.route.priority + match.confidence - index * 0.01,
    isActive: isActive(plannedTool.name, ctx),
  }));
}

function buildWorkflowRouteRecommendation(
  match: RoutedWorkflowMatch,
  ctx: MCPServerContext,
): ToolSearchResult {
  return {
    name: 'run_extension_workflow',
    domain:
      getToolDomain('run_extension_workflow') ??
      ctx.extensionToolsByName.get('run_extension_workflow')?.domain ??
      null,
    shortDescription: `Execute routed workflow ${match.workflow.name} (${match.workflow.id}) via run_extension_workflow`,
    score: match.workflow.route.priority + match.confidence,
    isActive: isActive('run_extension_workflow', ctx),
  };
}

function buildRouteMatchMetadata(
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
      isActive: isActive(step.toolName, ctx),
    })),
  };
}

function isBrowserOrNetworkTask(task: string, workflow: WorkflowRule | null): boolean {
  return (
    workflow?.domain === 'browser' ||
    workflow?.domain === 'network' ||
    BROWSER_OR_NETWORK_TASK_PATTERN.test(task)
  );
}

function isMaintenanceTask(task: string): boolean {
  return MAINTENANCE_TASK_PATTERN.test(task);
}

function rerankResultsForContext(
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

// ── Main Router Function ──

export async function routeToolRequest(
  request: RouterRequest,
  ctx: MCPServerContext,
  searchEngine: ToolSearchEngine,
): Promise<RouterResponse> {
  const { task, context = {} } = request;
  const maxRecommendations = context.maxRecommendations || 5;

  logger.info('[ToolRouter] Routing request', { task, context });

  await ensureWorkflowsLoaded(ctx);
  const workflow = detectWorkflowIntent(task);
  const activeNames = getActiveToolNames(ctx);
  const routingState = await getRoutingState(ctx);
  const availableToolNames = getAvailableToolNames(ctx);
  const routeMatch = matchWorkflowRoute(task, ctx);
  let presetPlannedToolNames: Set<string> | null = null;

  const searchResults = await searchEngine.search(task, maxRecommendations * 2, activeNames);

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
      domain: getToolDomain(name) ?? ctx.extensionToolsByName.get(name)?.domain ?? null,
      shortDescription: getToolDescription(name, ctx),
      score: workflow.priority - index * 0.01,
      isActive: isActive(name, ctx),
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
    const toolIsActive = isActive(result.name, ctx);

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

    // Inject prerequisite hints (STS2 P5)
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
    const workflowRecommendation =
      recommendations.find((recommendation) => recommendation.name === 'run_extension_workflow') ??
      recommendations[0];

    if (workflowRecommendation) {
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
          ...generateExampleArgs(workflowRecommendation.inputSchema ?? { type: 'object' }),
          workflowId: routeMatchMetadata.id,
        },
        description: `Execute routed workflow ${routeMatchMetadata.name}`,
      });
    }
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

// ── Call Tool Command Builder ──

export function buildCallToolCommand(toolName: string, schema: Tool['inputSchema']): string {
  return `call_tool({ name: "${toolName}", args: ${JSON.stringify(generateExampleArgs(schema))} })`;
}

// ── Example Args Generator ──

export function generateExampleArgs(schema: Tool['inputSchema']): Record<string, unknown> {
  if (schema?.type !== 'object' || !schema.properties) {
    return {};
  }

  const example: Record<string, unknown> = {};
  const required = new Set<string>(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );

  for (const [key, prop] of Object.entries(schema.properties as Record<string, unknown>)) {
    const propSchema = prop as Record<string, unknown>;
    if (!required.has(key) && propSchema.default === undefined) {
      continue;
    }

    if (propSchema.default !== undefined) {
      example[key] = propSchema.default;
    } else if (propSchema.enum && Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
      example[key] = propSchema.enum[0];
    } else if (propSchema.type === 'string') {
      example[key] = `<${key}>`;
    } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
      example[key] = 0;
    } else if (propSchema.type === 'boolean') {
      example[key] = false;
    } else if (propSchema.type === 'array') {
      example[key] = [];
    } else if (propSchema.type === 'object') {
      example[key] = {};
    }
  }

  return example;
}

// ── Describe Tool Utility ──

export function describeTool(
  toolName: string,
  ctx: MCPServerContext,
): { name: string; description: string; inputSchema: Tool['inputSchema'] } | null {
  const canonicalName = normalizeToolName(toolName);
  const schema = getToolInputSchema(canonicalName, ctx);
  if (!schema) {
    return null;
  }

  return {
    name: canonicalName,
    description: getToolDescription(canonicalName, ctx),
    inputSchema: schema,
  };
}
