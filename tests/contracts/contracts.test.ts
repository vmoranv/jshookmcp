import { describe, expect, it } from 'vitest';
import {
  toolNode,
  sequenceNode,
  parallelNode,
  branchNode,
  type ToolNode,
  type SequenceNode,
  type ParallelNode,
  type BranchNode,
  type WorkflowContract,
  type WorkflowExecutionContext,
} from '@server/workflows/WorkflowContract';
import {
  PluginLifecycleOrder,
  isValidLifecycleTransition,
  defaultValidationResult,
  type PluginState,
} from '@server/plugins/PluginContract';
import {
  NoopInstrumentation,
  SpanNames,
  MetricNames,
} from '@server/observability/InstrumentationContract';

/* ================================================================== */
/*  WorkflowContract                                                   */
/* ================================================================== */

describe('WorkflowContract - builder helpers', () => {
  it('toolNode creates a ToolNode with kind=tool', () => {
    const node: ToolNode = toolNode('step1', 'my_tool');
    expect(node.kind).toBe('tool');
    expect(node.id).toBe('step1');
    expect(node.toolName).toBe('my_tool');
    expect(node.input).toBeUndefined();
  });

  it('toolNode accepts options object', () => {
    const node = toolNode('step2', 'tool2', {
      input: { key: 'value' },
      retry: { maxAttempts: 3, backoffMs: 1000, multiplier: 2 },
      timeoutMs: 5000,
    });
    expect(node.input).toEqual({ key: 'value' });
    expect(node.retry?.maxAttempts).toBe(3);
    expect(node.timeoutMs).toBe(5000);
  });

  it('sequenceNode creates a SequenceNode', () => {
    const inner = toolNode('a', 'tool_a');
    const node: SequenceNode = sequenceNode('seq1', [inner]);
    expect(node.kind).toBe('sequence');
    expect(node.steps).toHaveLength(1);
    expect(node.steps[0]).toBe(inner);
  });

  it('parallelNode creates a ParallelNode with defaults', () => {
    const a = toolNode('a', 'tool_a');
    const b = toolNode('b', 'tool_b');
    const node: ParallelNode = parallelNode('par1', [a, b]);
    expect(node.kind).toBe('parallel');
    expect(node.maxConcurrency).toBe(4); // default
    expect(node.failFast).toBe(false); // default
  });

  it('parallelNode accepts custom concurrency and failFast', () => {
    const node = parallelNode('par2', [], 2, true);
    expect(node.maxConcurrency).toBe(2);
    expect(node.failFast).toBe(true);
  });

  it('branchNode creates a BranchNode with predicateId', () => {
    const t = toolNode('t', 'tool_t');
    const f = toolNode('f', 'tool_f');
    const node: BranchNode = branchNode('br1', 'my_predicate', t, f);
    expect(node.kind).toBe('branch');
    expect(node.predicateId).toBe('my_predicate');
    expect(node.whenTrue).toBe(t);
    expect(node.whenFalse).toBe(f);
    expect(node.predicateFn).toBeUndefined();
  });

  it('branchNode accepts optional predicateFn', () => {
    const t = toolNode('t', 'tool_t');
    const fn = () => true;
    const node = branchNode('br2', 'pred', t, undefined, fn);
    expect(node.predicateFn).toBe(fn);
    expect(node.whenFalse).toBeUndefined();
  });
});

describe('WorkflowContract - node composition', () => {
  it('nodes can be nested arbitrarily', () => {
    const leaf = toolNode('leaf', 'tool_leaf');
    const branch = branchNode('br', 'check', leaf);
    const par = parallelNode('par', [leaf, branch]);
    const root = sequenceNode('root', [par, leaf]);

    expect(root.kind).toBe('sequence');
    expect(root.steps[0].kind).toBe('parallel');
    expect((root.steps[0] as ParallelNode).steps[1].kind).toBe('branch');
  });
});

/* ================================================================== */
/*  PluginContract                                                     */
/* ================================================================== */

describe('PluginContract - lifecycle', () => {
  it('PluginLifecycleOrder is in correct order', () => {
    expect(PluginLifecycleOrder).toEqual([
      'loaded', 'validated', 'registered', 'activated', 'deactivated', 'unloaded',
    ]);
  });

  it('allows forward transitions', () => {
    expect(isValidLifecycleTransition('loaded', 'validated')).toBe(true);
    expect(isValidLifecycleTransition('validated', 'registered')).toBe(true);
    expect(isValidLifecycleTransition('registered', 'activated')).toBe(true);
    expect(isValidLifecycleTransition('activated', 'deactivated')).toBe(true);
    expect(isValidLifecycleTransition('deactivated', 'unloaded')).toBe(true);
  });

  it('rejects backward transitions', () => {
    expect(isValidLifecycleTransition('validated', 'loaded')).toBe(false);
    expect(isValidLifecycleTransition('activated', 'loaded')).toBe(false);
    expect(isValidLifecycleTransition('unloaded', 'loaded')).toBe(false);
  });

  it('rejects skipping transitions', () => {
    expect(isValidLifecycleTransition('loaded', 'activated')).toBe(false);
    expect(isValidLifecycleTransition('loaded', 'unloaded')).toBe(false);
  });

  it('allows activated → deactivated special case', () => {
    expect(isValidLifecycleTransition('activated', 'deactivated')).toBe(true);
  });

  it('defaultValidationResult returns valid with no errors', () => {
    const result = defaultValidationResult();
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
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