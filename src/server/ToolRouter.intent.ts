/**
 * ToolRouter.intent - Intent classification and workflow detection.
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { WorkflowRouteMetadata } from '@server/workflows/WorkflowContract';
import { getAllManifests } from '@server/registry/index';

// ── Workflow Detection Types ──

export interface WorkflowRule {
  patterns: RegExp[];
  domain: string;
  priority: number;
  tools: string[];
  hint: string;
}

export interface RoutedWorkflowMatch {
  workflow: {
    id: string;
    name: string;
    description: string;
    route: WorkflowRouteMetadata;
  };
  confidence: number;
  matchedPattern: string;
}

// ── Task Classification Patterns ──

export const BROWSER_OR_NETWORK_TASK_PATTERN =
  /(browser|page|navigate|click|type|screenshot|scrape|network|request|response|api|traffic|hook|capture|intercept|monitor|浏览器|页面|导航|点击|输入|截图|爬取|网络|请求|响应|接口|流量|抓包|拦截|监控)/i;

export const MAINTENANCE_TASK_PATTERN =
  /(token budget|cache|artifact|extension|plugin|reload|doctor|cleanup|memory|profile|tool list|令牌预算|缓存|工件|扩展|插件|重载|环境诊断|清理|内存|配置)/i;

export const STATELESS_COMPUTE_TASK_PATTERN =
  /(stateless|deterministic|pure compute|offline|decode|encode|hex|base64|protobuf|msgpack|checksum|hash|payload|frame|packet|bytes?|bytecode|pcap|protocol|state machine|field inference|ast transform|crypto harness|无状态|确定性|纯算|离线|解码|编码|十六进制|校验和|载荷|字节|协议|报文|帧|字段推断|状态机|构包)/i;

// ── Workflow Rules Cache ──

let cachedWorkflowRules: WorkflowRule[] | null = null;

// LRU cache for detectWorkflowIntent results (queries repeat frequently)
const intentCache = new Map<string, WorkflowRule | null>();
const INTENT_CACHE_MAX = 64;

/**
 * Aggregate workflow rules declared by domain manifests.
 * All routing metadata is now declared in each domain's manifest.ts,
 * following the open-closed principle (no hardcoded rules here).
 *
 * Cached lazily — manifests are immutable at runtime.
 */
export function getEffectiveWorkflowRules(): WorkflowRule[] {
  if (cachedWorkflowRules) return cachedWorkflowRules;
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
  cachedWorkflowRules = [...rules].toSorted(
    (a: WorkflowRule, b: WorkflowRule) => b.priority - a.priority,
  );
  // Invalidate intent cache when rules are recomputed
  intentCache.clear();
  return cachedWorkflowRules;
}

// ── Intent Detection Functions ──

export function detectWorkflowIntent(query: string): WorkflowRule | null {
  const cached = intentCache.get(query);
  if (cached !== undefined) return cached;

  const matches: WorkflowRule[] = [];
  for (const rule of getEffectiveWorkflowRules()) {
    for (const pattern of rule.patterns) {
      if (pattern.test(query)) {
        matches.push(rule);
        break;
      }
    }
  }
  const result =
    matches.length === 0 ? null : matches.toSorted((a, b) => b.priority - a.priority)[0]!;

  // Evict oldest entry when cache is full
  if (intentCache.size >= INTENT_CACHE_MAX) {
    const firstKey = intentCache.keys().next().value;
    if (firstKey !== undefined) intentCache.delete(firstKey);
  }
  intentCache.set(query, result);
  return result;
}

export function matchWorkflowRoute(
  query: string,
  ctx: MCPServerContext,
): RoutedWorkflowMatch | null {
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

// ── Task Classification Helpers ──

export function isBrowserOrNetworkTask(task: string, workflow: WorkflowRule | null): boolean {
  if (
    workflow?.domain !== 'browser' &&
    workflow?.domain !== 'network' &&
    isStatelessComputeTask(task)
  ) {
    return false;
  }

  return (
    workflow?.domain === 'browser' ||
    workflow?.domain === 'network' ||
    BROWSER_OR_NETWORK_TASK_PATTERN.test(task)
  );
}

export function isMaintenanceTask(task: string): boolean {
  return MAINTENANCE_TASK_PATTERN.test(task);
}

export function isStatelessComputeTask(task: string): boolean {
  return STATELESS_COMPUTE_TASK_PATTERN.test(task);
}
