import { beforeEach, describe, expect, it } from 'vitest';
import {
  branchStep,
  defineWorkflow,
  fallbackStep,
  sequenceStep,
  toolStep,
} from '@server/workflows/WorkflowContract';

const alwaysTruePredicate = () => true;

describe('workflows/WorkflowContract', () => {
  beforeEach(() => {
    // Keep a stable test structure.
  });

  it('builds tool nodes with input, retry, timeout, and inputFrom', () => {
    const node = toolStep('tool-1', 'page_navigate', {
      input: { url: 'https://example.com' },
      inputFrom: { copied: 'prev.result' },
      retry: { maxAttempts: 2, backoffMs: 10, multiplier: 2 },
      timeoutMs: 500,
    });

    expect(node).toEqual({
      kind: 'tool',
      id: 'tool-1',
      toolName: 'page_navigate',
      input: { url: 'https://example.com' },
      inputFrom: { copied: 'prev.result' },
      retry: { maxAttempts: 2, backoffMs: 10, multiplier: 2 },
      timeoutMs: 500,
    });
  });

  it('builds nested sequence and parallel graphs with defaults', () => {
    const node = sequenceStep('root', (s) => {
      s.tool('tool-1', 'page_navigate', {
        input: { url: 'https://example.com' },
      });
      s.parallel('parallel-1', (p) => {
        p.tool('tool-2', 'page_click');
      });
    });

    expect(node).toEqual({
      kind: 'sequence',
      id: 'root',
      steps: [
        {
          kind: 'tool',
          id: 'tool-1',
          toolName: 'page_navigate',
          input: { url: 'https://example.com' },
          inputFrom: undefined,
          retry: undefined,
          timeoutMs: undefined,
        },
        {
          kind: 'parallel',
          id: 'parallel-1',
          steps: [
            {
              kind: 'tool',
              id: 'tool-2',
              toolName: 'page_click',
              input: undefined,
              inputFrom: undefined,
              retry: undefined,
              timeoutMs: undefined,
            },
          ],
          maxConcurrency: 4,
          failFast: false,
        },
      ],
    });
  });

  it('requires branch nodes to define whenTrue', () => {
    expect(() => branchStep('branch-1', 'always_true')).toThrow(
      "BranchNode 'branch-1' requires a whenTrue step",
    );
  });

  it('requires fallback nodes to define primary and fallback branches', () => {
    expect(() => fallbackStep('fb')).toThrow("FallbackNode 'fb' requires a primary step");
  });

  it('requires workflows to define a graph before build', () => {
    expect(() => defineWorkflow('wf', 'Workflow', (w) => w)).toThrow(
      "Workflow 'wf' needs a buildGraph() function.",
    );
  });

  it('creates complete workflow contracts from step helpers', () => {
    const workflow = defineWorkflow('wf-1', 'Workflow', (w) =>
      w
        .description('Runs a simple flow')
        .tags(['demo'])
        .timeoutMs(1000)
        .defaultMaxConcurrency(3)
        .buildGraph(() => sequenceStep('root', (s) => s.tool('tool-1', 'page_navigate'))),
    );

    expect(workflow).toMatchObject({
      kind: 'workflow-contract',
      version: 1,
      id: 'wf-1',
      displayName: 'Workflow',
      description: 'Runs a simple flow',
      tags: ['demo'],
      timeoutMs: 1000,
      defaultMaxConcurrency: 3,
    });
    expect(workflow.build({} as never)).toEqual({
      kind: 'sequence',
      id: 'root',
      steps: [
        {
          kind: 'tool',
          id: 'tool-1',
          toolName: 'page_navigate',
          input: undefined,
          inputFrom: undefined,
          retry: undefined,
          timeoutMs: undefined,
        },
      ],
    });
  });

  it('supports nested nodes through step helpers', () => {
    const node = sequenceStep('outer', (s) => {
      s.step(sequenceStep('inner', (inner) => inner.tool('t1', 'tool_a')));
      s.parallel('par', (p) => {
        p.sequence('seq-child', (inner) => inner.tool('t2', 'tool_b'));
        p.parallel('par-child');
        p.step(toolStep('step-tool', 'tool_x'));
        p.maxConcurrency(8).failFast(true);
      });
      s.branch('br', 'always_true', (b) => {
        b.whenTrue(toolStep('yes', 'tool_y'));
      });
    });

    expect(node.steps[0]).toMatchObject({ kind: 'sequence', id: 'inner' });
    expect(node.steps[1]).toMatchObject({ kind: 'parallel', maxConcurrency: 8, failFast: true });
    expect(node.steps[2]).toMatchObject({ kind: 'branch', predicateId: 'always_true' });
  });

  it('branchStep supports predicateFn and whenFalse', () => {
    const node = branchStep('br', 'pred', (b) => {
      b.predicateFn(alwaysTruePredicate);
      b.whenTrue(toolStep('true', 'tool'));
      b.whenFalse(toolStep('false', 'tool'));
    });

    expect(node.predicateFn).toBe(alwaysTruePredicate);
    expect(node.whenTrue).toMatchObject({ kind: 'tool', id: 'true' });
    expect(node.whenFalse).toMatchObject({ kind: 'tool', id: 'false' });
  });

  it('supports lifecycle callbacks and route metadata', () => {
    let started = false;
    let finished = false;
    let errored = false;
    const route: any = {
      kind: 'preset',
      triggerPatterns: [],
      steps: [],
      requiredDomains: [],
      priority: 1,
    };

    const workflow = defineWorkflow('wf', 'Test', (w) =>
      w
        .route(route)
        .buildGraph(() => sequenceStep('root'))
        .onStart(() => {
          started = true;
        })
        .onFinish(() => {
          finished = true;
        })
        .onError(() => {
          errored = true;
        }),
    );

    workflow.onStart?.({} as never);
    workflow.onFinish?.({} as never, null);
    workflow.onError?.({} as never, new Error('test'));

    expect(workflow.route).toBe(route);
    expect(started).toBe(true);
    expect(finished).toBe(true);
    expect(errored).toBe(true);
  });
});
