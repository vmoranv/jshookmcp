import { randomUUID } from 'node:crypto';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import { getEffectivePrerequisites } from '@server/ToolRouter.policy';
import { getRoutingState } from '@server/ToolRouter.probe';
import type { ToolArgs, ToolResponse } from '@server/types';
import type {
  BranchNode,
  FallbackNode,
  ParallelNode,
  SequenceNode,
  ToolNode,
  ToolNodeInput,
  WorkflowContract,
  WorkflowExecutionContext,
  WorkflowNode,
} from '@server/workflows/WorkflowContract';

type JsonRecord = Record<string, unknown>;

interface WorkflowMetric {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram';
  attrs?: Record<string, unknown>;
  at: string;
}

interface WorkflowSpan {
  name: string;
  attrs?: Record<string, unknown>;
  at: string;
}

/**
 * WorkflowDataBus — cross-node data bus for dynamic parameter passing.
 *
 * Supports expression templates like "${get-requests.scriptId}" to reference
 * outputs from previous steps.
 */
class WorkflowDataBus {
  private store: Map<string, unknown> = new Map();

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T;
  }

  /**
   * Get a value at a specific path within a stored object.
   * @param key - The key in the store
   * @param path - Dot-separated path (e.g., "content.0.text")
   */
  getValueAtPath(key: string, path: string): unknown {
    const value = this.store.get(key);
    if (!value || typeof value !== 'object') {
      return value;
    }

    // Parse tool response payload first if it's a ToolResponse
    const payload = parseToolPayload(value as ToolResponse);
    const obj = payload || (value as Record<string, unknown>);

    return path.split('.').reduce<unknown>((current, segment) => {
      if (current && typeof current === 'object') {
        // Handle array index access
        const arrayMatch = segment.match(/^(\d+)$/);
        if (arrayMatch && Array.isArray(current)) {
          return current[Number(arrayMatch[1])];
        }
        return (current as Record<string, unknown>)[segment];
      }
      return undefined;
    }, obj);
  }

  /**
   * Resolve expression templates like "${stepId.fieldPath}".
   * If the value is not an expression, returns it as-is.
   */
  resolve(template: string): unknown {
    const match = template.match(/^\$\{(.+)\}$/);
    if (!match || !match[1]) {
      return template;
    }

    const ref = match[1];
    const dotIndex = ref.indexOf('.');
    if (dotIndex === -1) {
      // Simple key reference
      return this.store.get(ref);
    }

    // Nested property access: stepId.fieldPath
    const stepId = ref.slice(0, dotIndex);
    const fieldPath = ref.slice(dotIndex + 1);
    return this.getValueAtPath(stepId, fieldPath);
  }
}

interface InternalExecutionContext extends WorkflowExecutionContext {
  readonly stepResults: Map<string, unknown>;
  readonly dataBus: WorkflowDataBus;
}

export interface ExecuteWorkflowOptions {
  profile?: string;
  config?: JsonRecord;
  /** Preflight mode: 'warn' (default) logs warnings, 'strict' throws, 'skip' bypasses. */
  preflightMode?: 'warn' | 'strict' | 'skip';
  nodeInputOverrides?: Record<string, Record<string, unknown>>;
  timeoutMs?: number;
}

interface PreflightWarning {
  nodeId: string;
  toolName: string;
  condition: string;
  fix: string;
}

class PreflightError extends Error {
  constructor(readonly warnings: PreflightWarning[]) {
    super(`Workflow preflight failed with ${warnings.length} unsatisfied prerequisite(s)`);
    this.name = 'PreflightError';
  }
}

export interface ExecuteWorkflowResult {
  workflowId: string;
  displayName: string;
  runId: string;
  profile: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: unknown;
  stepResults: Record<string, unknown>;
  metrics: WorkflowMetric[];
  spans: WorkflowSpan[];
}

function extractConfigValue<T = unknown>(config: unknown, path: string, fallback?: T): T {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = config;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return fallback as T;
    current = (current as Record<string, unknown>)[segment];
  }
  return (current as T) ?? (fallback as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function parseToolPayload(response: unknown): JsonRecord | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const toolResponse = response as ToolResponse & {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = toolResponse.content?.find((item) => item.type === 'text')?.text;
  if (typeof text !== 'string') return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as JsonRecord) : undefined;
  } catch {
    return undefined;
  }
}

