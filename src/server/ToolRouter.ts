/**
 * Tool Router - One-stop routing layer for tool discovery, activation, and execution.
 *
 * Compresses the multi-step "search → activate → call" protocol into 1-2 tool calls.
 * Implements workflow-first heuristics and safety guardrails.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@utils/logger';
import { allTools, getToolDomain } from '@server/ToolCatalog';
import type { MCPServerContext } from '@server/MCPServer.context';
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
}

/* ---------- Workflow Detection Rules ---------- */

interface WorkflowRule {
  patterns: RegExp[];
  domain: string;
  priority: number;
  tools: string[];
  hint: string;
}

const WORKFLOW_RULES: WorkflowRule[] = [
  {
    patterns: [
      /(capture|intercept|monitor|hook).*(network|request|response|api|traffic)/i,
      /(抓包|拦截|监控|hook).*(网络|请求|响应|api|流量)/i,
    ],
    domain: 'network',
    priority: 100,
    tools: ['web_api_capture_session', 'page_navigate', 'hooks_install_listener'],
    hint: 'Network capture workflow: Start capture session → Navigate to target → Inspect captured requests',
  },
  {
    patterns: [
      /(browser|page|navigate|screenshot|click|type|scrape)/i,
      /(浏览器|页面|导航|截图|点击|输入|爬取)/i,
    ],
    domain: 'browser',
    priority: 90,
    tools: ['page_navigate', 'page_screenshot', 'page_click', 'page_type', 'page_evaluate'],
    hint: 'Browser automation workflow: Navigate → Interact → Extract data',
  },
  {
    patterns: [
      /(deobfuscate|deobfusc|beautify|analyze).*(javascript|js|script|code)/i,
      /(反混淆|美化|分析).*(javascript|js|脚本|代码)/i,
    ],
    domain: 'analysis',
    priority: 85,
    tools: ['deobfuscate_javascript', 'bundle_inspect', 'ast_parse'],
    hint: 'JavaScript analysis workflow: Parse → Deobfuscate → Analyze AST',
  },
  {
    patterns: [
      /(workflow|extension|run)/i,
      /(工作流|扩展|运行)/i,
    ],
    domain: 'workflow',
    priority: 95,
    tools: ['run_extension_workflow', 'list_extension_workflows'],
    hint: 'Extension workflow: List available → Run specific workflow',
  },
];

/* ---------- Helper Functions ---------- */

function detectWorkflowIntent(query: string): WorkflowRule | null {
  const matches: WorkflowRule[] = [];
  for (const rule of WORKFLOW_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(query)) {
        matches.push(rule);
        break; // One pattern match per rule is enough
      }
    }
  }
  if (matches.length === 0) return null;
  // Pick highest priority (stable sort: first match wins on tie)
  matches.sort((a, b) => b.priority - a.priority);
  return matches[0]!;
}

function getToolInputSchema(toolName: string, ctx: MCPServerContext): Tool['inputSchema'] | undefined {
  // Check built-in tools
  const builtInTool = allTools.find(t => t.name === toolName);
  if (builtInTool) {
    return builtInTool.inputSchema;
  }

  // Check extension tools
  const extTool = ctx.extensionToolsByName.get(toolName);
  if (extTool) {
    return extTool.tool.inputSchema;
  }

  return undefined;
}

function getToolDescription(toolName: string, ctx: MCPServerContext): string {
  // Check built-in tools
  const builtInTool = allTools.find(t => t.name === toolName);
  if (builtInTool?.description) {
    return builtInTool.description.split('\n')[0] || 'No description available';
  }

  // Check extension tools
  const extTool = ctx.extensionToolsByName.get(toolName);
  if (extTool?.tool?.description) {
    return extTool.tool.description.split('\n')[0] || 'No description available';
  }

  return 'No description available';
}

function isActive(toolName: string, ctx: MCPServerContext): boolean {
  const activeTools = new Set([
    ...ctx.selectedTools.map(t => t.name),
    ...ctx.boostedToolNames,
    ...ctx.activatedToolNames,
    ...ctx.boostedExtensionToolNames,
  ]);
  return activeTools.has(toolName);
}

/* ---------- Main Router Function ---------- */

