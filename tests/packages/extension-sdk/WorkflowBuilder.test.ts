import { describe, expect, it } from 'vitest';
import {
  defineWorkflow,
  toolStep,
  sequenceStep,
  parallelStep,
  branchStep,
  fallbackStep,
  type WorkflowExecutionContext,
  type ToolNodeOptions,
} from '@extension-sdk/workflow';

const alwaysTruePredicate = () => true;
const onStartHandler = () => {};
const onFinishHandler = () => {};
const onErrorHandler = () => {};

describe('extension-sdk workflow steps', () => {
  describe('toolStep', () => {
    it('builds a ToolNode with kind = tool', () => {
      const node = toolStep('nav', 'page_navigate');
      expect(node.kind).toBe('tool');
      expect(node.id).toBe('nav');
      expect(node.toolName).toBe('page_navigate');
    });

    it('builds a ToolNode with input via shorthand options', () => {
      const node = toolStep('nav', 'page_navigate', {
        input: { url: 'https://example.com' },
        inputFrom: { copied: 'prev.result' },
      });
      expect(node.input).toEqual({ url: 'https://example.com' });
      expect(node.inputFrom).toEqual({ copied: 'prev.result' });
    });

    it('builds a ToolNode with retry and timeout', () => {
      const node = toolStep('fetch', 'network_get_requests', {
        retry: { maxAttempts: 3, backoffMs: 1000 },
        timeoutMs: 5000,
      });
      expect(node.retry).toEqual({ maxAttempts: 3, backoffMs: 1000 });
      expect(node.timeoutMs).toBe(5000);
    });
  });

  describe('sequenceStep', () => {
    it('builds a SequenceNode with child tool steps', () => {
      const node = sequenceStep('main', (s) => {
        s.step(toolStep('a', 'tool_a'));
        s.step(toolStep('b', 'tool_b'));
      });
      expect(node.kind).toBe('sequence');
      expect(node.id).toBe('main');
      expect(node.steps).toHaveLength(2);
      expect(node.steps[0]!.kind).toBe('tool');
      expect(node.steps[1]!.kind).toBe('tool');
    });

    it('supports tool shorthand with options and nested nodes', () => {
      const options: ToolNodeOptions = {
        input: { b: 2 },
        timeoutMs: 1000,
        retry: { maxAttempts: 1, backoffMs: 10 },
      };

      const node = sequenceStep('seq1', (s) => {
        s.step(toolStep('t1', 't1Name'));
        s.tool('t2', 't2Name', options);
        s.tool('t3', 't3Name', {});
        s.tool('t4', 't4Name', (t) => t.timeout(2000));
        s.sequence('seq2', (inner) => inner.tool('t5', 't5Name'));
        s.parallel('par1', (p) => p.tool('t6', 't6Name'));
        s.branch('br1', 'pred', (b) => b.whenTrue(toolStep('t7', 't7Name')));
        s.tool('t8', 't8Name');
        s.sequence('seq3');
        s.parallel('par2');
      });

      expect(node.kind).toBe('sequence');
      expect(node.id).toBe('seq1');
      expect(node.steps).toHaveLength(10);
      expect((node.steps[1] as any).timeoutMs).toBe(1000);
      expect((node.steps[3] as any).timeoutMs).toBe(2000);
    });
  });

  describe('parallelStep', () => {
    it('builds a ParallelNode with defaults', () => {
      const node = parallelStep('par', (p) => p.tool('a', 'tool_a'));
      expect(node.kind).toBe('parallel');
      expect(node.id).toBe('par');
      expect(node.steps).toHaveLength(1);
      expect(node.maxConcurrency).toBe(4);
      expect(node.failFast).toBe(false);
    });

    it('accepts maxConcurrency and failFast', () => {
      const node = parallelStep('par', (p) => {
        p.maxConcurrency(2).failFast(true);
        p.tool('a', 'tool_a');
        p.tool('b', 'tool_b');
      });
      expect(node.maxConcurrency).toBe(2);
      expect(node.failFast).toBe(true);
      expect(node.steps).toHaveLength(2);
    });
  });

  describe('branchStep', () => {
    it('builds with whenTrue only', () => {
      const node = branchStep('gate', 'hasAuth', (b) => b.whenTrue(toolStep('y', 'tool_y')));
      expect(node.kind).toBe('branch');
      expect(node.predicateId).toBe('hasAuth');
      expect(node.whenTrue.kind).toBe('tool');
      expect(node.whenFalse).toBeUndefined();
    });

    it('builds with both whenTrue and whenFalse', () => {
      const node = branchStep('gate', 'hasAuth', (b) => {
        b.whenTrue(toolStep('y', 'tool_y'));
        b.whenFalse(toolStep('n', 'tool_n'));
      });
      expect(node.whenTrue.kind).toBe('tool');
      expect(node.whenFalse?.kind).toBe('tool');
    });

    it('accepts predicateFn', () => {
      const node = branchStep('gate', 'hasAuth', (b) => {
        b.predicateFn(alwaysTruePredicate).whenTrue(toolStep('y', 'tool_y'));
      });
      expect(node.predicateFn).toBe(alwaysTruePredicate);
    });

    it('throws if whenTrue is not set', () => {
      expect(() => branchStep('gate', 'hasAuth')).toThrow(/requires a whenTrue step/);
    });
  });

  describe('fallbackStep', () => {
    it('builds primary and fallback branches', () => {
      const node = fallbackStep('fb', (f) => {
        f.primary(toolStep('primary', 'tool_a'));
        f.fallback(toolStep('fallback', 'tool_b'));
      });

      expect(node.kind).toBe('fallback');
      expect(node.primary.id).toBe('primary');
      expect(node.fallback.id).toBe('fallback');
    });
  });
});

