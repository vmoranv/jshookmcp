import { describe, expect, it } from 'vitest';
import {
  toolNode,
  sequenceNode,
  parallelNode,
  branchNode,
  createWorkflow,
  ToolNodeBuilder,
  SequenceNodeBuilder,
  ParallelNodeBuilder,
  BranchNodeBuilder,
  WorkflowBuilder,
  type WorkflowExecutionContext,
  type ToolNodeOptions,
} from '@extension-sdk/workflow';

/* ================================================================== */
/*  Factory functions — return Builder instances                        */
/* ================================================================== */

describe('Workflow node factory functions', () => {
  describe('toolNode', () => {
    it('returns a ToolNodeBuilder', () => {
      const builder = toolNode('nav', 'page_navigate');
      expect(builder).toBeInstanceOf(ToolNodeBuilder);
    });

    it('builds a ToolNode with kind = tool', () => {
      const node = toolNode('nav', 'page_navigate').build();
      expect(node.kind).toBe('tool');
      expect(node.id).toBe('nav');
      expect(node.toolName).toBe('page_navigate');
    });

    it('builds a ToolNode with input via fluent API', () => {
      const node = toolNode('nav', 'page_navigate').input({ url: 'https://example.com' }).build();
      expect(node.input).toEqual({ url: 'https://example.com' });
    });

    it('builds a ToolNode with retry and timeout', () => {
      const node = toolNode('fetch', 'network_get_requests')
        .retry({ maxAttempts: 3, backoffMs: 1000 })
        .timeout(5000)
        .build();
      expect(node.retry).toEqual({ maxAttempts: 3, backoffMs: 1000 });
      expect(node.timeoutMs).toBe(5000);
    });
  });

  describe('sequenceNode', () => {
    it('returns a SequenceNodeBuilder', () => {
      expect(sequenceNode('main')).toBeInstanceOf(SequenceNodeBuilder);
    });

    it('builds a SequenceNode with child tool steps', () => {
      const node = sequenceNode('main').tool('a', 'tool_a').tool('b', 'tool_b').build();
      expect(node.kind).toBe('sequence');
      expect(node.id).toBe('main');
      expect(node.steps).toHaveLength(2);
      expect(node.steps[0]!.kind).toBe('tool');
      expect(node.steps[1]!.kind).toBe('tool');
    });
  });

  describe('parallelNode', () => {
    it('returns a ParallelNodeBuilder', () => {
      expect(parallelNode('par')).toBeInstanceOf(ParallelNodeBuilder);
    });

    it('builds a ParallelNode with defaults', () => {
      const node = parallelNode('par').tool('a', 'tool_a').build();
      expect(node.kind).toBe('parallel');
      expect(node.id).toBe('par');
      expect(node.steps).toHaveLength(1);
    });

    it('accepts maxConcurrency and failFast via fluent API', () => {
      const node = parallelNode('par')
        .maxConcurrency(2)
        .failFast(true)
        .tool('a', 'tool_a')
        .tool('b', 'tool_b')
        .build();
      expect(node.maxConcurrency).toBe(2);
      expect(node.failFast).toBe(true);
      expect(node.steps).toHaveLength(2);
    });
  });

  describe('branchNode', () => {
    it('returns a BranchNodeBuilder', () => {
      expect(branchNode('gate', 'hasAuth')).toBeInstanceOf(BranchNodeBuilder);
    });

    it('builds with whenTrue only', () => {
      const node = branchNode('gate', 'hasAuth').whenTrue(toolNode('y', 'tool_y')).build();
      expect(node.kind).toBe('branch');
      expect(node.predicateId).toBe('hasAuth');
      expect(node.whenTrue.kind).toBe('tool');
      expect(node.whenFalse).toBeUndefined();
    });

    it('builds with both whenTrue and whenFalse', () => {
      const node = branchNode('gate', 'hasAuth')
        .whenTrue(toolNode('y', 'tool_y'))
        .whenFalse(toolNode('n', 'tool_n'))
        .build();
      expect(node.whenTrue.kind).toBe('tool');
      expect(node.whenFalse?.kind).toBe('tool');
    });

    it('accepts predicateFn', () => {
      // oxlint-disable-next-line consistent-function-scoping
      const fn = () => true;
      const node = branchNode('gate', 'hasAuth')
        .predicateFn(fn)
        .whenTrue(toolNode('y', 'tool_y'))
        .build();
      expect(node.predicateFn).toBe(fn);
    });

    it('throws if whenTrue is not set', () => {
      expect(() => branchNode('gate', 'hasAuth').build()).toThrow(/requires a whenTrue step/);
    });
  });
});

/* ================================================================== */
/*  createWorkflow + WorkflowBuilder                                   */
/* ================================================================== */

describe('createWorkflow (fluent builder)', () => {
  it('returns a WorkflowBuilder', () => {
    const wb = createWorkflow('test.wf', 'Test WF');
    expect(wb).toBeInstanceOf(WorkflowBuilder);
  });

  it('builds a minimal workflow contract', () => {
    const wf = createWorkflow('test.wf', 'Test WF')
      .buildGraph((_ctx) => sequenceNode('main').tool('nav', 'page_navigate'))
      .build();

    expect(wf.kind).toBe('workflow-contract');
    expect(wf.version).toBe(1);
    expect(wf.id).toBe('test.wf');
    expect(wf.displayName).toBe('Test WF');
  });

  it('supports full metadata chain', () => {
    const wf = createWorkflow('full.wf', 'Full WF')
      .description('A full workflow')
      .tags(['test', 'demo'])
      .timeoutMs(30_000)
      .defaultMaxConcurrency(4)
      .buildGraph((_ctx) => sequenceNode('main').tool('a', 'tool_a'))
      .build();

    expect(wf.description).toBe('A full workflow');
    expect(wf.tags).toEqual(['test', 'demo']);
    expect(wf.timeoutMs).toBe(30_000);
    expect(wf.defaultMaxConcurrency).toBe(4);
  });

  it('build() produces a working build function', () => {
    const wf = createWorkflow('seq.wf', 'Seq WF')
      .buildGraph((_ctx) =>
        sequenceNode('main')
          .tool('nav', 'page_navigate', (b) => b.input({ url: 'https://example.com' }))
          .tool('links', 'page_get_all_links'),
      )
      .build();

    const root = wf.build({} as WorkflowExecutionContext);
    expect(root.kind).toBe('sequence');
    if (root.kind === 'sequence') {
      expect(root.steps).toHaveLength(2);
      expect(root.steps[0]!.kind).toBe('tool');
    }
  });

  it('tool() in sequence supports ToolNodeOptions shorthand (P7)', () => {
    const options: ToolNodeOptions = {
      input: { url: 'https://example.com' },
      timeoutMs: 5000,
    };
    const wf = createWorkflow('opts.wf', 'Options WF')
      .buildGraph((_ctx) => sequenceNode('main').tool('nav', 'page_navigate', options))
      .build();

    const root = wf.build({} as WorkflowExecutionContext);
    if (root.kind === 'sequence') {
      const toolStep = root.steps[0]!;
      expect(toolStep.kind).toBe('tool');
      if (toolStep.kind === 'tool') {
        expect(toolStep.input).toEqual({ url: 'https://example.com' });
        expect(toolStep.timeoutMs).toBe(5000);
      }
    }
  });

  it('throws if buildGraph is not set', () => {
    expect(() => createWorkflow('no-graph.wf', 'No Graph WF').build()).toThrow(
      /needs a buildGraph/,
    );
  });
});
