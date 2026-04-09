import { describe, expect, it } from 'vitest';
import {
  defineWorkflow,
  toolStep,
  sequenceStep,
  parallelStep,
  branchStep,
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

const alwaysTruePredicate = () => true;

describe('WorkflowContract step helpers', () => {
  it('toolStep creates a ToolNode with kind=tool', () => {
    const node: ToolNode = toolStep('step1', 'my_tool');
    expect(node.kind).toBe('tool');
    expect(node.id).toBe('step1');
    expect(node.toolName).toBe('my_tool');
    expect(node.input).toBeUndefined();
  });

  it('toolStep accepts input, retry, timeout, and inputFrom', () => {
    const node = toolStep('step2', 'tool2', {
      input: { key: 'value' },
      inputFrom: { copied: 'step1.result' },
      retry: { maxAttempts: 3, backoffMs: 1000, multiplier: 2 },
      timeoutMs: 5000,
    });
    expect(node.input).toEqual({ key: 'value' });
    expect(node.inputFrom).toEqual({ copied: 'step1.result' });
    expect(node.retry?.maxAttempts).toBe(3);
    expect(node.timeoutMs).toBe(5000);
  });

  it('sequenceStep creates a SequenceNode', () => {
    const node: SequenceNode = sequenceStep('seq1', (s) => {
      s.step(toolStep('a', 'tool_a'));
    });
    expect(node.kind).toBe('sequence');
    expect(node.steps).toHaveLength(1);
    expect(node.steps[0]!.id).toBe('a');
    expect((node.steps[0] as ToolNode).toolName).toBe('tool_a');
  });

  it('parallelStep creates a ParallelNode with defaults', () => {
    const node: ParallelNode = parallelStep('par1', (p) => {
      p.step(toolStep('a', 'tool_a'));
      p.step(toolStep('b', 'tool_b'));
    });
    expect(node.kind).toBe('parallel');
    expect(node.maxConcurrency).toBe(4);
    expect(node.failFast).toBe(false);
  });

  it('parallelStep accepts custom concurrency and failFast', () => {
    const node = parallelStep('par2', (p) => {
      p.maxConcurrency(2).failFast(true);
    });
    expect(node.maxConcurrency).toBe(2);
    expect(node.failFast).toBe(true);
  });

  it('branchStep creates a BranchNode with predicateId', () => {
    const node: BranchNode = branchStep('br1', 'my_predicate', (b) => {
      b.whenTrue(toolStep('t', 'tool_t'));
      b.whenFalse(toolStep('f', 'tool_f'));
    });
    expect(node.kind).toBe('branch');
    expect(node.predicateId).toBe('my_predicate');
    expect(node.whenTrue.id).toBe('t');
    expect(node.whenFalse?.id).toBe('f');
    expect(node.predicateFn).toBeUndefined();
  });

  it('branchStep accepts optional predicateFn', () => {
    const node = branchStep('br2', 'pred', (b) => {
      b.predicateFn(alwaysTruePredicate).whenTrue(toolStep('t', 'tool_t'));
    });
    expect(node.predicateFn).toBe(alwaysTruePredicate);
    expect(node.whenFalse).toBeUndefined();
  });

  it('nodes can be nested arbitrarily', () => {
    const root = sequenceStep('root', (s) => {
      s.parallel('par', (p) => {
        p.step(toolStep('leaf1', 'tool_leaf'));
        p.step(
          branchStep('br', 'check', (b) => {
            b.whenTrue(toolStep('leaf2', 'tool_leaf'));
          }),
        );
      });
      s.step(toolStep('leaf3', 'tool_leaf'));
    });

    expect(root.kind).toBe('sequence');
    expect(root.steps[0]!.kind).toBe('parallel');
    expect((root.steps[0] as ParallelNode).steps[1]!.kind).toBe('branch');
  });

  it('defineWorkflow builds a valid contract', () => {
    const contract = defineWorkflow('wf1', 'Test Workflow', (w) =>
      w
        .description('A test')
        .timeoutMs(10000)
        .buildGraph(() => toolStep('root', 'my_tool')),
    );

    expect(contract.kind).toBe('workflow-contract');
    expect(contract.id).toBe('wf1');
    expect(contract.displayName).toBe('Test Workflow');
    expect(contract.timeoutMs).toBe(10000);
    expect(contract.build({} as never).kind).toBe('tool');
  });
});

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