describe('defineWorkflow', () => {
  it('builds a minimal workflow contract', () => {
    const wf = defineWorkflow('test.wf', 'Test WF', (w) =>
      w.buildGraph((_ctx) => sequenceStep('main', (s) => s.tool('nav', 'page_navigate'))),
    );

    expect(wf.kind).toBe('workflow-contract');
    expect(wf.version).toBe(1);
    expect(wf.id).toBe('test.wf');
    expect(wf.displayName).toBe('Test WF');
  });

  it('supports full metadata chain', () => {
    const wf = defineWorkflow('full.wf', 'Full WF', (w) =>
      w
        .description('A full workflow')
        .tags(['test', 'demo'])
        .timeoutMs(30_000)
        .defaultMaxConcurrency(4)
        .buildGraph((_ctx) => sequenceStep('main', (s) => s.tool('a', 'tool_a'))),
    );

    expect(wf.description).toBe('A full workflow');
    expect(wf.tags).toEqual(['test', 'demo']);
    expect(wf.timeoutMs).toBe(30_000);
    expect(wf.defaultMaxConcurrency).toBe(4);
  });

  it('supports route and lifecycle handlers', () => {
    const routeMeta = {
      kind: 'workflow' as const,
      triggerPatterns: [/test/],
      steps: [],
      requiredDomains: ['network'],
      priority: 1,
    };

    const wf = defineWorkflow('life.wf', 'Life WF', (w) =>
      w
        .route(routeMeta)
        .onStart(onStartHandler)
        .onFinish(onFinishHandler)
        .onError(onErrorHandler)
        .buildGraph((_ctx) => toolStep('main', 'tool')),
    );

    expect(wf.route).toEqual(routeMeta);
    expect(wf.onStart).toBe(onStartHandler);
    expect(wf.onFinish).toBe(onFinishHandler);
    expect(wf.onError).toBe(onErrorHandler);
  });

  it('produces a working build function', () => {
    const wf = defineWorkflow('seq.wf', 'Seq WF', (w) =>
      w.buildGraph((_ctx) =>
        sequenceStep('main', (s) => {
          s.tool('nav', 'page_navigate', { input: { url: 'https://example.com' } });
          s.tool('links', 'page_get_all_links');
        }),
      ),
    );

    const root = wf.build({} as WorkflowExecutionContext);
    expect(root.kind).toBe('sequence');
    if (root.kind === 'sequence') {
      expect(root.steps).toHaveLength(2);
      expect(root.steps[0]!.kind).toBe('tool');
    }
  });

  it('throws if buildGraph is not set', () => {
    expect(() => defineWorkflow('no-graph.wf', 'No Graph WF', (w) => w)).toThrow(
      /needs a buildGraph/,
    );
  });
});