function responseIndicatesFailure(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const toolResponse = response as ToolResponse & { isError?: boolean };
  if (toolResponse.isError) {
    return 'Tool returned MCP error response';
  }

  const payload = parseToolPayload(response);
  if (payload?.success === false) {
    return typeof payload.error === 'string' ? payload.error : 'Tool reported success=false';
  }
  return undefined;
}

function collectSuccessStats(value: unknown): { success: number; failure: number } {
  if (Array.isArray(value)) {
    return value.reduce(
      (acc, item) => {
        const next = collectSuccessStats(item);
        acc.success += next.success;
        acc.failure += next.failure;
        return acc;
      },
      { success: 0, failure: 0 },
    );
  }

  if (!value || typeof value !== 'object') {
    return { success: 0, failure: 0 };
  }

  const payload = parseToolPayload(value);
  if (payload?.success === true) return { success: 1, failure: 0 };
  /* istanbul ignore next */
  if (payload?.success === false) return { success: 0, failure: 1 };

  if ('error' in (value as Record<string, unknown>)) {
    return { success: 0, failure: 1 };
  }

  return { success: 0, failure: 0 };
}

function resolveInputFrom(
  mapping: Record<string, string>,
  dataBus: WorkflowDataBus,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [targetKey, sourceRef] of Object.entries(mapping)) {
    const template = sourceRef.startsWith('${') ? sourceRef : `\${${sourceRef}}`;
    resolved[targetKey] = dataBus.resolve(template);
  }
  return resolved;
}

/**
 * Recursively resolve expression templates in input values.
 * Handles nested objects and arrays.
 */
function resolveInputValues(
  input: Record<string, ToolNodeInput> | undefined,
  dataBus: WorkflowDataBus,
): Record<string, unknown> {
  if (!input) return {};

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    resolved[key] = resolveValue(value, dataBus);
  }
  return resolved;
}

function resolveValue(value: ToolNodeInput, dataBus: WorkflowDataBus): unknown {
  if (typeof value === 'string') {
    return dataBus.resolve(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item as ToolNodeInput, dataBus));
  }
  if (value && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveValue(v as ToolNodeInput, dataBus);
    }
    return resolved;
  }
  return value;
}

async function runToolNode(
  ctx: MCPServerContext,
  node: ToolNode,
  overrides: ExecuteWorkflowOptions['nodeInputOverrides'],
  executionContext: InternalExecutionContext,
): Promise<unknown> {
  const fromResolved = node.inputFrom
    ? resolveInputFrom(node.inputFrom, executionContext.dataBus)
    : {};
  const fromInputValues = node.input
    ? resolveInputValues(node.input, executionContext.dataBus)
    : {};
  const mergedInput: ToolArgs = {
    ...fromInputValues,
    ...fromResolved,
    ...overrides?.[node.id],
  };

  const runAttempt = async (): Promise<unknown> => {
    const response = await withTimeout(
      ctx.executeToolWithTracking(node.toolName, mergedInput),
      node.timeoutMs ?? 0,
      `Workflow tool node "${node.id}"`,
    );
    const failure = responseIndicatesFailure(response);
    if (failure) {
      throw new Error(failure);
    }
    // Store result in dataBus for subsequent nodes to reference
    executionContext.dataBus.set(node.id, response);
    return response;
  };

  const retry = node.retry;
  if (!retry) {
    return runAttempt();
  }

  let attempt = 0;
  let backoffMs = retry.backoffMs;
  while (attempt < retry.maxAttempts) {
    try {
      return await runAttempt();
    } catch (error) {
      attempt += 1;
      if (attempt >= retry.maxAttempts) {
        throw error;
      }
      await sleep(backoffMs);
      backoffMs = Math.max(0, Math.floor(backoffMs * (retry.multiplier ?? 1)));
    }
  }

  throw new Error(`Workflow tool node "${node.id}" exhausted retries`);
}

async function runParallelNode(
  ctx: MCPServerContext,
  node: ParallelNode,
  executionContext: InternalExecutionContext,
  options: ExecuteWorkflowOptions,
): Promise<unknown[]> {
  const concurrency = Math.max(1, node.maxConcurrency ?? 4);
  const results: unknown[] = Array.from({ length: node.steps.length });
  let nextIndex = 0;
  let stopped = false;

  const worker = async () => {
    while (true) {
      if (stopped) return;
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= node.steps.length) return;

      const step = node.steps[currentIndex];
      /* istanbul ignore next */
      if (!step) return;
      try {
        results[currentIndex] = await executeNode(ctx, step, executionContext, options);
      } catch (error) {
        if (node.failFast) {
          stopped = true;
          throw error;
        }
        results[currentIndex] = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, node.steps.length) }, () => worker()),
  );
  return results;
}

