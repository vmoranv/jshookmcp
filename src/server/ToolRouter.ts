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
import { ToolSearchEngine } from '@server/ToolSearch';
import type { ToolSearchResult } from '@server/ToolSearch';

/* ---------- Types ---------- */

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
  /** Whether auto-activation was performed */
  autoActivated?: boolean;
  /** Canonical tool names auto-activated by the handler */
  activatedNames?: string[];
  /** Hint for clients that do not support tools/list_changed */
  callToolHint?: string;
}

/* ---------- Workflow Detection Rules ---------- */

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

const WORKFLOW_RULES: WorkflowRule[] = [
  {
    patterns: [
      /(capture|intercept|monitor|hook).*(network|request|response|api|traffic)/i,
      /(抓包|拦截|监控|hook).*(网络|请求|响应|api|流量)/i,
    ],
    domain: 'network',
    priority: 100,
    tools: ['web_api_capture_session', 'network_enable', 'page_navigate', 'network_get_requests'],
    hint: 'Network capture workflow: bootstrap browser/page state -> enable capture -> navigate or act -> inspect captured requests',
  },
  {
    patterns: [
      /(browser|page|navigate|screenshot|click|type|scrape)/i,
      /(浏览器|页面|导航|截图|点击|输入|爬取)/i,
    ],
    domain: 'browser',
    priority: 90,
    tools: ['page_navigate', 'page_screenshot', 'page_click', 'page_type', 'page_evaluate'],
    hint: 'Browser automation workflow: bootstrap browser/page state -> navigate -> interact -> extract data',
  },
  {
    patterns: [
      /(deobfuscate|deobfusc|beautify|analyze).*(javascript|js|script|code)/i,
      /(反混淆|美化|分析).*(javascript|js|脚本|代码)/i,
    ],
    domain: 'core',
    priority: 85,
    tools: ['deobfuscate', 'advanced_deobfuscate', 'extract_function_tree'],
    hint: 'JavaScript analysis workflow: collect -> deobfuscate -> inspect function tree',
  },
  {
    patterns: [
      /(workflow|extension|run)/i,
      /(工作流|扩展|运行)/i,
    ],
    domain: 'workflow',
    priority: 95,
    tools: ['run_extension_workflow', 'list_extension_workflows'],
    hint: 'Extension workflow: list available workflows -> run the best matching workflow',
  },
];

const BROWSER_OR_NETWORK_TASK_PATTERN =
  /(browser|page|navigate|click|type|screenshot|scrape|network|request|response|api|traffic|hook|capture|intercept|monitor|浏览器|页面|导航|点击|输入|截图|爬取|网络|请求|响应|接口|流量|抓包|拦截|监控)/i;
const MAINTENANCE_TASK_PATTERN =
  /(token budget|cache|artifact|extension|plugin|reload|doctor|cleanup|memory|profile|tool list|令牌预算|缓存|工件|扩展|插件|重载|环境诊断|清理|内存|配置)/i;

/* ---------- Helper Functions ---------- */

