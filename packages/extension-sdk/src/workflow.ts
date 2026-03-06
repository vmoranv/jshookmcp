export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  multiplier?: number;
}

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
  readonly predicateId: string;
  readonly predicateFn?: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>;
  readonly whenTrue: WorkflowNode;
  readonly whenFalse?: WorkflowNode;
}

export type WorkflowNode = ToolNode | SequenceNode | ParallelNode | BranchNode;

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

export interface WorkflowContract {
  readonly kind: 'workflow-contract';
  readonly version: 1;
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly timeoutMs?: number;
  readonly defaultMaxConcurrency?: number;
  build(ctx: WorkflowExecutionContext): WorkflowNode;
  onStart?(ctx: WorkflowExecutionContext): Promise<void> | void;
  onFinish?(ctx: WorkflowExecutionContext, result: unknown): Promise<void> | void;
  onError?(ctx: WorkflowExecutionContext, error: Error): Promise<void> | void;
}

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
  return {
    kind: 'tool',
    id,
    toolName,
    input: options?.input,
    retry: options?.retry,
    timeoutMs: options?.timeoutMs,
  };
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
