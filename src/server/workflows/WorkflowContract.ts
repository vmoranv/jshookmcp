/**
 * Workflow contract for jshhookmcp.
 *
 * Workflows are declarative execution graphs built from four node types:
 * - ToolNode:     invoke a single MCP tool
 * - SequenceNode: steps run in order
 * - ParallelNode: steps run concurrently (with optional maxConcurrency)
 * - BranchNode:   conditional routing
 *
 * Workflow templates are registered and executed by the WorkflowEngine.
 */

/* ---------- Retry policy ---------- */

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  multiplier?: number;
}

/* ---------- Node types ---------- */

export type WorkflowNodeType = 'tool' | 'sequence' | 'parallel' | 'branch';

export interface ToolNode {
  readonly kind: 'tool';
  readonly id: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly retry?: RetryPolicy;
}

export interface SequenceNode {
  readonly kind: 'sequence';
  readonly id: string;
  readonly steps: WorkflowNode[];
}

export interface ParallelNode {
  readonly kind: 'parallel';
  readonly id: string;
  readonly steps: WorkflowNode[];
  readonly maxConcurrency?: number;
  readonly failFast?: boolean;
}

export interface BranchNode {
  readonly kind: 'branch';
  readonly id: string;
  /**
   * Predicate identifier — must be a registered predicate name in the
   * workflow engine (NOT an arbitrary JS string to eval).
   *
   * The engine resolves this to a `(ctx: WorkflowExecutionContext) => boolean`
   * from a whitelist registry, preventing code injection (C5 fix).
   */
  readonly predicateId: string;
  /**
   * Optional type-safe predicate function for direct use.
   * When both predicateId and predicateFn are set, predicateFn takes precedence.
   */
  readonly predicateFn?: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>;
  readonly whenTrue: WorkflowNode;
  readonly whenFalse?: WorkflowNode;
}

export type WorkflowNode = ToolNode | SequenceNode | ParallelNode | BranchNode;

/* ---------- Execution context ---------- */

export interface WorkflowExecutionContext {
  readonly workflowRunId: string;
  readonly profile: string;
  invokeTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  emitSpan(name: string, attrs?: Record<string, unknown>): void;
  emitMetric(
    name: string,
    value: number,
    type: 'counter' | 'gauge' | 'histogram',
    attrs?: Record<string, unknown>,
  ): void;
  getConfig<T = unknown>(path: string, fallback?: T): T;
}

/* ---------- Workflow contract ---------- */

export interface WorkflowContract {
  readonly kind: 'workflow-contract';
  readonly version: 1;
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly timeoutMs?: number;
  readonly defaultMaxConcurrency?: number;

  /** Build the declarative execution graph. */
  build(ctx: WorkflowExecutionContext): WorkflowNode;
  /** Called when workflow starts. */
  onStart?(ctx: WorkflowExecutionContext): Promise<void> | void;
  /** Called when workflow finishes successfully. */
  onFinish?(ctx: WorkflowExecutionContext, result: unknown): Promise<void> | void;
  /** Called on workflow error. */
  onError?(ctx: WorkflowExecutionContext, error: Error): Promise<void> | void;
}

/* ---------- Builder helpers ---------- */

export interface ToolNodeOptions {
  input?: Record<string, unknown>;
  retry?: RetryPolicy;
  timeoutMs?: number;
}

export function toolNode(
  id: string,
  toolName: string,
  options?: ToolNodeOptions,
): ToolNode {
  return { kind: 'tool', id, toolName, input: options?.input, retry: options?.retry, timeoutMs: options?.timeoutMs };
}

export function sequenceNode(id: string, steps: WorkflowNode[]): SequenceNode {
  return { kind: 'sequence', id, steps };
}

export function parallelNode(
  id: string,
  steps: WorkflowNode[],
  maxConcurrency = 4,
  failFast = false,
): ParallelNode {
  return { kind: 'parallel', id, steps, maxConcurrency, failFast };
}

export function branchNode(
  id: string,
  predicateId: string,
  whenTrue: WorkflowNode,
  whenFalse?: WorkflowNode,
  predicateFn?: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>,
): BranchNode {
  return { kind: 'branch', id, predicateId, predicateFn, whenTrue, whenFalse };
}
