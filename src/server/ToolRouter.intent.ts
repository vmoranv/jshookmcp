/**
 * ToolRouter.intent - Intent classification and workflow detection.
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { WorkflowRouteMetadata } from '@server/workflows/WorkflowContract';
import { getLoadedManifests } from '@server/registry/state';

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

const BROWSER_OR_NETWORK_TASK_PATTERN =
  /(browser|page|navigate|click|type|screenshot|scrape|network|request|response|api|traffic|hook|capture|intercept|monitor|浏览器|页面|导航|点击|输入|截图|爬取|网络|请求|响应|接口|流量|抓包|拦截|监控)/i;

const MAINTENANCE_TASK_PATTERN =
  /(token budget|cache|artifact|extension|plugin|reload|doctor|cleanup|memory|profile|tool list|令牌预算|缓存|工件|扩展|插件|重载|环境诊断|清理|内存|配置)/i;

const STATELESS_COMPUTE_TASK_PATTERN =
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
function getEffectiveWorkflowRules(): WorkflowRule[] {
  if (cachedWorkflowRules) return cachedWorkflowRules;
  const rules: WorkflowRule[] = [];
  for (const m of getLoadedManifests()) {
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

/**
 * Derive cross-domain workflow patterns dynamically from manifest toolDependencies.
 * When top search results span domains connected by dependency edges, this
 * suggests a coordinated tool sequence based purely on declared tool relationships
 * — no hardcoded workflow patterns. The dependency graph is the single source
 * of truth for cross-domain tool relationships.
 */
export interface DynamicCrossDomainPattern {
  id: string;
  hint: string;
  domains: string[];
  tools: string[];
  priority: number;
}

export function detectCrossDomainFromDependencies(
  results: ReadonlyArray<{ name: string; domain: string | null }>,
  availableToolNames: ReadonlySet<string>,
): DynamicCrossDomainPattern | null {
  if (results.length < 2) return null;

  const manifests = getLoadedManifests();
  if (manifests.length === 0) return null;

  // Build domain → set of domains it connects to via toolDependencies
  const { domainEdges } = buildDomainDependencyGraph(manifests, availableToolNames);

  // Collect domains present in top results
  const resultDomains = new Set<string>();
  for (const r of results) {
    if (r.domain) {
      resultDomains.add(r.domain);
    }
  }

  if (resultDomains.size < 2) return null;

  return findConnectedDomainPair(resultDomains, domainEdges, manifests, availableToolNames);
}

/** Domain→domain edges derived from manifests' declared toolDependencies. */
function buildDomainDependencyGraph(
  manifests: ReturnType<typeof getLoadedManifests>,
  availableToolNames: ReadonlySet<string>,
): { domainEdges: Map<string, Set<string>> } {
  const domainEdges = new Map<string, Set<string>>();
  const domainTools = new Map<string, Set<string>>();

  for (const m of manifests) {
    if (!m.toolDependencies) continue;
    for (const dep of m.toolDependencies) {
      const domains = new Set(getEffectiveDomainsForDependency(dep, manifests));
      const fromDomain = getToolDomainForDependency(dep.from, manifests);
      const toDomain = getToolDomainForDependency(dep.to, manifests);

      if (fromDomain && toDomain && fromDomain !== toDomain) {
        const edges = domainEdges.get(fromDomain) ?? new Set<string>();
        edges.add(toDomain);
        domainEdges.set(fromDomain, edges);

        const tools = domainTools.get(fromDomain) ?? new Set<string>();
        tools.add(dep.from);
        if (availableToolNames.has(dep.to)) tools.add(dep.to);
        domainTools.set(fromDomain, tools);
      }

      for (const d of domains) {
        if (d !== fromDomain && fromDomain) {
          const edges = domainEdges.get(fromDomain) ?? new Set<string>();
          edges.add(d);
          domainEdges.set(fromDomain, edges);
        }
      }
    }
  }
  return { domainEdges };
}

/** First connected result-domain pair with ≥2 available linked tools. */
function findConnectedDomainPair(
  resultDomains: ReadonlySet<string>,
  domainEdges: ReadonlyMap<string, ReadonlySet<string>>,
  manifests: ReturnType<typeof getLoadedManifests>,
  availableToolNames: ReadonlySet<string>,
): DynamicCrossDomainPattern | null {
  const resultDomainArray = [...resultDomains];
  for (let i = 0; i < resultDomainArray.length; i++) {
    for (let j = i + 1; j < resultDomainArray.length; j++) {
      const d1 = resultDomainArray[i]!;
      const d2 = resultDomainArray[j]!;
      const connected = domainEdges.get(d1)?.has(d2) || domainEdges.get(d2)?.has(d1);
      if (!connected) continue;

      const sequenceTools = collectLinkedTools(d1, d2, manifests, availableToolNames);
      if (sequenceTools.length < 2) continue;

      return {
        id: `dynamic-${d1}-${d2}`,
        hint: `${d1} ↔ ${d2} (declared dependency)`,
        domains: [d1, d2],
        tools: sequenceTools.slice(0, 5),
        priority: 75,
      };
    }
  }

  return null;
}

/** Dependency-declared tools connecting d1/d2 in either direction (available only). */
function collectLinkedTools(
  d1: string,
  d2: string,
  allManifests: ReturnType<typeof getLoadedManifests>,
  activeToolNames: ReadonlySet<string>,
): string[] {
  const linkedTools = new Set<string>();
  for (const m of allManifests) {
    if (!m.toolDependencies) continue;
    for (const dep of m.toolDependencies) {
      const fromDomain = getToolDomainForDependency(dep.from, allManifests);
      const toDomain = getToolDomainForDependency(dep.to, allManifests);
      if ((fromDomain === d1 && toDomain === d2) || (fromDomain === d2 && toDomain === d1)) {
        if (activeToolNames.has(dep.from)) linkedTools.add(dep.from);
        if (activeToolNames.has(dep.to)) linkedTools.add(dep.to);
      }
    }
  }
  return [...linkedTools];
}
function getToolDomainForDependency(
  toolName: string,
  manifests: ReturnType<typeof getLoadedManifests>,
): string | null {
  for (const m of manifests) {
    for (const reg of m.registrations) {
      if (reg.tool.name === toolName) {
        return reg.domain ?? m.domain;
      }
    }
  }
  return null;
}

function getEffectiveDomainsForDependency(
  dep: { from: string; to: string },
  manifests: ReturnType<typeof getLoadedManifests>,
): string[] {
  return [
    getToolDomainForDependency(dep.from, manifests),
    getToolDomainForDependency(dep.to, manifests),
  ].filter((d): d is string => d !== null);
}