function detectWorkflowIntent(query: string): WorkflowRule | null {
  const matches: WorkflowRule[] = [];
  for (const rule of WORKFLOW_RULES) {
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

function getToolInputSchema(toolName: string, ctx: MCPServerContext): Tool['inputSchema'] | undefined {
  const canonicalName = normalizeToolName(toolName);

  const builtInTool = allTools.find((tool) => tool.name === canonicalName);
  if (builtInTool) {
    return builtInTool.inputSchema;
  }

  const extTool = ctx.extensionToolsByName.get(canonicalName);
  if (extTool) {
    return extTool.tool.inputSchema;
  }

  return undefined;
}

function getToolDescription(toolName: string, ctx: MCPServerContext): string {
  const canonicalName = normalizeToolName(toolName);

  const builtInTool = allTools.find((tool) => tool.name === canonicalName);
  if (builtInTool?.description) {
    return builtInTool.description.split('\n')[0] || 'No description available';
  }

  const extTool = ctx.extensionToolsByName.get(canonicalName);
  if (extTool?.tool?.description) {
    return extTool.tool.description.split('\n')[0] || 'No description available';
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
  return new Set([
    ...allTools.map((tool) => tool.name),
    ...ctx.extensionToolsByName.keys(),
  ]);
}

async function getRoutingState(ctx: MCPServerContext): Promise<RoutingState> {
  let hasActivePage = false;
  if (ctx.pageController && typeof ctx.pageController.getPage === 'function') {
    try {
      hasActivePage = Boolean(await ctx.pageController.getPage());
    } catch {
      hasActivePage = false;
    }
  }

  let networkEnabled = false;
  let capturedRequestCount = 0;
  if (ctx.consoleMonitor) {
    try {
      if (typeof ctx.consoleMonitor.getNetworkStatus === 'function') {
        networkEnabled = Boolean(ctx.consoleMonitor.getNetworkStatus().enabled);
      } else if (typeof ctx.consoleMonitor.isNetworkEnabled === 'function') {
        networkEnabled = Boolean(ctx.consoleMonitor.isNetworkEnabled());
      }
    } catch {
      networkEnabled = false;
    }

    try {
      if (typeof ctx.consoleMonitor.getNetworkRequests === 'function') {
        const requests = ctx.consoleMonitor.getNetworkRequests({ limit: 1 });
        if (Array.isArray(requests)) {
          capturedRequestCount = requests.length;
        }
      }
    } catch {
      try {
        if (typeof ctx.consoleMonitor.getNetworkRequests === 'function') {
          const requests = ctx.consoleMonitor.getNetworkRequests();
          if (Array.isArray(requests)) {
            capturedRequestCount = requests.length;
          }
        }
      } catch {
        capturedRequestCount = 0;
      }
    }
  }

  return {
    hasActivePage,
    networkEnabled,
    capturedRequestCount,
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

function isBrowserOrNetworkTask(task: string, workflow: WorkflowRule | null): boolean {
  return workflow?.domain === 'browser' ||
    workflow?.domain === 'network' ||
    BROWSER_OR_NETWORK_TASK_PATTERN.test(task);
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
      if (state.hasActivePage && state.networkEnabled && state.capturedRequestCount > 0 && result.name === 'network_get_requests') {
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

/* ---------- Main Router Function ---------- */

export async function routeToolRequest(
  request: RouterRequest,
  ctx: MCPServerContext,
  searchEngine: ToolSearchEngine,
): Promise<RouterResponse> {
  const { task, context = {} } = request;
  const maxRecommendations = context.maxRecommendations || 5;

  logger.info('[ToolRouter] Routing request', { task, context });

  const workflow = detectWorkflowIntent(task);
  const activeNames = getActiveToolNames(ctx);
  const routingState = await getRoutingState(ctx);
  const availableToolNames = getAvailableToolNames(ctx);

  const searchResults = searchEngine.search(task, maxRecommendations * 2, activeNames);

  let finalResults: ToolSearchResult[] = [];
  if (workflow) {
    const workflowSequence = buildWorkflowToolSequence(workflow, routingState, availableToolNames);
    const workflowTools = workflowSequence.map((name, index) => ({
      name,
      domain: getToolDomain(name) ?? ctx.extensionToolsByName.get(name)?.domain ?? null,
      shortDescription: getToolDescription(name, ctx),
      score: workflow.priority - (index * 0.01),
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
      score: result.domain === context.preferredDomain ? result.score * domainBoostFactor : result.score,
    }));
    finalResults.sort((a, b) => b.score - a.score);
  }

  finalResults = finalResults.slice(0, maxRecommendations);

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

    return recommendation;
  });

  const nextActions: RouterResponse['nextActions'] = [];
  const inactiveTools = recommendations.filter((recommendation) => !recommendation.isActive);
  const activationCandidates = (() => {
    if (!isBrowserOrNetworkTask(task, workflow) || isMaintenanceTask(task)) {
      return inactiveTools;
    }

    const nonMaintenanceTools = inactiveTools.filter((tool) => tool.domain !== 'maintenance');
    return nonMaintenanceTools.length > 0 ? nonMaintenanceTools : inactiveTools;
  })();

  if (recommendations.length > 0 && recommendations[0]?.isActive) {
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
    workflowHint: workflow?.hint,
    autoActivated: false,
  };
}

/* ---------- Call Tool Command Builder ---------- */

export function buildCallToolCommand(toolName: string, schema: Tool['inputSchema']): string {
  return `call_tool({ name: "${toolName}", args: ${JSON.stringify(generateExampleArgs(schema))} })`;
}

/* ---------- Example Args Generator ---------- */

export function generateExampleArgs(schema: Tool['inputSchema']): Record<string, unknown> {
  if (!schema || schema.type !== 'object' || !schema.properties) {
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

/* ---------- Describe Tool Utility ---------- */

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
