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

// ── Workflow Rules Cache ──

let _cachedWorkflowRules: WorkflowRule[] | null = null;

/**
 * Aggregate workflow rules declared by domain manifests.
 * All routing metadata is now declared in each domain's manifest.ts,
 * following the open-closed principle (no hardcoded rules here).
 *
 * Cached lazily — manifests are immutable at runtime.
 */
export function getEffectiveWorkflowRules(): WorkflowRule[] {
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

// ── Intent Detection Functions ──

export function detectWorkflowIntent(query: string): WorkflowRule | null {
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
  return (
    workflow?.domain === 'browser' ||
    workflow?.domain === 'network' ||
    BROWSER_OR_NETWORK_TASK_PATTERN.test(task)
  );
}

export function isMaintenanceTask(task: string): boolean {
  return MAINTENANCE_TASK_PATTERN.test(task);
}
