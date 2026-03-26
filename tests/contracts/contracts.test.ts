import { describe, expect, it } from 'vitest';
import {
  createWorkflow,
  ToolNodeBuilder,
  SequenceNodeBuilder,
  ParallelNodeBuilder,
  BranchNodeBuilder,
  type ToolNode,
  type SequenceNode,
  type ParallelNode,
  type BranchNode,
} from '@server/workflows/WorkflowContract';
import {
  NoopInstrumentation,
  SpanNames,
  MetricNames,
} from '@server/observability/InstrumentationContract';

/* ================================================================== */
/*  WorkflowContract Builder                                           */
/* ================================================================== */

describe('WorkflowContract - builder helpers', () => {
  it('ToolNodeBuilder creates a ToolNode with kind=tool', () => {
    const node: ToolNode = new ToolNodeBuilder('step1', 'my_tool').build();
    expect(node.kind).toBe('tool');
    expect(node.id).toBe('step1');
    expect(node.toolName).toBe('my_tool');
    expect(node.input).toBeUndefined();
  });

  it('ToolNodeBuilder accepts options', () => {
    const node = new ToolNodeBuilder('step2', 'tool2')
      .input({ key: 'value' })
      .retry({ maxAttempts: 3, backoffMs: 1000, multiplier: 2 })
      .timeout(5000)
      .build();
    expect(node.input).toEqual({ key: 'value' });
    expect(node.retry?.maxAttempts).toBe(3);
    expect(node.timeoutMs).toBe(5000);
  });

  it('SequenceNodeBuilder creates a SequenceNode', () => {
    const node: SequenceNode = new SequenceNodeBuilder('seq1').tool('a', 'tool_a').build();
    expect(node.kind).toBe('sequence');
    expect(node.steps).toHaveLength(1);
    expect(node.steps[0]!.id).toBe('a');
    expect((node.steps[0] as ToolNode).toolName).toBe('tool_a');
  });

  it('ParallelNodeBuilder creates a ParallelNode with defaults', () => {
    const node: ParallelNode = new ParallelNodeBuilder('par1')
      .tool('a', 'tool_a')
      .tool('b', 'tool_b')
      .build();
    expect(node.kind).toBe('parallel');
    expect(node.maxConcurrency).toBe(4); // default
    expect(node.failFast).toBe(false); // default
  });

  it('ParallelNodeBuilder accepts custom concurrency and failFast', () => {
    const node = new ParallelNodeBuilder('par2').maxConcurrency(2).failFast(true).build();
    expect(node.maxConcurrency).toBe(2);
    expect(node.failFast).toBe(true);
  });

  it('BranchNodeBuilder creates a BranchNode with predicateId', () => {
    const node: BranchNode = new BranchNodeBuilder('br1', 'my_predicate')
      .whenTrue(new ToolNodeBuilder('t', 'tool_t'))
      .whenFalse(new ToolNodeBuilder('f', 'tool_f'))
      .build();
    expect(node.kind).toBe('branch');
    expect(node.predicateId).toBe('my_predicate');
    expect(node.whenTrue.id).toBe('t');
    expect(node.whenFalse?.id).toBe('f');
    expect(node.predicateFn).toBeUndefined();
  });

  it('BranchNodeBuilder accepts optional predicateFn', () => {
    // oxlint-disable-next-line consistent-function-scoping
    const fn = () => true;
    const node = new BranchNodeBuilder('br2', 'pred')
      .whenTrue(new ToolNodeBuilder('t', 'tool_t'))
      .predicateFn(fn)
      .build();
    expect(node.predicateFn).toBe(fn);
    expect(node.whenFalse).toBeUndefined();
  });
});

describe('WorkflowContract - node composition', () => {
  it('nodes can be nested arbitrarily', () => {
    const root = new SequenceNodeBuilder('root')
      .parallel('par', (b: ParallelNodeBuilder) =>
        b
          .tool('leaf1', 'tool_leaf')
          .branch('br', 'check', (inner: BranchNodeBuilder) =>
            inner.whenTrue(new ToolNodeBuilder('leaf2', 'tool_leaf')),
          ),
      )
      .tool('leaf3', 'tool_leaf')
      .build();

    expect(root.kind).toBe('sequence');
    expect(root.steps[0]!.kind).toBe('parallel');
    expect((root.steps[0] as ParallelNode).steps[1]!.kind).toBe('branch');
  });

  it('createWorkflow builds a valid contract', () => {
    const contract = createWorkflow('wf1', 'Test Workflow')
      .description('A test')
      .timeoutMs(10000)
      .buildGraph(() => new ToolNodeBuilder('root', 'my_tool'))
      .build();

    expect(contract.kind).toBe('workflow-contract');
    expect(contract.id).toBe('wf1');
    expect(contract.displayName).toBe('Test Workflow');
    expect(contract.timeoutMs).toBe(10000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(contract.build({} as any).kind).toBe('tool');
  });
});

/* ================================================================== */
/*  InstrumentationContract                                            */
/* ================================================================== */

describe('InstrumentationContract - NoopInstrumentation', () => {
  it('startSpan returns a SpanLike that does not throw', () => {
    const noop = new NoopInstrumentation();
    const span = noop.startSpan('test.span', { key: 'value' });
    expect(span.name).toBe('test.span');
    expect(span.startTime).toBeGreaterThan(0);
    expect(() => span.addEvent('event')).not.toThrow();
    expect(() => span.end()).not.toThrow();
  });

  it('emitMetric does not throw', () => {
    const noop = new NoopInstrumentation();
    expect(() => noop.emitMetric('test_metric', 1, 'counter')).not.toThrow();
    expect(() => noop.emitMetric('test_metric', 42, 'gauge', { dim: 'a' })).not.toThrow();
    expect(() => noop.emitMetric('test_metric', 1.5, 'histogram')).not.toThrow();
  });
});

describe('InstrumentationContract - well-known names', () => {
  it('SpanNames contains expected keys', () => {
    expect(SpanNames.toolExecute).toBe('tool.execute');
    expect(SpanNames.pluginLifecycle).toBe('plugin.lifecycle');
    expect(SpanNames.workflowRun).toBe('workflow.run');
    expect(SpanNames.bridgeRequest).toBe('bridge.request');
    expect(SpanNames.captchaSolve).toBe('captcha.solve');
  });

  it('MetricNames contains expected keys', () => {
    expect(MetricNames.toolCallsTotal).toBe('tool_calls_total');
    expect(MetricNames.workflowRunsTotal).toBe('workflow_runs_total');
    expect(MetricNames.bridgeRequestsTotal).toBe('bridge_requests_total');
    expect(MetricNames.pluginActiveTotal).toBe('plugin_active_total');
  });
});