/**
 * Get a variable value from workflow context by key path.
 * Supports dot notation for nested access within step results.
 */
function getWorkflowVariable(stepResults: Map<string, unknown>, keyPath: string): unknown {
  // First try direct key lookup (stepId)
  if (stepResults.has(keyPath)) {
    return stepResults.get(keyPath);
  }

  // Then try dot-notation path traversal: stepId.field.subfield
  const segments = keyPath.split('.');
  const stepId = segments[0];
  const fieldSegments = segments.slice(1);

  if (!stepId || !stepResults.has(stepId)) {
    return undefined;
  }

  let current: unknown = stepResults.get(stepId);

  // Parse tool response payload if needed
  if (current && typeof current === 'object') {
    const payload = parseToolPayload(current as ToolResponse);
    if (payload) {
      current = payload;
    }
  }

  for (const segment of fieldSegments) {
    if (current && typeof current === 'object') {
      // Handle array index access
      const arrayMatch = segment.match(/^(\d+)$/);
      if (arrayMatch && Array.isArray(current)) {
        current = current[Number(arrayMatch[1])];
        continue;
      }
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

async function evaluatePredicate(
  node: BranchNode,
  ctx: InternalExecutionContext,
): Promise<boolean> {
  if (node.predicateFn) {
    return await node.predicateFn(ctx);
  }

  if (node.predicateId === 'always_true') return true;
  if (node.predicateId === 'always_false') return false;
  if (node.predicateId === 'any_step_failed') {
    return [...ctx.stepResults.values()].some((value) => collectSuccessStats(value).failure > 0);
  }

  const successRateMatch = node.predicateId.match(/success_rate_gte_(\d+)/i);
  if (successRateMatch) {
    const threshold = Number(successRateMatch[1]);
    const aggregate = [...ctx.stepResults.values()].reduce<{ success: number; failure: number }>(
      (acc, value) => {
        const next = collectSuccessStats(value);
        acc.success += next.success;
        acc.failure += next.failure;
        return acc;
      },
      { success: 0, failure: 0 },
    );
    const total = aggregate.success + aggregate.failure;
    if (total === 0) return false;
    return aggregate.success / total >= threshold / 100;
  }

  // Variable-based predicates: variable_equals_KEY_VALUE, variable_contains_KEY_SUBSTRING, variable_matches_KEY_PATTERN
  const equalsMatch = node.predicateId.match(/^variable_equals_(.+?)_(.+)$/);
  if (equalsMatch && equalsMatch[1] && equalsMatch[2]) {
    const keyPath = equalsMatch[1];
    const expectedValue = equalsMatch[2];
    const actualValue = getWorkflowVariable(ctx.stepResults, keyPath);
    return deepEquals(actualValue, expectedValue);
  }

  const containsMatch = node.predicateId.match(/^variable_contains_(.+?)_(.+)$/);
  if (containsMatch && containsMatch[1] && containsMatch[2]) {
    const keyPath = containsMatch[1];
    const substring = containsMatch[2];
    const value = getWorkflowVariable(ctx.stepResults, keyPath);
    if (typeof value !== 'string' && !Array.isArray(value)) {
      return false;
    }
    return String(value).includes(substring);
  }

  const matchesMatch = node.predicateId.match(/^variable_matches_(.+?)_(.+)$/);
  if (matchesMatch && matchesMatch[1] && matchesMatch[2]) {
    const keyPath = matchesMatch[1];
    const pattern = matchesMatch[2];
    const value = getWorkflowVariable(ctx.stepResults, keyPath);
    if (typeof value !== 'string') {
      return false;
    }
    try {
      const regex = new RegExp(pattern);
      return regex.test(value);
    } catch {
      return false;
    }
  }

  throw new Error(`Unknown workflow predicateId "${node.predicateId}"`);
}

/**
 * Deep equality check for two values.
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) {
      return false;
    }

    if (Array.isArray(a)) {
      const arrA = a as unknown[];
      const arrB = b as unknown[];
      return arrA.length === arrB.length && arrA.every((v, i) => deepEquals(v, arrB[i]));
    }

    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);

    if (keysA.length !== keysB.length) {
      return false;
    }

    return keysA.every((key) =>
      deepEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }

  return false;
}

async function executeNode(
  ctx: MCPServerContext,
  node: WorkflowNode,
  executionContext: InternalExecutionContext,
  options: ExecuteWorkflowOptions,
): Promise<unknown> {
  executionContext.emitSpan('workflow.node.start', { nodeId: node.id, kind: node.kind });

  let result: unknown;
  switch (node.kind) {
    case 'tool':
      result = await runToolNode(ctx, node, options.nodeInputOverrides, executionContext);
      break;
    case 'sequence': {
      const sequenceNode = node as SequenceNode;
      const items: unknown[] = [];
      for (const step of sequenceNode.steps) {
        items.push(await executeNode(ctx, step, executionContext, options));
      }
      result = items;
      break;
    }
    case 'parallel':
      result = await runParallelNode(ctx, node as ParallelNode, executionContext, options);
      break;
    case 'branch': {
      const branchNode = node as BranchNode;
      const predicate = await evaluatePredicate(branchNode, executionContext);
      const selected = predicate ? branchNode.whenTrue : branchNode.whenFalse;
      if (selected) {
        result = await executeNode(ctx, selected, executionContext, options);
      } else {
        result = undefined;
      }
      break;
    }
    case 'fallback': {
      const fallbackNode = node as FallbackNode;
      try {
        result = await executeNode(ctx, fallbackNode.primary, executionContext, options);
      } catch (error) {
        executionContext.emitSpan('workflow.node.fallback', {
          nodeId: fallbackNode.id,
          primaryNodeId: fallbackNode.primary.id,
          fallbackNodeId: fallbackNode.fallback.id,
          error: error instanceof Error ? error.message : String(error),
        });
        result = await executeNode(ctx, fallbackNode.fallback, executionContext, options);
      }
      break;
    }
    default:
      throw new Error(`Unsupported workflow node kind: ${(node as { kind: string }).kind}`);
  }

  executionContext.stepResults.set(node.id, result);
  executionContext.emitSpan('workflow.node.finish', { nodeId: node.id, kind: node.kind });
  return result;
}

/** Recursively collect all ToolNode instances from a workflow graph. */
function collectToolNodes(node: WorkflowNode): ToolNode[] {
  switch (node.kind) {
    case 'tool':
      return [node];
    case 'sequence':
    case 'parallel':
      return node.steps.flatMap((step) => collectToolNodes(step));
    case 'branch':
      return [
        ...collectToolNodes(node.whenTrue),
        ...(node.whenFalse ? collectToolNodes(node.whenFalse) : []),
      ];
    case 'fallback': {
      const fallbackNode = node as FallbackNode;
      return [
        ...collectToolNodes(fallbackNode.primary),
        ...collectToolNodes(fallbackNode.fallback),
      ];
    }
    default:
      return [];
  }
}

/**
 * Collect unsatisfied prerequisites for all tool nodes in the workflow graph.
 * Returns an array of warnings (not errors — preflight is warn-only mode).
 */
function getEvidenceState(ctx: MCPServerContext): {
  hasGraph: boolean;
  nodeCount: number;
  edgeCount: number;
} {
  try {
    const evidenceGraph = ctx.getDomainInstance<ReverseEvidenceGraph>('evidenceGraph');
    return evidenceGraph
      ? { hasGraph: true, nodeCount: evidenceGraph.nodeCount, edgeCount: evidenceGraph.edgeCount }
      : { hasGraph: false, nodeCount: 0, edgeCount: 0 };
  } catch {
    return { hasGraph: false, nodeCount: 0, edgeCount: 0 };
  }
}

function collectUnsatisfiedPrerequisites(
  graph: WorkflowNode,
  routingState: Awaited<ReturnType<typeof getRoutingState>>,
): PreflightWarning[] {
  const prerequisites = getEffectivePrerequisites();
  const warnings: PreflightWarning[] = [];

  for (const toolNode of collectToolNodes(graph)) {
    const toolPrerequisites = prerequisites[toolNode.toolName] ?? [];
    for (const prerequisite of toolPrerequisites) {
      // check() returns true when SATISFIED, false when not
      if (prerequisite.check(routingState)) {
        continue;
      }

      warnings.push({
        nodeId: toolNode.id,
        toolName: toolNode.toolName,
        condition: prerequisite.condition,
        fix: prerequisite.fix,
      });
    }
  }

  return warnings;
}

export async function executeExtensionWorkflow(
  ctx: MCPServerContext,
  workflow: WorkflowContract,
  options: ExecuteWorkflowOptions = {},
): Promise<ExecuteWorkflowResult> {
  const runId = randomUUID();
  const profile = options.profile ?? String(ctx.baseTier ?? 'workflow');
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const metrics: WorkflowMetric[] = [];
  const spans: WorkflowSpan[] = [];
  const stepResults = new Map<string, unknown>();
  const dataBus = new WorkflowDataBus();
  const mergedConfig = options.config
    ? { ...(ctx.config as unknown as JsonRecord), ...options.config }
    : ctx.config;

  const executionContext: InternalExecutionContext = {
    workflowRunId: runId,
    profile,
    stepResults,
    dataBus,
    invokeTool(toolName: string, args: Record<string, unknown>) {
      return ctx.executeToolWithTracking(toolName, args);
    },
    emitSpan(name, attrs) {
      spans.push({ name, attrs, at: new Date().toISOString() });
    },
    emitMetric(name, value, type, attrs) {
      metrics.push({ name, value, type, attrs, at: new Date().toISOString() });
    },
    getConfig(path, fallback) {
      return extractConfigValue(mergedConfig, path, fallback);
    },
  };

  try {
    await workflow.onStart?.(executionContext);
    const graph = workflow.build(executionContext);

    // ── Preflight Gate ────────────────────────────────────────────
    const preflightMode = options.preflightMode ?? 'warn';
    let preflightWarnings: PreflightWarning[] = [];

    if (preflightMode === 'skip') {
      executionContext.emitSpan('workflow.preflight', {
        mode: preflightMode,
        skipped: true,
        evidenceState: getEvidenceState(ctx),
        warningCount: 0,
      });
    } else {
      try {
        const routingState = await getRoutingState(ctx);
        const evidenceState = getEvidenceState(ctx);
        preflightWarnings = collectUnsatisfiedPrerequisites(graph, routingState);
        executionContext.emitSpan('workflow.preflight', {
          mode: preflightMode,
          routingState,
          evidenceState,
          warningCount: preflightWarnings.length,
          warnings: preflightWarnings,
        });

        if (preflightMode === 'strict' && preflightWarnings.length > 0) {
          throw new PreflightError(preflightWarnings);
        }
      } catch (error) {
        if (error instanceof PreflightError) {
          throw error;
        }
        // Preflight is best-effort — registry may not be initialised in tests
        executionContext.emitSpan('workflow.preflight', {
          mode: preflightMode,
          warningCount: 0,
          skipped: true,
          error: error instanceof Error ? error.message : String(error),
          evidenceState: getEvidenceState(ctx),
        });
      }
    }

    const result = await withTimeout(
      executeNode(ctx, graph, executionContext, options),
      options.timeoutMs ?? workflow.timeoutMs ?? 0,
      `Workflow "${workflow.id}"`,
    );
    await workflow.onFinish?.(executionContext, result);

    // ── Evidence Auto-Export ─────────────────────────────────────
    try {
      const evidenceGraph =
        typeof ctx.getDomainInstance === 'function'
          ? ctx.getDomainInstance<ReverseEvidenceGraph>('evidenceGraph')
          : undefined;
      if (evidenceGraph && evidenceGraph.nodeCount > 0) {
        stepResults.set('__evidenceSnapshot', evidenceGraph.exportJson());
        executionContext.emitSpan('workflow.evidence.auto-export', {
          nodeCount: evidenceGraph.nodeCount,
          edgeCount: evidenceGraph.edgeCount,
        });
      }
    } catch (exportError) {
      executionContext.emitSpan('workflow.evidence.auto-export', {
        skipped: true,
        error: exportError instanceof Error ? exportError.message : String(exportError),
      });
    }

    return {
      workflowId: workflow.id,
      displayName: workflow.displayName,
      runId,
      profile,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      result,
      stepResults: Object.fromEntries(stepResults.entries()),
      metrics,
      spans,
    };
  } catch (error) {
    const workflowError = error instanceof Error ? error : new Error(String(error));
    await workflow.onError?.(executionContext, workflowError);
    throw workflowError;
  }
}
