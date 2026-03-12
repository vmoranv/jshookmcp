import { randomUUID } from 'node:crypto';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolArgs, ToolResponse } from '@server/types';
import type {
  BranchNode,
  ParallelNode,
  SequenceNode,
  ToolNode,
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

interface InternalExecutionContext extends WorkflowExecutionContext {
  readonly stepResults: Map<string, unknown>;
}

export interface ExecuteWorkflowOptions {
  profile?: string;
  config?: JsonRecord;
  nodeInputOverrides?: Record<string, Record<string, unknown>>;
  timeoutMs?: number;
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
    const timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
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
  const toolResponse = response as ToolResponse & { content?: Array<{ type?: string; text?: string }> };
  const text = toolResponse.content?.find((item) => item.type === 'text')?.text;
  if (typeof text !== 'string') return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as JsonRecord : undefined;
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
  if (payload?.success === false) return { success: 0, failure: 1 };

  if ('error' in (value as Record<string, unknown>)) {
    return { success: 0, failure: 1 };
  }

  return { success: 0, failure: 0 };
}

async function runToolNode(
  ctx: MCPServerContext,
  node: ToolNode,
  overrides: ExecuteWorkflowOptions['nodeInputOverrides'],
): Promise<unknown> {
  const mergedInput: ToolArgs = {
    ...node.input,
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
  const results: unknown[] = new Array(node.steps.length);
  let nextIndex = 0;
  let stopped = false;

  const worker = async () => {
    while (true) {
      if (stopped) return;
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= node.steps.length) return;

      const step = node.steps[currentIndex];
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

  await Promise.all(Array.from({ length: Math.min(concurrency, node.steps.length) }, () => worker()));
  return results;
}

async function evaluatePredicate(node: BranchNode, ctx: InternalExecutionContext): Promise<boolean> {
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

  throw new Error(`Unknown workflow predicateId "${node.predicateId}"`);
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
      result = await runToolNode(ctx, node, options.nodeInputOverrides);
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
    default:
      throw new Error(`Unsupported workflow node kind: ${(node as { kind: string }).kind}`);
  }

  executionContext.stepResults.set(node.id, result);
  executionContext.emitSpan('workflow.node.finish', { nodeId: node.id, kind: node.kind });
  return result;
}

export async function executeExtensionWorkflow(
  ctx: MCPServerContext,
  workflow: WorkflowContract,
  options: ExecuteWorkflowOptions = {},
): Promise<ExecuteWorkflowResult> {
  const runId = randomUUID();
  const profile = options.profile ?? String(ctx.currentTier ?? 'workflow');
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const metrics: WorkflowMetric[] = [];
  const spans: WorkflowSpan[] = [];
  const stepResults = new Map<string, unknown>();
  const mergedConfig = options.config
    ? { ...(ctx.config as unknown as JsonRecord), ...options.config }
    : ctx.config;

  const executionContext: InternalExecutionContext = {
    workflowRunId: runId,
    profile,
    stepResults,
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
    const result = await withTimeout(
      executeNode(ctx, graph, executionContext, options),
      options.timeoutMs ?? workflow.timeoutMs ?? 0,
      `Workflow "${workflow.id}"`,
    );
    await workflow.onFinish?.(executionContext, result);
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
