export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  multiplier?: number;
}

export type WorkflowNodeType = 'tool' | 'sequence' | 'parallel' | 'branch' | 'fallback';

export interface ToolNode {
  readonly kind: 'tool';
  readonly id: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  readonly inputFrom?: Record<string, string>;
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

export interface FallbackNode {
  readonly kind: 'fallback';
  readonly id: string;
  readonly primary: WorkflowNode;
  readonly fallback: WorkflowNode;
}

export type WorkflowNode = ToolNode | SequenceNode | ParallelNode | BranchNode | FallbackNode;

export interface ToolNodeOptions {
  input?: Record<string, unknown>;
  inputFrom?: Record<string, string>;
  retry?: RetryPolicy;
  timeoutMs?: number;
}

export interface WorkflowExecutionContext {
  readonly workflowRunId: string;
  readonly profile: string;
  readonly stepResults: ReadonlyMap<string, unknown>;
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

export interface WorkflowRouteStep {
  readonly id: string;
  readonly toolName: string;
  readonly description: string;
  readonly prerequisites: string[];
  readonly parallel?: boolean;
  readonly expectedInputs?: Record<string, string>;
  readonly evidenceNodeType?: string;
}

export type WorkflowRouteKind = 'preset' | 'workflow';

export interface WorkflowRouteMetadata {
  readonly kind: WorkflowRouteKind;
  readonly triggerPatterns: RegExp[];
  readonly steps: WorkflowRouteStep[];
  readonly requiredDomains: string[];
  readonly priority: number;
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
  readonly route?: WorkflowRouteMetadata;
  build(ctx: WorkflowExecutionContext): WorkflowNode;
  onStart?(ctx: WorkflowExecutionContext): Promise<void> | void;
  onFinish?(ctx: WorkflowExecutionContext, result: unknown): Promise<void> | void;
  onError?(ctx: WorkflowExecutionContext, error: Error): Promise<void> | void;
}

export interface ToolStep {
  input(input: Record<string, unknown>): this;
  inputFrom(mapping: Record<string, string>): this;
  retry(policy: RetryPolicy): this;
  timeout(ms: number): this;
}

export interface SequenceStep {
  step(node: WorkflowNode): this;
  tool(id: string, toolName: string, config?: ToolNodeOptions | ((step: ToolStep) => void)): this;
  sequence(id: string, config?: (step: SequenceStep) => void): this;
  parallel(id: string, config?: (step: ParallelStep) => void): this;
  branch(id: string, predicateId: string, config?: (step: BranchStep) => void): this;
  fallback(id: string, config?: (step: FallbackStep) => void): this;
}

export interface ParallelStep extends SequenceStep {
  maxConcurrency(concurrency: number): this;
  failFast(enabled: boolean): this;
}

export interface BranchStep {
  predicateFn(fn: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>): this;
  whenTrue(node: WorkflowNode): this;
  whenFalse(node: WorkflowNode): this;
}

export interface FallbackStep {
  primary(node: WorkflowNode): this;
  fallback(node: WorkflowNode): this;
}

export interface WorkflowSpec {
  description(desc: string): this;
  tags(tags: string[]): this;
  timeoutMs(timeout: number): this;
  defaultMaxConcurrency(max: number): this;
  route(route: WorkflowRouteMetadata): this;
  buildGraph(fn: (ctx: WorkflowExecutionContext) => WorkflowNode): this;
  onStart(fn: (ctx: WorkflowExecutionContext) => Promise<void> | void): this;
  onFinish(fn: (ctx: WorkflowExecutionContext, result: unknown) => Promise<void> | void): this;
  onError(fn: (ctx: WorkflowExecutionContext, error: Error) => Promise<void> | void): this;
}

type Builder<T> = { build(): T };
type NodeRef = WorkflowNode | NodeBuilder<WorkflowNode>;
type NodeBuilder<T extends WorkflowNode> = Builder<T>;
type ToolBuilder = ToolStep & Builder<ToolNode>;
type SequenceBuilder = SequenceStep & Builder<SequenceNode>;
type ParallelBuilder = ParallelStep & Builder<ParallelNode>;
type BranchBuilder = BranchStep & Builder<BranchNode>;
type FallbackBuilder = FallbackStep & Builder<FallbackNode>;
type WorkflowBuilder = WorkflowSpec & Builder<WorkflowContract>;

function buildNode(node: NodeRef): WorkflowNode {
  return 'kind' in node ? node : node.build();
}

function setup<T>(target: T, fn?: (value: T) => void): T {
  fn?.(target);
  return target;
}

function createToolBuilder(id: string, toolName: string): ToolBuilder {
  const step = {} as ToolBuilder;
  let input: Record<string, unknown> | undefined;
  let inputFrom: Record<string, string> | undefined;
  let retry: RetryPolicy | undefined;
  let timeoutMs: number | undefined;

  step.input = (value) => {
    input = value;
    return step;
  };
  step.inputFrom = (value) => {
    inputFrom = value;
    return step;
  };
  step.retry = (value) => {
    retry = value;
    return step;
  };
  step.timeout = (value) => {
    timeoutMs = value;
    return step;
  };
  step.build = () => ({
    kind: 'tool',
    id,
    toolName,
    input,
    inputFrom,
    retry,
    timeoutMs,
  });
  return step;
}

function applyToolConfig(
  step: ToolBuilder,
  config?: ToolNodeOptions | ((value: ToolStep) => void),
): ToolBuilder {
  if (!config) {
    return step;
  }
  if (typeof config === 'function') {
    config(step);
    return step;
  }
  if (config.input) {
    step.input(config.input);
  }
  if (config.inputFrom) {
    step.inputFrom(config.inputFrom);
  }
  if (config.retry) {
    step.retry(config.retry);
  }
  if (config.timeoutMs !== undefined) {
    step.timeout(config.timeoutMs);
  }
  return step;
}

function addSequenceMethods<T extends SequenceStep>(step: T, steps: NodeRef[]): T {
  step.step = (node) => {
    steps.push(node);
    return step;
  };
  step.tool = (id, toolName, config) => {
    steps.push(applyToolConfig(createToolBuilder(id, toolName), config));
    return step;
  };
  step.sequence = (id, config) => {
    steps.push(setup(createSequenceBuilder(id), config));
    return step;
  };
  step.parallel = (id, config) => {
    steps.push(setup(createParallelBuilder(id), config));
    return step;
  };
  step.branch = (id, predicateId, config) => {
    steps.push(setup(createBranchBuilder(id, predicateId), config));
    return step;
  };
  step.fallback = (id, config) => {
    steps.push(setup(createFallbackBuilder(id), config));
    return step;
  };
  return step;
}

function createSequenceBuilder(id: string): SequenceBuilder {
  const steps: NodeRef[] = [];
  const step = addSequenceMethods({} as SequenceBuilder, steps);
  step.build = () => ({
    kind: 'sequence',
    id,
    steps: steps.map(buildNode),
  });
  return step;
}

function createParallelBuilder(id: string): ParallelBuilder {
  const steps: NodeRef[] = [];
  const step = addSequenceMethods({} as ParallelBuilder, steps);
  let maxConcurrency = 4;
  let failFast = false;

  step.maxConcurrency = (value) => {
    maxConcurrency = value;
    return step;
  };
  step.failFast = (value) => {
    failFast = value;
    return step;
  };
  step.build = () => ({
    kind: 'parallel',
    id,
    steps: steps.map(buildNode),
    maxConcurrency,
    failFast,
  });
  return step;
}

function createBranchBuilder(id: string, predicateId: string): BranchBuilder {
  const step = {} as BranchBuilder;
  let predicateFn: ((ctx: WorkflowExecutionContext) => boolean | Promise<boolean>) | undefined;
  let whenTrue: NodeRef | undefined;
  let whenFalse: NodeRef | undefined;

  step.predicateFn = (value) => {
    predicateFn = value;
    return step;
  };
  step.whenTrue = (value) => {
    whenTrue = value;
    return step;
  };
  step.whenFalse = (value) => {
    whenFalse = value;
    return step;
  };
  step.build = () => {
    if (!whenTrue) {
      throw new Error(`BranchNode '${id}' requires a whenTrue step`);
    }

    return {
      kind: 'branch',
      id,
      predicateId,
      predicateFn,
      whenTrue: buildNode(whenTrue),
      whenFalse: whenFalse ? buildNode(whenFalse) : undefined,
    };
  };
  return step;
}

function createFallbackBuilder(id: string): FallbackBuilder {
  const step = {} as FallbackBuilder;
  let primary: NodeRef | undefined;
  let fallback: NodeRef | undefined;

  step.primary = (value) => {
    primary = value;
    return step;
  };
  step.fallback = (value) => {
    fallback = value;
    return step;
  };
  step.build = () => {
    if (!primary) {
      throw new Error(`FallbackNode '${id}' requires a primary step`);
    }
    if (!fallback) {
      throw new Error(`FallbackNode '${id}' requires a fallback step`);
    }

    return {
      kind: 'fallback',
      id,
      primary: buildNode(primary),
      fallback: buildNode(fallback),
    };
  };
  return step;
}

function createWorkflowBuilder(id: string, displayName: string): WorkflowBuilder {
  const workflow = {} as WorkflowBuilder;
  let description: string | undefined;
  let tags: string[] | undefined;
  let timeoutMs: number | undefined;
  let defaultMaxConcurrency: number | undefined;
  let route: WorkflowRouteMetadata | undefined;
  let buildGraph: ((ctx: WorkflowExecutionContext) => WorkflowNode) | undefined;
  let onStart: ((ctx: WorkflowExecutionContext) => Promise<void> | void) | undefined;
  let onFinish:
    | ((ctx: WorkflowExecutionContext, result: unknown) => Promise<void> | void)
    | undefined;
  let onError: ((ctx: WorkflowExecutionContext, error: Error) => Promise<void> | void) | undefined;

  workflow.description = (value) => {
    description = value;
    return workflow;
  };
  workflow.tags = (value) => {
    tags = value;
    return workflow;
  };
  workflow.timeoutMs = (value) => {
    timeoutMs = value;
    return workflow;
  };
  workflow.defaultMaxConcurrency = (value) => {
    defaultMaxConcurrency = value;
    return workflow;
  };
  workflow.route = (value) => {
    route = value;
    return workflow;
  };
  workflow.buildGraph = (value) => {
    buildGraph = value;
    return workflow;
  };
  workflow.onStart = (value) => {
    onStart = value;
    return workflow;
  };
  workflow.onFinish = (value) => {
    onFinish = value;
    return workflow;
  };
  workflow.onError = (value) => {
    onError = value;
    return workflow;
  };
  workflow.build = () => {
    if (!buildGraph) {
      throw new Error(`Workflow '${id}' needs a buildGraph() function.`);
    }

    return {
      kind: 'workflow-contract',
      version: 1,
      id,
      displayName,
      description,
      tags,
      timeoutMs,
      defaultMaxConcurrency,
      route,
      build: buildGraph,
      onStart,
      onFinish,
      onError,
    };
  };
  return workflow;
}

type WorkflowConfigurator = (workflow: WorkflowSpec) => void;

export function defineWorkflow(
  id: string,
  displayName: string,
  configure: WorkflowConfigurator,
): WorkflowContract {
  const workflow = createWorkflowBuilder(id, displayName);
  configure(workflow);
  return workflow.build();
}

export function toolStep(
  id: string,
  toolName: string,
  config?: ToolNodeOptions | ((step: ToolStep) => void),
): ToolNode {
  return applyToolConfig(createToolBuilder(id, toolName), config).build();
}

export function sequenceStep(id: string, config?: (step: SequenceStep) => void): SequenceNode {
  return setup(createSequenceBuilder(id), config).build();
}

export function parallelStep(id: string, config?: (step: ParallelStep) => void): ParallelNode {
  return setup(createParallelBuilder(id), config).build();
}

export function branchStep(
  id: string,
  predicateId: string,
  config?: (step: BranchStep) => void,
): BranchNode {
  return setup(createBranchBuilder(id, predicateId), config).build();
}

export function fallbackStep(id: string, config?: (step: FallbackStep) => void): FallbackNode {
  return setup(createFallbackBuilder(id), config).build();
}
