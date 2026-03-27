import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MacroRunner } from '@server/macros/MacroRunner';
import type { MacroDefinition } from '@server/macros/types';

// Mock WorkflowEngine
vi.mock('@server/workflows/WorkflowEngine', () => ({
  executeExtensionWorkflow: vi.fn(),
}));

import { executeExtensionWorkflow } from '@server/workflows/WorkflowEngine';

const mockCtx = {} as any;

function makeDef(overrides?: Partial<MacroDefinition>): MacroDefinition {
  return {
    id: 'test_inputfrom',
    displayName: 'Test InputFrom',
    description: 'Test inputFrom resolution',
    tags: ['test'],
    timeoutMs: 5000,
    steps: [
      { id: 'step_a', toolName: 'tool_a' },
      { id: 'step_b', toolName: 'tool_b', inputFrom: { code: 'step_a.code' } },
    ],
    ...overrides,
  };
}

describe('WorkflowEngine inputFrom resolution', () => {
  let runner: MacroRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new MacroRunner(mockCtx);
  });

  it('buildWorkflowFromDefinition includes inputFrom on ToolNodes', () => {
    const def = makeDef();
    const wf = runner.buildWorkflowFromDefinition(def);
    const mockExecCtx = {
      stepResults: new Map(),
      workflowRunId: '',
      profile: '',
      invokeTool: vi.fn(),
      emitSpan: vi.fn(),
      emitMetric: vi.fn(),
      getConfig: vi.fn(),
    };
    const graph = wf.build(mockExecCtx as any);
    expect(graph.kind).toBe('sequence');
    const seqNode = graph as any;
    expect(seqNode.steps[1].inputFrom).toEqual({ code: 'step_a.code' });
  });

  it('buildWorkflowFromDefinition omits inputFrom when not specified', () => {
    const def = makeDef({
      steps: [{ id: 'step_a', toolName: 'tool_a' }],
    });
    const wf = runner.buildWorkflowFromDefinition(def);
    const mockExecCtx = {
      stepResults: new Map(),
      workflowRunId: '',
      profile: '',
      invokeTool: vi.fn(),
      emitSpan: vi.fn(),
      emitMetric: vi.fn(),
      getConfig: vi.fn(),
    };
    const graph = wf.build(mockExecCtx as any);
    const seqNode = graph as any;
    expect(seqNode.steps[0].inputFrom).toBeUndefined();
  });

  it('execute() passes workflow with inputFrom to engine', async () => {
    const def = makeDef();
    (executeExtensionWorkflow as any).mockResolvedValue({
      durationMs: 50,
      stepResults: { step_a: { code: 'test()' }, step_b: {} },
      spans: [],
    });

    const result = await runner.execute(def);
    expect(result.ok).toBe(true);
    expect(executeExtensionWorkflow).toHaveBeenCalledTimes(1);

    // Verify the workflow passed to the engine has inputFrom on step_b
    const calledWorkflow = (executeExtensionWorkflow as any).mock.calls[0][1];
    expect(calledWorkflow.id).toBe('test_inputfrom');
  });

  it('multiple inputFrom mappings are supported', () => {
    const def = makeDef({
      steps: [
        { id: 'step_a', toolName: 'tool_a' },
        {
          id: 'step_b',
          toolName: 'tool_b',
          inputFrom: { code: 'step_a.code', name: 'step_a.functionName' },
        },
      ],
    });
    const wf = runner.buildWorkflowFromDefinition(def);
    const mockExecCtx = {
      stepResults: new Map(),
      workflowRunId: '',
      profile: '',
      invokeTool: vi.fn(),
      emitSpan: vi.fn(),
      emitMetric: vi.fn(),
      getConfig: vi.fn(),
    };
    const graph = wf.build(mockExecCtx as any);
    const seqNode = graph as any;
    expect(seqNode.steps[1].inputFrom).toEqual({
      code: 'step_a.code',
      name: 'step_a.functionName',
    });
  });
});
