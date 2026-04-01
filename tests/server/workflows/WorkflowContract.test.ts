import { beforeEach, describe, expect, it } from 'vitest';
import {
  BranchNodeBuilder,
  ParallelNodeBuilder,
  SequenceNodeBuilder,
  ToolNodeBuilder,
  WorkflowBuilder,
  createWorkflow,
} from '@server/workflows/WorkflowContract';

const alwaysTruePredicate = () => true;

describe('workflows/WorkflowContract', () => {
  beforeEach(() => {
    // Keep a stable test structure.
  });

  it('builds tool nodes with input, retry, and timeout', () => {
    const node = new ToolNodeBuilder('tool-1', 'page_navigate')
      .input({ url: 'https://example.com' })
      .retry({ maxAttempts: 2, backoffMs: 10, multiplier: 2 })
      .timeout(500)
      .build();

    expect(node).toEqual({
      kind: 'tool',
      id: 'tool-1',
      toolName: 'page_navigate',
      input: { url: 'https://example.com' },
      retry: { maxAttempts: 2, backoffMs: 10, multiplier: 2 },
      timeoutMs: 500,
    });
  });

  it('builds nested sequence and parallel graphs with defaults', () => {
    const node = new SequenceNodeBuilder('root')
      .tool('tool-1', 'page_navigate', (builder) => builder.input({ url: 'https://example.com' }))
      .parallel('parallel-1', (builder: ParallelNodeBuilder) => {
        builder.tool('tool-2', 'page_click');
      })
      .build();

    expect(node).toEqual({
      kind: 'sequence',
      id: 'root',
      steps: [
        {
          kind: 'tool',
          id: 'tool-1',
          toolName: 'page_navigate',
          input: { url: 'https://example.com' },
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
    expect(() => new BranchNodeBuilder('branch-1', 'always_true').build()).toThrow(
      "BranchNode 'branch-1' requires a whenTrue step",
    );
  });

  it('requires workflows to define a graph before build', () => {
    expect(() => new WorkflowBuilder('wf', 'Workflow').build()).toThrow(
      "WorkflowBuilder 'wf' needs a buildGraph() function.",
    );
  });

  it('creates complete workflow contracts from the helper builder', () => {
    const workflow = createWorkflow('wf-1', 'Workflow')
      .description('Runs a simple flow')
      .tags(['demo'])
      .timeoutMs(1000)
      .defaultMaxConcurrency(3)
      .buildGraph(() => new SequenceNodeBuilder('root').tool('tool-1', 'page_navigate'))
      .build();

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
          retry: undefined,
          timeoutMs: undefined,
        },
      ],
    });
  });

  // --- Additional coverage for node builders ---

  it('SequenceNodeBuilder supports nested sequence via step()', () => {
    const inner = new SequenceNodeBuilder('inner').tool('t1', 'tool_a');
    const outer = new SequenceNodeBuilder('outer').step(inner).build();
    expect(outer.steps[0]).toEqual({
      kind: 'sequence',
      id: 'inner',
      steps: [
        {
          kind: 'tool',
          id: 't1',
          toolName: 'tool_a',
          input: undefined,
          retry: undefined,
          timeoutMs: undefined,
        },
      ],
    });
  });

  it('SequenceNodeBuilder supports nested sequence via sequence()', () => {
    const node = new SequenceNodeBuilder('outer')
      .sequence('inner', (b) => {
        b.tool('t2', 'tool_b');
      })
      .build();
    expect(node.steps[0]).toMatchObject({ kind: 'sequence', id: 'inner' });
  });

  it('SequenceNodeBuilder supports branch()', () => {
    const node = new SequenceNodeBuilder('seq')
      .branch('br', 'always_true', (b) => {
        b.whenTrue(new ToolNodeBuilder('yes', 'tool_y'));
      })
      .build();
    expect(node.steps[0]).toMatchObject({ kind: 'branch', id: 'br', predicateId: 'always_true' });
  });

  it('ParallelNodeBuilder supports sequence and parallel children', () => {
    const node = new ParallelNodeBuilder('par')
      .sequence('seq-child', (b) => b.tool('t', 'tool'))
      .parallel('par-child')
      .step(new ToolNodeBuilder('step-tool', 'tool_x'))
      .maxConcurrency(8)
      .failFast(true)
      .build();

    expect(node.maxConcurrency).toBe(8);
    expect(node.failFast).toBe(true);
    expect(node.steps).toHaveLength(3);
    expect(node.steps[0]).toMatchObject({ kind: 'sequence' });
    expect(node.steps[1]).toMatchObject({ kind: 'parallel' });
    expect(node.steps[2]).toMatchObject({ kind: 'tool' });
  });

  it('ParallelNodeBuilder supports branch()', () => {
    const node = new ParallelNodeBuilder('par')
      .branch('br', 'pred', (b) => {
        b.whenTrue(new ToolNodeBuilder('true-tool', 'tool'));
        b.whenFalse(new ToolNodeBuilder('false-tool', 'tool'));
      })
      .build();

    const branch = node.steps[0] as any;
    expect(branch.kind).toBe('branch');
    expect(branch.whenFalse).toBeDefined();
  });

  it('BranchNodeBuilder supports predicateFn', () => {
    const node = new BranchNodeBuilder('br', 'pred')
      .predicateFn(alwaysTruePredicate)
      .whenTrue(new ToolNodeBuilder('true', 'tool'))
      .whenFalse(new ToolNodeBuilder('false', 'tool'))
      .build();

    expect(node.predicateFn).toBe(alwaysTruePredicate);
    expect(node.whenTrue).toMatchObject({ kind: 'tool', id: 'true' });
    expect(node.whenFalse).toMatchObject({ kind: 'tool', id: 'false' });
  });

  it('BranchNodeBuilder omits whenFalse when not set', () => {
    const node = new BranchNodeBuilder('br', 'pred')
      .whenTrue(new ToolNodeBuilder('t', 'tool'))
      .build();

    expect(node.whenFalse).toBeUndefined();
  });

  it('WorkflowBuilder supports lifecycle callbacks', () => {
    let started = false;
    let finished = false;
    let errored = false;

    const workflow = createWorkflow('wf', 'Test')
      .buildGraph(() => new SequenceNodeBuilder('root'))
      .onStart(() => {
        started = true;
      })
      .onFinish(() => {
        finished = true;
      })
      .onError(() => {
        errored = true;
      })
      .build();

    expect(workflow.onStart).toBeDefined();
    expect(workflow.onFinish).toBeDefined();
    expect(workflow.onError).toBeDefined();

    // Invoke callbacks
    workflow.onStart!({} as never);
    workflow.onFinish!({} as never, null);
    workflow.onError!({} as never, new Error('test'));

    expect(started).toBe(true);
    expect(finished).toBe(true);
    expect(errored).toBe(true);
  });

  it('ToolNodeBuilder supports inputFrom', () => {
    const node = new ToolNodeBuilder('t', 'tool_name')
      .inputFrom({ targetField: 'stepId.sourceField' })
      .build();
    expect(node).toMatchObject({
      inputFrom: { targetField: 'stepId.sourceField' },
    });
  });

  it('ParallelNodeBuilder methods invoke config callback when provided', () => {
    let toolCalled = false;
    let branchCalled = false;
    new ParallelNodeBuilder('p')
      .tool('t', 'tool', () => {
        toolCalled = true;
      })
      .branch('b', 'pred', (b) => {
        branchCalled = true;
        b.whenTrue(new ToolNodeBuilder('wt', 'tool'));
      });
    expect(toolCalled).toBe(true);
    expect(branchCalled).toBe(true);
  });

  it('WorkflowBuilder supports route', () => {
    const route: any = {
      kind: 'preset',
      triggerPatterns: [],
      steps: [],
      requiredDomains: [],
      priority: 1,
    };
    const w = new WorkflowBuilder('w', 'W')
      .route(route)
      .buildGraph(() => new ToolNodeBuilder('t', 'tool'))
      .build();
    expect(w.route).toBe(route);
  });

  it('Builders can be instantiated without config callbacks', () => {
    // testing missing branch lines 218,225,232,265,272,279
    const s = new SequenceNodeBuilder('s')
      .tool('t1', 'tn')
      .sequence('s2')
      .parallel('p2')
      .branch('b1', 'pr');
    expect(() => s.build()).toThrow(); // throws because branch missing whenTrue

    const p = new ParallelNodeBuilder('p')
      .tool('t2', 'tn')
      .sequence('s3')
      .parallel('p3', () => {})
      .branch('b2', 'pr');
    expect(() => p.build()).toThrow(); // throws because branch missing whenTrue
  });
});
