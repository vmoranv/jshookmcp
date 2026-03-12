/**
 * Workflow contract for jshookmcp.
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
   * from a whitelist registry to prevent code injection.
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

export abstract class WorkflowNodeBuilder<T extends WorkflowNode> {
  protected id: string;
  constructor(id: string) {
    this.id = id;
  }
  abstract build(): T;
}

export class ToolNodeBuilder extends WorkflowNodeBuilder<ToolNode> {
  private toolName: string;
  private _input?: Record<string, unknown>;
  private _retry?: RetryPolicy;
  private _timeoutMs?: number;

  constructor(id: string, toolName: string) {
    super(id);
    this.toolName = toolName;
  }

  input(input: Record<string, unknown>): this {
    this._input = input;
    return this;
  }

  retry(policy: RetryPolicy): this {
    this._retry = policy;
    return this;
  }

  timeout(ms: number): this {
    this._timeoutMs = ms;
    return this;
  }

  build(): ToolNode {
    return {
      kind: 'tool',
      id: this.id,
      toolName: this.toolName,
      input: this._input,
      retry: this._retry,
      timeoutMs: this._timeoutMs,
    };
  }
}

export class SequenceNodeBuilder extends WorkflowNodeBuilder<SequenceNode> {
  private _steps: WorkflowNodeBuilder<any>[] = [];

  step(nodeBuilder: WorkflowNodeBuilder<any>): this {
    this._steps.push(nodeBuilder);
    return this;
  }

  tool(id: string, toolName: string, config?: (b: ToolNodeBuilder) => void): this {
    const builder = new ToolNodeBuilder(id, toolName);
    if (config) config(builder);
    this._steps.push(builder);
    return this;
  }

  sequence(id: string, config?: (b: SequenceNodeBuilder) => void): this {
    const builder = new SequenceNodeBuilder(id);
    if (config) config(builder);
    this._steps.push(builder);
    return this;
  }

  parallel(id: string, config?: (b: ParallelNodeBuilder) => void): this {
    const builder = new ParallelNodeBuilder(id);
    if (config) config(builder);
    this._steps.push(builder);
    return this;
  }

  branch(id: string, predicateId: string, config?: (b: BranchNodeBuilder) => void): this {
    const builder = new BranchNodeBuilder(id, predicateId);
    if (config) config(builder);
    this._steps.push(builder);
    return this;
  }

  build(): SequenceNode {
    return {
      kind: 'sequence',
      id: this.id,
      steps: this._steps.map((b) => b.build()),
    };
  }
}

export class ParallelNodeBuilder extends WorkflowNodeBuilder<ParallelNode> {
  private _steps: WorkflowNodeBuilder<any>[] = [];
  private _maxConcurrency?: number = 4;
  private _failFast?: boolean = false;

  step(nodeBuilder: WorkflowNodeBuilder<any>): this {
    this._steps.push(nodeBuilder);
    return this;
  }

  tool(id: string, toolName: string, config?: (b: ToolNodeBuilder) => void): this {
    const builder = new ToolNodeBuilder(id, toolName);
    if (config) config(builder);
    this._steps.push(builder);
    return this;
  }

  sequence(id: string, config?: (b: SequenceNodeBuilder) => void): this {
    const builder = new SequenceNodeBuilder(id);
    if (config) config(builder);
    this._steps.push(builder);
    return this;
  }

  parallel(id: string, config?: (b: ParallelNodeBuilder) => void): this {
    const builder = new ParallelNodeBuilder(id);
    if (config) config(builder);
    this._steps.push(builder);
    return this;
  }

  branch(id: string, predicateId: string, config?: (b: BranchNodeBuilder) => void): this {
    const builder = new BranchNodeBuilder(id, predicateId);
    if (config) config(builder);
    this._steps.push(builder);
    return this;
  }

  maxConcurrency(concurrency: number): this {
    this._maxConcurrency = concurrency;
    return this;
  }

  failFast(ff: boolean): this {
    this._failFast = ff;
    return this;
  }

  build(): ParallelNode {
    return {
      kind: 'parallel',
      id: this.id,
      steps: this._steps.map((b) => b.build()),
      maxConcurrency: this._maxConcurrency,
      failFast: this._failFast,
    };
  }
}

export class BranchNodeBuilder extends WorkflowNodeBuilder<BranchNode> {
  private predicateId: string;
  private _predicateFn?: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>;
  private _whenTrue?: WorkflowNodeBuilder<any>;
  private _whenFalse?: WorkflowNodeBuilder<any>;

  constructor(id: string, predicateId: string) {
    super(id);
    this.predicateId = predicateId;
  }

  predicateFn(fn: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>): this {
    this._predicateFn = fn;
    return this;
  }

  whenTrue(nodeBuilder: WorkflowNodeBuilder<any>): this {
    this._whenTrue = nodeBuilder;
    return this;
  }

  whenFalse(nodeBuilder: WorkflowNodeBuilder<any>): this {
    this._whenFalse = nodeBuilder;
    return this;
  }

  build(): BranchNode {
    if (!this._whenTrue) {
      throw new Error(`BranchNode '${this.id}' requires a whenTrue step`);
    }
    return {
      kind: 'branch',
      id: this.id,
      predicateId: this.predicateId,
      predicateFn: this._predicateFn,
      whenTrue: this._whenTrue.build(),
      whenFalse: this._whenFalse ? this._whenFalse.build() : undefined,
    };
  }
}

export class WorkflowBuilder {
  private _id: string;
  private _displayName: string;
  private _description?: string;
  private _tags?: string[];
  private _timeoutMs?: number;
  private _defaultMaxConcurrency?: number;
  private _buildFn!: (ctx: WorkflowExecutionContext) => WorkflowNode;
  private _onStart?: (ctx: WorkflowExecutionContext) => Promise<void> | void;
  private _onFinish?: (ctx: WorkflowExecutionContext, result: unknown) => Promise<void> | void;
  private _onError?: (ctx: WorkflowExecutionContext, error: Error) => Promise<void> | void;

  constructor(id: string, displayName: string) {
    this._id = id;
    this._displayName = displayName;
  }

  description(desc: string): this { this._description = desc; return this; }
  tags(tags: string[]): this { this._tags = tags; return this; }
  timeoutMs(timeout: number): this { this._timeoutMs = timeout; return this; }
  defaultMaxConcurrency(max: number): this { this._defaultMaxConcurrency = max; return this; }

  buildGraph(fn: (ctx: WorkflowExecutionContext) => WorkflowNodeBuilder<any>): this {
    this._buildFn = (ctx) => fn(ctx).build();
    return this;
  }

  onStart(fn: (ctx: WorkflowExecutionContext) => Promise<void> | void): this { this._onStart = fn; return this; }
  onFinish(fn: (ctx: WorkflowExecutionContext, result: unknown) => Promise<void> | void): this { this._onFinish = fn; return this; }
  onError(fn: (ctx: WorkflowExecutionContext, error: Error) => Promise<void> | void): this { this._onError = fn; return this; }

  build(): WorkflowContract {
    if (!this._buildFn) throw new Error(`WorkflowBuilder '${this._id}' needs a buildGraph() function.`);
    
    return {
      kind: 'workflow-contract',
      version: 1,
      id: this._id,
      displayName: this._displayName,
      description: this._description,
      tags: this._tags,
      timeoutMs: this._timeoutMs,
      defaultMaxConcurrency: this._defaultMaxConcurrency,
      build: this._buildFn,
      onStart: this._onStart,
      onFinish: this._onFinish,
      onError: this._onError,
    };
  }
}

export function createWorkflow(id: string, displayName: string): WorkflowBuilder {
  return new WorkflowBuilder(id, displayName);
}