export async function routeToolRequest(
  request: RouterRequest,
  ctx: MCPServerContext,
  searchEngine: ToolSearchEngine,
): Promise<RouterResponse> {
  const { task, context = {} } = request;
  const maxRecommendations = context.maxRecommendations || 5;
  const autoActivate = context.autoActivate !== false; // Default to true

  logger.info('[ToolRouter] Routing request', { task, context });

  // Step 1: Detect workflow intent
  const workflow = detectWorkflowIntent(task);

  // Step 2: Perform search
  const searchResults = searchEngine.search(task, maxRecommendations * 2);

  // Step 3: Apply workflow-first heuristics + preferredDomain reranking
  let finalResults: ToolSearchResult[] = [];

  if (workflow) {
    // Prioritize workflow tools
    const workflowTools = workflow.tools.map(name => {
      const domain = getToolDomain(name);
      const isToolActive = isActive(name, ctx);
      return {
        name,
        domain,
        shortDescription: getToolDescription(name, ctx),
        score: workflow.priority,
        isActive: isToolActive,
      };
    });

    // Merge with search results (workflow tools first)
    const workflowNames = new Set(workflow.tools);
    const otherResults = searchResults.filter(r => !workflowNames.has(r.name));
    finalResults = [...workflowTools, ...otherResults].slice(0, maxRecommendations);
  } else {
    finalResults = searchResults.slice(0, maxRecommendations);
  }

  // Apply preferredDomain boost if specified
  if (context.preferredDomain && finalResults.length > 0) {
    const domainBoostFactor = 1.15;
    finalResults = finalResults.map(r => ({
      ...r,
      score: r.domain === context.preferredDomain ? r.score * domainBoostFactor : r.score,
    }));
    finalResults.sort((a, b) => b.score - a.score);
  }

  // Step 4: Build recommendations with input schemas
  const recommendations = finalResults.map(result => {
    const schema = getToolInputSchema(result.name, ctx);
    const isToolActive = isActive(result.name, ctx);

    const rec: RouterResponse['recommendations'][0] = {
      name: result.name,
      domain: result.domain,
      description: result.shortDescription,
      inputSchema: schema || { type: 'object' },
      score: result.score,
      isActive: isToolActive,
    };

    if (!isToolActive) {
      rec.activationCommand = `activate_tools with names: ["${result.name}"]`;
    }

    return rec;
  });

  // Step 5: Build next actions
  const nextActions: RouterResponse['nextActions'] = [];

  // Check if we need activation
  const inactiveTools = recommendations.filter(r => !r.isActive);

  if (inactiveTools.length > 0 && autoActivate) {
    // Auto-activate first tool if only one, or ask user if multiple
    const toActivate = inactiveTools.length === 1 ? [inactiveTools[0]] : [];

    if (toActivate.length > 0 && toActivate[0]) {
      nextActions.push({
        step: 1,
        action: 'activate',
        toolName: toActivate[0].name,
        command: `activate_tools with names: ["${toActivate[0].name}"]`,
        description: `Activate ${toActivate[0].name} tool`,
      });

      // Add call action for the activated tool
      nextActions.push({
        step: 2,
        action: 'call',
        toolName: toActivate[0].name,
        command: toActivate[0].name,
        exampleArgs: generateExampleArgs(toActivate[0].inputSchema),
        description: `Call ${toActivate[0].name} with appropriate arguments`,
      });
    } else {
      // Multiple inactive tools - recommend activation then call top1
      const topInactive = inactiveTools[0]!;
      nextActions.push({
        step: 1,
        action: 'activate',
        command: `activate_tools with names: [${inactiveTools.map(t => `"${t.name}"`).join(', ')}]`,
        description: `Activate ${inactiveTools.length} recommended tools`,
      });
      nextActions.push({
        step: 2,
        action: 'call',
        toolName: topInactive.name,
        command: topInactive.name,
        exampleArgs: generateExampleArgs(topInactive.inputSchema),
        description: `Call ${topInactive.name} (top recommendation)`,
      });
    }
  } else if (recommendations.length > 0 && recommendations[0]?.isActive) {
    // Top tool is already active - can call directly
    nextActions.push({
      step: 1,
      action: 'call',
      toolName: recommendations[0].name,
      command: recommendations[0].name,
      exampleArgs: generateExampleArgs(recommendations[0].inputSchema),
      description: `Call ${recommendations[0].name} with appropriate arguments`,
    });
  }

  // Step 6: Build response
  const response: RouterResponse = {
    recommendations,
    nextActions,
    workflowHint: workflow?.hint,
    autoActivated: false, // Will be set by caller if activation happens
  };

  return response;
}

/* ---------- Example Args Generator ---------- */

function generateExampleArgs(schema: Tool['inputSchema']): Record<string, unknown> {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return {};
  }

  const example: Record<string, unknown> = {};

  const required = new Set<string>(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );

  for (const [key, prop] of Object.entries(schema.properties as Record<string, unknown>)) {
    // Cast prop to a more specific type for property access
    const propSchema = prop as Record<string, unknown>;

    // Only include required fields to keep examples minimal
    if (!required.has(key) && propSchema.default === undefined) continue;

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
  const schema = getToolInputSchema(toolName, ctx);
  if (!schema) {
    return null;
  }

  return {
    name: toolName,
    description: getToolDescription(toolName, ctx),
    inputSchema: schema,
  };
}
